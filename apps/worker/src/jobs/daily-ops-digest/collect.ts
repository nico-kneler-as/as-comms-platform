import { and, asc, count, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { dependencyAuditSummaryId, type Provider } from "@as-comms/contracts";
import {
  type Stage1Database,
  dependencyAuditSummary,
  identityResolutionQueue,
  integrationHealth,
  pendingComposerOutbounds,
  postmarkWebhookDeadLetter,
  routingReviewQueue,
  smsMessages,
  sourceEvidenceQuarantine,
  syncState,
} from "@as-comms/db";

import type {
  DailyOpsDigestSignal,
  DailyOpsDigestSnapshot,
  DailyOpsDigestSyncStateSignal,
} from "./types.js";
import { dailyOpsDigestTimeZone } from "./types.js";

interface SyncStateCollectorConfig {
  readonly provider: Provider;
  readonly label: string;
  readonly pollIntervalSeconds: number;
}

const zonedDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: dailyOpsDigestTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function toGapDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown collector error.";
}

async function collectSignal<T>(
  collect: () => Promise<T>,
): Promise<DailyOpsDigestSignal<T>> {
  try {
    return {
      kind: "ok",
      value: await collect(),
    };
  } catch (error) {
    return {
      kind: "gap",
      detail: toGapDetail(error),
    };
  }
}

function getZonedDateTimeParts(value: Date) {
  const pieces = zonedDateTimeFormatter.formatToParts(value);
  const lookup = Object.fromEntries(
    pieces
      .filter((piece) => piece.type !== "literal")
      .map((piece) => [piece.type, piece.value]),
  );

  return {
    year: Number.parseInt(lookup.year ?? "0", 10),
    month: Number.parseInt(lookup.month ?? "0", 10),
    day: Number.parseInt(lookup.day ?? "0", 10),
    hour: Number.parseInt(lookup.hour ?? "0", 10),
    minute: Number.parseInt(lookup.minute ?? "0", 10),
    second: Number.parseInt(lookup.second ?? "0", 10),
  };
}

function getTimeZoneOffsetMs(value: Date): number {
  const parts = getZonedDateTimeParts(value);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - value.getTime();
}

function shiftCalendarDate(input: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly deltaDays: number;
}) {
  const shifted = new Date(
    Date.UTC(input.year, input.month - 1, input.day + input.deltaDays),
  );

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatDateKey(input: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): string {
  return [
    String(input.year).padStart(4, "0"),
    String(input.month).padStart(2, "0"),
    String(input.day).padStart(2, "0"),
  ].join("-");
}

function zonedMidnightToUtc(input: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): Date {
  const utcGuess = new Date(
    Date.UTC(input.year, input.month - 1, input.day, 0, 0, 0),
  );
  const offsetMs = getTimeZoneOffsetMs(utcGuess);
  const corrected = new Date(utcGuess.getTime() - offsetMs);
  const correctedOffsetMs = getTimeZoneOffsetMs(corrected);

  return new Date(utcGuess.getTime() - correctedOffsetMs);
}

function buildDigestWindow(runAt: Date) {
  const digestDate = getZonedDateTimeParts(runAt);
  const previousDate = shiftCalendarDate({
    year: digestDate.year,
    month: digestDate.month,
    day: digestDate.day,
    deltaDays: -1,
  });
  const startsAt = zonedMidnightToUtc(previousDate);
  const endsAt = zonedMidnightToUtc({
    year: digestDate.year,
    month: digestDate.month,
    day: digestDate.day,
  });

  return {
    digestDateDenver: formatDateKey(digestDate),
    window: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      labelDateDenver: formatDateKey(previousDate),
      timeZone: dailyOpsDigestTimeZone,
    },
  };
}

