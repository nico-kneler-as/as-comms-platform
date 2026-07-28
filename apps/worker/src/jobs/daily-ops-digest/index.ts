import type { Task } from "graphile-worker";

import type { OpsAlertStateRepository, OpsDigestWatermarkRepository } from "@as-comms/domain";
import {
  type OpsDigestWatermarkRecord,
  opsDigestWatermarkId,
} from "@as-comms/contracts";
import type { Provider } from "@as-comms/contracts";
import type { Stage1Database } from "@as-comms/db";

import { createOpsAlertSender } from "../../ops-alert/sender.js";
import { buildDailyOpsDigest } from "./builder.js";
import { collectDailyOpsDigestSnapshot } from "./collect.js";
import {
  readOpsDigestFromAlias,
  readOpsDigestLinks,
  readOpsDigestRecipient,
} from "./config.js";
import { renderDailyOpsDigest } from "./render.js";
import type {
  DailyOpsDigestHighWaterMark,
  DailyOpsDigestObservedState,
  DailyOpsDigestWatermarkState,
} from "./types.js";
import { dailyOpsDigestCategory, dailyOpsDigestJobName } from "./types.js";

interface SyncStateTaskConfig {
  readonly provider: Provider;
  readonly label: string;
  readonly pollIntervalSeconds: number;
}

export { dailyOpsDigestJobName };

export interface DailyOpsDigestTaskDependencies {
  readonly db: Stage1Database;
  readonly opsAlertState: OpsAlertStateRepository;
  readonly opsDigestWatermark: OpsDigestWatermarkRepository;
  readonly syncStates: readonly SyncStateTaskConfig[];
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
  readonly logger?: Pick<Console, "log" | "error">;
  readonly now?: () => Date;
}

function toWatermarkState(
  record: OpsDigestWatermarkRecord | null,
): DailyOpsDigestWatermarkState | null {
  if (record === null) {
    return null;
  }

  return {
    lastRunAt: record.lastRunAt,
    lastDigestSentAt: record.lastDigestSentAt,
    quietStreakStartedAt: record.quietStreakStartedAt,
    syncStateDeadLetterCounts: record.syncStateDeadLetterCounts,
    postmarkWebhookDeadLetter: record.postmarkWebhookDeadLetter,
    identityResolutionQueue: record.identityResolutionQueue,
    routingReviewQueue: record.routingReviewQueue,
  };
}

function buildDefaultWatermark(runAt: string): OpsDigestWatermarkRecord {
  return {
    id: opsDigestWatermarkId,
    lastRunAt: null,
    lastDigestSentAt: null,
    quietStreakStartedAt: null,
    syncStateDeadLetterCounts: {},
    postmarkWebhookDeadLetter: null,
    identityResolutionQueue: null,
    routingReviewQueue: null,
    createdAt: runAt,
    updatedAt: runAt,
  };
}

function mergeHighWaterMark(
  previous: DailyOpsDigestHighWaterMark | null,
  observed: DailyOpsDigestHighWaterMark | null | undefined,
): DailyOpsDigestHighWaterMark | null {
  if (observed === undefined || observed === null) {
    return previous;
  }

  return observed;
}

function mergeObservedState(
  base: OpsDigestWatermarkRecord,
  observedState: DailyOpsDigestObservedState | undefined,
): OpsDigestWatermarkRecord {
  if (observedState === undefined) {
    return base;
  }

  return {
    ...base,
    syncStateDeadLetterCounts:
      observedState.syncStateDeadLetterCounts ?? base.syncStateDeadLetterCounts,
    postmarkWebhookDeadLetter: mergeHighWaterMark(
      base.postmarkWebhookDeadLetter,
      observedState.postmarkWebhookDeadLetter,
    ),
    identityResolutionQueue: mergeHighWaterMark(
      base.identityResolutionQueue,
      observedState.identityResolutionQueue,
    ),
    routingReviewQueue: mergeHighWaterMark(
      base.routingReviewQueue,
      observedState.routingReviewQueue,
    ),
  };
}