async function collectSyncStateSignal(input: {
  readonly db: Stage1Database;
  readonly syncStates: readonly SyncStateCollectorConfig[];
}): Promise<{
  readonly signals: readonly DailyOpsDigestSyncStateSignal[];
  readonly missingProviders: readonly string[];
}> {
  const providers = input.syncStates.map((signal) => signal.provider);
  const rows = await input.db
    .select({
      provider: syncState.provider,
      status: syncState.status,
      lastSuccessfulAt: syncState.lastSuccessfulAt,
      consecutiveFailureCount: syncState.consecutiveFailureCount,
      deadLetterCount: syncState.deadLetterCount,
      updatedAt: syncState.updatedAt,
    })
    .from(syncState)
    .where(
      and(
        eq(syncState.scope, "provider"),
        eq(syncState.jobType, "live_ingest"),
        inArray(syncState.provider, providers),
      ),
    )
    .orderBy(desc(syncState.updatedAt));

  const latestByProvider = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    if (row.provider !== null && !latestByProvider.has(row.provider)) {
      latestByProvider.set(row.provider, row);
    }
  }

  const signals: DailyOpsDigestSyncStateSignal[] = [];
  const missingProviders: string[] = [];

  for (const config of input.syncStates) {
    const row = latestByProvider.get(config.provider);

    if (row === undefined) {
      missingProviders.push(config.label);
      continue;
    }

    signals.push({
      provider: config.provider,
      label: config.label,
      pollIntervalSeconds: config.pollIntervalSeconds,
      status: row.status,
      lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
      consecutiveFailureCount: row.consecutiveFailureCount,
      deadLetterCount: row.deadLetterCount,
    });
  }

  return {
    signals,
    missingProviders,
  };
}

export async function collectDailyOpsDigestSnapshot(input: {
  readonly db: Stage1Database;
  readonly runAt: Date;
  readonly syncStates: readonly SyncStateCollectorConfig[];
}): Promise<DailyOpsDigestSnapshot> {
  const window = buildDigestWindow(input.runAt);
  const startsAt = new Date(window.window.startsAt);
  const endsAt = new Date(window.window.endsAt);

  const [
    syncStateSignal,
    sourceEvidenceQuarantineSignal,
    postmarkWebhookDeadLetterSignal,
    pendingComposerOutboundsSignal,
    smsMessagesSignal,
    integrationHealthSignal,
    reviewQueuesSignal,
    dependencyAuditSignal,
  ] = await Promise.all([
    collectSignal(() =>
      collectSyncStateSignal({
        db: input.db,
        syncStates: input.syncStates,
      }),
    ),
    collectSignal(async () => {
      const [row] = await input.db
        .select({
          total: count(),
        })
        .from(sourceEvidenceQuarantine)
        .where(
          and(
            gte(sourceEvidenceQuarantine.attemptedAt, startsAt),
            lt(sourceEvidenceQuarantine.attemptedAt, endsAt),
          ),
        );

      return {
        dayCount: row?.total ?? 0,
      };
    }),
    collectSignal(async () => {
      const rows = await input.db
        .select({
          id: postmarkWebhookDeadLetter.id,
          receivedAt: postmarkWebhookDeadLetter.receivedAt,
          status: postmarkWebhookDeadLetter.status,
        })
        .from(postmarkWebhookDeadLetter)
        .where(
          and(
            gte(postmarkWebhookDeadLetter.receivedAt, startsAt),
            lt(postmarkWebhookDeadLetter.receivedAt, endsAt),
          ),
        )
        .orderBy(
          asc(postmarkWebhookDeadLetter.receivedAt),
          asc(postmarkWebhookDeadLetter.id),
        );

      return {
        rows: rows.map((row) => ({
          id: row.id,
          receivedAt: row.receivedAt.toISOString(),
          status: row.status,
        })),
      };
    }),
    collectSignal(async () => {
      const rows = await input.db
        .select({
          status: pendingComposerOutbounds.status,
        })
        .from(pendingComposerOutbounds)
        .where(
          and(
            gte(pendingComposerOutbounds.attemptedAt, startsAt),
            lt(pendingComposerOutbounds.attemptedAt, endsAt),
            inArray(pendingComposerOutbounds.status, ["failed", "orphaned"]),
          ),
        );

      return {
        failedCount: rows.filter((row) => row.status === "failed").length,
        orphanedCount: rows.filter((row) => row.status === "orphaned").length,
      };
    }),
    collectSignal(async () => {
      const rows = await input.db
        .select({
          sendStatus: smsMessages.sendStatus,
        })
        .from(smsMessages)
        .where(
          and(
            gte(smsMessages.updatedAt, startsAt),
            lt(smsMessages.updatedAt, endsAt),
            inArray(smsMessages.sendStatus, ["failed", "undelivered"]),
          ),
        );

      return {
        failedCount: rows.filter((row) => row.sendStatus === "failed").length,
        undeliveredCount: rows.filter((row) => row.sendStatus === "undelivered")
          .length,
      };
    }),
    collectSignal(async () => {
      const rows = await input.db
        .select({
          id: integrationHealth.id,
          serviceName: integrationHealth.serviceName,
          status: integrationHealth.status,
          degradedSinceAt: integrationHealth.degradedSinceAt,
          updatedAt: integrationHealth.updatedAt,
        })
        .from(integrationHealth)
        .orderBy(asc(integrationHealth.serviceName));

      return {
        rows: rows.map((row) => ({
          id: row.id,
          serviceName: row.serviceName,
          status: row.status,
          degradedSinceAt: row.degradedSinceAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    }),
    collectSignal(async () => {
      const [identityCases, routingCases] = await Promise.all([
        input.db
          .select({
            id: identityResolutionQueue.id,
            openedAt: identityResolutionQueue.openedAt,
          })
          .from(identityResolutionQueue)
          .where(
            and(
              gte(identityResolutionQueue.openedAt, startsAt),
              lt(identityResolutionQueue.openedAt, endsAt),
            ),
          )
          .orderBy(
            asc(identityResolutionQueue.openedAt),
            asc(identityResolutionQueue.id),
          ),
        input.db
          .select({
            id: routingReviewQueue.id,
            openedAt: routingReviewQueue.openedAt,
          })
          .from(routingReviewQueue)
          .where(
            and(
              gte(routingReviewQueue.openedAt, startsAt),
              lt(routingReviewQueue.openedAt, endsAt),
            ),
          )
          .orderBy(
            asc(routingReviewQueue.openedAt),
            asc(routingReviewQueue.id),
          ),
      ]);

      return {
        identityCases: identityCases.map((row) => ({
          id: row.id,
          openedAt: row.openedAt.toISOString(),
        })),
        routingCases: routingCases.map((row) => ({
          id: row.id,
          openedAt: row.openedAt.toISOString(),
        })),
      };
    }),
    collectSignal(async () => {
      const [row] = await input.db
        .select({
          generatedAt: dependencyAuditSummary.generatedAt,
          exitStatus: dependencyAuditSummary.exitStatus,
          advisories: dependencyAuditSummary.advisoriesJson,
        })
        .from(dependencyAuditSummary)
        .where(eq(dependencyAuditSummary.id, dependencyAuditSummaryId))
        .limit(1);

      if (row === undefined) {
        return null;
      }

      return {
        generatedAt: row.generatedAt.toISOString(),
        exitStatus: row.exitStatus,
        advisories: row.advisories,
      };
    }),
  ]);

  return {
    runAt: input.runAt.toISOString(),
    digestDateDenver: window.digestDateDenver,
    window: window.window,
    syncState: syncStateSignal,
    sourceEvidenceQuarantine: sourceEvidenceQuarantineSignal,
    postmarkWebhookDeadLetter: postmarkWebhookDeadLetterSignal,
    pendingComposerOutbounds: pendingComposerOutboundsSignal,
    smsMessages: smsMessagesSignal,
    integrationHealth: integrationHealthSignal,
    reviewQueues: reviewQueuesSignal,
    dependencyAudit: dependencyAuditSignal,
  };
}