function buildWatermarkForRun(input: {
  readonly previous: OpsDigestWatermarkRecord | null;
  readonly runAt: string;
  readonly observedState?: DailyOpsDigestObservedState;
  readonly lastDigestSentAt?: string | null;
  readonly quietStreakStartedAt?: string | null;
}): OpsDigestWatermarkRecord {
  const base = input.previous ?? buildDefaultWatermark(input.runAt);
  const merged = mergeObservedState(base, input.observedState);

  return {
    ...merged,
    lastRunAt: input.runAt,
    lastDigestSentAt:
      input.lastDigestSentAt === undefined
        ? merged.lastDigestSentAt
        : input.lastDigestSentAt,
    quietStreakStartedAt:
      input.quietStreakStartedAt === undefined
        ? merged.quietStreakStartedAt
        : input.quietStreakStartedAt,
    createdAt: base.createdAt,
    updatedAt: input.runAt,
  };
}

export function createDailyOpsDigestTask(
  deps: DailyOpsDigestTaskDependencies,
): Task {
  const env = deps.env ?? process.env;
  const fetchImplementation = deps.fetchImplementation ?? fetch;
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());

  return async () => {
    const runAt = now();
    const runAtIso = runAt.toISOString();
    const previousWatermark = await deps.opsDigestWatermark.get();

    try {
      const snapshot = await collectDailyOpsDigestSnapshot({
        db: deps.db,
        runAt,
        syncStates: deps.syncStates,
      });
      const buildResult = buildDailyOpsDigest({
        snapshot,
        watermark: toWatermarkState(previousWatermark),
      });

      if (buildResult.kind === "nothing_to_report") {
        await deps.opsDigestWatermark.upsert(
          buildWatermarkForRun({
            previous: previousWatermark,
            runAt: runAtIso,
            observedState: buildResult.observedState,
            quietStreakStartedAt:
              previousWatermark?.quietStreakStartedAt ?? runAtIso,
          }),
        );

        logger.log(
          JSON.stringify({
            event: "daily_ops_digest.completed",
            outcome: "nothing_to_report",
            runAt: runAtIso,
          }),
        );
        return;
      }

      const links = readOpsDigestLinks(env);
      const rendered = renderDailyOpsDigest({
        digest: buildResult.digest,
        settingsLogsUrl: links.settingsLogsUrl,
        settingsIntegrationsUrl: links.settingsIntegrationsUrl,
      });
      const sender = createOpsAlertSender({
        env: {
          ...env,
          OPS_ALERT_RECIPIENT: readOpsDigestRecipient(env),
          OPS_ALERT_FROM_ALIAS: readOpsDigestFromAlias(env),
        },
        fetchImplementation,
        stateRepository: deps.opsAlertState,
        now: () => runAt,
      });
      const sendResult = await sender.send({
        category: dailyOpsDigestCategory,
        dedupKey: buildResult.digest.dedupKey,
        rendered,
      });

      if (
        sendResult.kind === "auth_error" ||
        sendResult.kind === "transport_error"
      ) {
        throw new Error(
          `Daily ops digest send failed (${sendResult.kind}): ${sendResult.detail}`,
        );
      }

      await deps.opsDigestWatermark.upsert(
        buildWatermarkForRun({
          previous: previousWatermark,
          runAt: runAtIso,
          observedState: buildResult.observedState,
          lastDigestSentAt:
            sendResult.kind === "skipped_cooldown"
              ? sendResult.lastSentAt
              : runAtIso,
          quietStreakStartedAt: null,
        }),
      );

      logger.log(
        JSON.stringify({
          event: "daily_ops_digest.completed",
          outcome: buildResult.digest.kind,
          sendResult: sendResult.kind,
          dedupKey: buildResult.digest.dedupKey,
          sectionCount: buildResult.digest.sections.length,
          runAt: runAtIso,
        }),
      );
    } catch (error) {
      await deps.opsDigestWatermark.upsert(
        buildWatermarkForRun({
          previous: previousWatermark,
          runAt: runAtIso,
        }),
      );

      logger.error(
        JSON.stringify({
          event: "daily_ops_digest.failed",
          category: dailyOpsDigestCategory,
          runAt: runAtIso,
          detail: error instanceof Error ? error.message : "Unknown error.",
        }),
      );
      throw error;
    }
  };
}
