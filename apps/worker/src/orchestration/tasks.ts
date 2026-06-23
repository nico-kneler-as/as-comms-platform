import type { Task, TaskList } from "graphile-worker";

import {
  cutoverCheckpointBatchPayloadSchema,
  cutoverCheckpointBatchJobName,
  gmailHistoricalCaptureBatchJobName,
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchJobName,
  gmailLiveCaptureBatchPayloadSchema,
  integrationHealthCheckResponseSchema,
  mailchimpHistoricalCaptureBatchJobName,
  mailchimpHistoricalCaptureBatchPayloadSchema,
  mailchimpTransitionCaptureBatchJobName,
  mailchimpTransitionCaptureBatchPayloadSchema,
  parityCheckBatchJobName,
  parityCheckBatchPayloadSchema,
  projectionRebuildBatchJobName,
  projectionRebuildBatchPayloadSchema,
  replayBatchJobName,
  replayBatchPayloadSchema,
  salesforceHistoricalCaptureBatchJobName,
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchJobName,
  salesforceLiveCaptureBatchPayloadSchema,
  simpleTextingHistoricalCaptureBatchJobName,
  simpleTextingHistoricalCaptureBatchPayloadSchema,
  simpleTextingLiveCaptureBatchJobName,
  simpleTextingLiveCaptureBatchPayloadSchema,
  type IntegrationHealthRecord
} from "@as-comms/contracts";
import type {
  IntegrationHealthRepository,
  OpsAlertStateRepository,
  Stage1PersistenceService,
} from "@as-comms/domain";

import {
  createIntegrationBackfillGmailTask,
  enqueueIntegrationBackfillGmailJob,
  integrationBackfillGmailTaskName,
  type IntegrationBackfillGmailTaskDependencies,
} from "./integration-backfill.js";
import {
  createIntegrationHealthAlertSenderWithStateRepository,
  readIntegrationHealthAlertRecipient,
  type IntegrationHealthAlertSender
} from "../jobs/integration-health/email.js";
import { mailchimpTransitionSchedulerJobName } from "./mailchimp-transition-scheduler.js";
import {
  createPollAiKnowledgeAutoSyncTask,
  pollAiKnowledgeAutoSyncJobName,
  type PollAiKnowledgeAutoSyncTaskDependencies,
} from "./poll-ai-knowledge-auto-sync.js";
import type { Stage1WorkerOrchestrationService } from "./types.js";

export const pollGmailLiveJobName = "poll-gmail-live" as const;
export const pollSalesforceLiveJobName = "poll-salesforce-live" as const;
export const pollIntegrationHealthJobName = "poll-integration-health" as const;
export { integrationBackfillGmailTaskName };
export { pollAiKnowledgeAutoSyncJobName };
const polledIntegrationServices = [
  "salesforce",
  "gmail",
  "mailchimp"
] as const satisfies readonly IntegrationHealthRecord["id"][];
const integrationHealthAlertCooldownMs = 60 * 60 * 1000;
// Debounce window: a service must stay continuously degraded for at least this
// long before the first alert email fires. At the 5-minute poll cadence this
// means a transient single-poll blip (e.g. a momentary OAuth token-exchange
// timeout that recovers on the next poll) never pages — only a sustained
// outage of ~2+ consecutive failed polls does. Re-alerts after the first one
// remain governed by integrationHealthAlertCooldownMs.
const integrationHealthAlertDebounceMs = 10 * 60 * 1000;
const integrationBackfillMaxWindowMs = 24 * 60 * 60 * 1000;
const integrationBackfillSupportedService = "gmail";

export interface IntegrationHealthTaskDependencies {
  readonly integrationHealth: IntegrationHealthRepository;
  readonly opsAlertState: OpsAlertStateRepository;
  readonly persistence: Stage1PersistenceService;
  readonly captureBaseUrls: {
    readonly gmail: string;
    readonly salesforce: string;
    readonly mailchimp: string | null;
  };
  readonly fetchImplementation?: typeof fetch;
  readonly alertSender?: IntegrationHealthAlertSender;
  readonly now?: () => Date;
  readonly logger?: Pick<Console, "error" | "warn" | "info">;
}

function isDegradedStatus(
  status: IntegrationHealthRecord["status"],
): boolean {
  return status === "needs_attention" || status === "disconnected";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function maybeBuildIntegrationBackfillRecovery(
  record: IntegrationHealthRecord,
  polledRecord: IntegrationHealthRecord,
  occurredAt: Date,
  logger: Pick<Console, "info">,
): {
  readonly service: "gmail";
  readonly idempotencyKey: string;
  readonly windowStart: string;
  readonly windowEnd: string;
} | null {
  if (!isDegradedStatus(record.status) || polledRecord.status !== "healthy") {
    return null;
  }

  if (record.degradedSinceAt === null) {
    return null;
  }

  logger.info(
    JSON.stringify({
      event: "integration_health.transition_detected",
      service: record.id,
      prior_status: record.status,
      new_status: polledRecord.status,
      degraded_since_at: record.degradedSinceAt,
      duration_ms: occurredAt.getTime() - Date.parse(record.degradedSinceAt),
    }),
  );

  if (record.id !== integrationBackfillSupportedService) {
    logger.info(
      JSON.stringify({
        event: "integration_backfill.skipped",
        service: record.id,
        reason: "service_not_yet_supported",
      }),
    );
    return null;
  }

  let windowStart = new Date(record.degradedSinceAt);
  const windowEnd = occurredAt;
  const originalWindowStart = windowStart;

  if (windowEnd.getTime() - windowStart.getTime() > integrationBackfillMaxWindowMs) {
    windowStart = new Date(windowEnd.getTime() - integrationBackfillMaxWindowMs);
    logger.info(
      JSON.stringify({
        event: "integration_backfill.window_capped",
        service: record.id,
        original_start: originalWindowStart.toISOString(),
        new_start: windowStart.toISOString(),
      }),
    );
  }

  return {
    service: "gmail",
    idempotencyKey: `gmail:${record.degradedSinceAt}`,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

function isFailedStage1TaskOutcome(
  value: unknown
): value is {
  readonly outcome: "failed";
  readonly syncState: {
    readonly id: string;
    readonly status: string;
  };
  readonly failure?: {
    readonly message: string;
  } | null;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    value.outcome === "failed" &&
    "syncState" in value &&
    typeof value.syncState === "object" &&
    value.syncState !== null &&
    "id" in value.syncState &&
    typeof value.syncState.id === "string" &&
    "status" in value.syncState &&
    typeof value.syncState.status === "string"
  );
}

function createStage1Task<TPayload>(
  parse: (payload: unknown) => TPayload,
  run: (payload: TPayload) => Promise<unknown>
): Task {
  return async (rawPayload: unknown) => {
    const outcome = await run(parse(rawPayload));

    if (isFailedStage1TaskOutcome(outcome)) {
      const message =
        outcome.failure?.message ??
        `Stage 1 job failed for sync state ${outcome.syncState.id}.`;
      const error = new Error(
        `${message} (syncStateId=${outcome.syncState.id}, status=${outcome.syncState.status})`
      );
      error.name = "Stage1TaskOutcomeError";
      throw error;
    }
  };
}

function createPollingTask<TPayload>(
  plan: (now: Date) => Promise<TPayload | null>,
  input: {
    readonly jobName: string;
  }
): Task {
  return async (_rawPayload: unknown, helpers) => {
    const payload = await plan(new Date());

    if (payload === null) {
      return;
    }

    await helpers.addJob(input.jobName, payload, {
      maxAttempts: 1
    });
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isMissingIntegrationHealthTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  return (
    code === "42P01" ||
    /relation ["']?integration_health["']? does not exist/iu.test(message)
  );
}

function readCaptureBaseUrl(
  service: string,
  captureBaseUrls: IntegrationHealthTaskDependencies["captureBaseUrls"]
): string | null {
  switch (service) {
    case "gmail":
      return captureBaseUrls.gmail.trim().length > 0
        ? captureBaseUrls.gmail
        : null;
    case "salesforce":
      return captureBaseUrls.salesforce.trim().length > 0
        ? captureBaseUrls.salesforce
        : null;
    case "mailchimp":
      return captureBaseUrls.mailchimp !== null &&
        captureBaseUrls.mailchimp.trim().length > 0
        ? captureBaseUrls.mailchimp
        : null;
    default:
      return null;
  }
}

function buildUpdatedIntegrationHealthRecord(
  record: IntegrationHealthRecord,
  input: {
    readonly checkedAt: string;
    readonly status: IntegrationHealthRecord["status"];
    readonly detail: string | null;
    readonly metadataJson?: Record<string, unknown>;
  }
): IntegrationHealthRecord {
  return {
    ...record,
    status: input.status,
    lastCheckedAt: input.checkedAt,
    detail: input.detail,
    metadataJson: input.metadataJson ?? record.metadataJson,
    updatedAt: input.checkedAt
  };
}

function isHealthyStatus(status: IntegrationHealthRecord["status"]): boolean {
  return status === "healthy";
}

function shouldSendIntegrationHealthAlert(input: {
  readonly previous: IntegrationHealthRecord;
  readonly next: IntegrationHealthRecord;
  readonly occurredAt: Date;
}): boolean {
  if (isHealthyStatus(input.next.status)) {
    return false;
  }

  // Debounce: suppress the alert until the service has been continuously
  // degraded for at least integrationHealthAlertDebounceMs. The degraded streak
  // starts on the first failed poll — occurredAt when the previous poll was
  // healthy, otherwise the persisted degradedSinceAt carried forward across
  // polls. This filters transient blips that recover before the window closes.
  const degradedSinceMs = isHealthyStatus(input.previous.status)
    ? input.occurredAt.getTime()
    : input.previous.degradedSinceAt !== null
      ? Date.parse(input.previous.degradedSinceAt)
      : input.occurredAt.getTime();

  if (
    Number.isFinite(degradedSinceMs) &&
    input.occurredAt.getTime() - degradedSinceMs <
      integrationHealthAlertDebounceMs
  ) {
    return false;
  }

  // Past the debounce window: alert on the first sustained failure, then
  // re-alert only after the cooldown has elapsed.
  if (input.previous.lastAlertSentAt === null) {
    return true;
  }

  const lastAlertSentAt = Date.parse(input.previous.lastAlertSentAt);

  return (
    Number.isFinite(lastAlertSentAt) &&
    input.occurredAt.getTime() - lastAlertSentAt >=
      integrationHealthAlertCooldownMs
  );
}

function applyIntegrationHealthAlertState(
  previous: IntegrationHealthRecord,
  next: IntegrationHealthRecord,
  input: {
    readonly occurredAt: string;
    readonly alertSent: boolean;
  }
): IntegrationHealthRecord {
  if (isHealthyStatus(next.status)) {
    return {
      ...next,
      degradedSinceAt: null,
      lastAlertSentAt: null
    };
  }

  const degradedSinceAt = isHealthyStatus(previous.status)
    ? input.occurredAt
    : previous.degradedSinceAt ?? input.occurredAt;

  return {
    ...next,
    degradedSinceAt,
    lastAlertSentAt: input.alertSent
      ? input.occurredAt
      : previous.lastAlertSentAt
  };
}

function isSuccessfulGmailSendResult(
  result: Awaited<ReturnType<IntegrationHealthAlertSender["send"]>>
): boolean {
  return result.kind === "success";
}

async function pollIntegrationHealthRecord(
  record: IntegrationHealthRecord,
  input: {
    readonly captureBaseUrls: IntegrationHealthTaskDependencies["captureBaseUrls"];
    readonly fetchImplementation: typeof fetch;
  }
): Promise<IntegrationHealthRecord> {
  const checkedAt = new Date().toISOString();
  const baseUrl = readCaptureBaseUrl(record.id, input.captureBaseUrls);

  if (baseUrl === null) {
    return buildUpdatedIntegrationHealthRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: "Capture service base URL is not configured."
    });
  }

  let response: Response;

  try {
    response = await input.fetchImplementation(new URL("/health", baseUrl), {
      method: "GET",
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    return buildUpdatedIntegrationHealthRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: isAbortError(error)
        ? "Health endpoint timed out."
        : "Health endpoint request failed."
    });
  }

  if (!response.ok) {
    return buildUpdatedIntegrationHealthRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: `Health endpoint returned status ${String(response.status)}.`
    });
  }

  try {
    const payload = integrationHealthCheckResponseSchema.parse(
      JSON.parse(await response.text()) as unknown
    );

    return buildUpdatedIntegrationHealthRecord(record, {
      checkedAt,
      status: payload.status,
      detail: payload.detail,
      metadataJson: {
        ...record.metadataJson,
        checkedAt: payload.checkedAt,
        version: payload.version
      }
    });
  } catch {
    return buildUpdatedIntegrationHealthRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: "Health endpoint returned malformed JSON."
    });
  }
}

function createPollIntegrationHealthTask(
  dependencies: IntegrationHealthTaskDependencies
): Task {
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const alertSender =
    dependencies.alertSender ??
    createIntegrationHealthAlertSenderWithStateRepository({
      env: process.env,
      fetchImplementation,
      stateRepository: dependencies.opsAlertState,
    });
  const logger = dependencies.logger ?? console;

  return async (_payload, helpers) => {
    if (typeof fetchImplementation !== "function") {
      logger.error(
        "Integration health poller skipped because global fetch is unavailable."
      );
      return;
    }

    try {
      await dependencies.integrationHealth.seedDefaults();
    } catch (error) {
      if (isMissingIntegrationHealthTableError(error)) {
        logger.warn(
          "Integration health poller skipped because integration_health is not available yet."
        );
        return;
      }

      throw error;
    }

    for (const service of polledIntegrationServices) {
      let record: IntegrationHealthRecord | null;

      try {
        record = await dependencies.integrationHealth.findById(service);
      } catch (error) {
        if (isMissingIntegrationHealthTableError(error)) {
          logger.warn(
            "Integration health poller skipped because integration_health is not available yet."
          );
          return;
        }

        logger.error(
          `Integration health lookup failed for ${service}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      if (record === null) {
        logger.warn(
          `Integration health seed row was missing for ${service}; skipping this service.`
        );
        continue;
      }

      const polledRecord = await pollIntegrationHealthRecord(record, {
        captureBaseUrls: dependencies.captureBaseUrls,
        fetchImplementation
      });
      const occurredAt = now();
      const occurredAtIso = occurredAt.toISOString();
      const shouldAlert = shouldSendIntegrationHealthAlert({
        previous: record,
        next: polledRecord,
        occurredAt
      });
      let alertSent = false;

      if (shouldAlert) {
        try {
          const sendResult = await alertSender.send({
            service,
            fromStatus: record.status,
            record: polledRecord,
            occurredAt: occurredAtIso
          });

          if (isSuccessfulGmailSendResult(sendResult)) {
            alertSent = true;
            logger.info(
              JSON.stringify({
                event: "integration_health.alert_sent",
                service,
                fromStatus: record.status,
                toStatus: polledRecord.status,
                recipient: readIntegrationHealthAlertRecipient(process.env),
                occurredAt: occurredAtIso
              })
            );
          } else {
            logger.error(
              `Integration health alert email failed for ${service}: ${sendResult.kind}`
            );
          }
        } catch (error) {
          logger.error(
            `Integration health alert email failed for ${service}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const nextRecord = applyIntegrationHealthAlertState(record, polledRecord, {
        occurredAt: occurredAtIso,
        alertSent
      });
      const backfillRecovery = maybeBuildIntegrationBackfillRecovery(
        record,
        polledRecord,
        occurredAt,
        logger,
      );

      if (backfillRecovery !== null) {
        try {
          await enqueueIntegrationBackfillGmailJob({
            persistence: dependencies.persistence,
            addJob: helpers.addJob,
            service: backfillRecovery.service,
            triggeredBy: "integration_health_transition",
            idempotencyKey: backfillRecovery.idempotencyKey,
            windowStart: backfillRecovery.windowStart,
            windowEnd: backfillRecovery.windowEnd,
            mailbox: null,
            logger,
          });
        } catch (error) {
          logger.error(
            JSON.stringify({
              event: "integration_backfill.enqueue_failed",
              service: backfillRecovery.service,
              reason: describeError(error),
              idempotency_key: backfillRecovery.idempotencyKey,
            }),
          );
          continue;
        }
      }

      try {
        await dependencies.integrationHealth.upsert(nextRecord);
      } catch (error) {
        if (isMissingIntegrationHealthTableError(error)) {
          logger.warn(
            "Integration health poller skipped because integration_health is not available yet."
          );
          return;
        }

        logger.error(
          `Integration health upsert failed for ${service}: ${
            describeError(error)
          }`
        );
      }
    }
  };
}

export function createStage1TaskList(
  orchestration: Stage1WorkerOrchestrationService,
  input?: {
    readonly integrationHealth?: IntegrationHealthTaskDependencies;
    readonly aiKnowledgeAutoSync?: PollAiKnowledgeAutoSyncTaskDependencies;
    readonly integrationBackfill?: IntegrationBackfillGmailTaskDependencies;
  }
): TaskList {
  return {
    [gmailHistoricalCaptureBatchJobName]: createStage1Task(
      (payload) => gmailHistoricalCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runGmailHistoricalCaptureBatch(payload)
    ),
    [gmailLiveCaptureBatchJobName]: createStage1Task(
      (payload) => gmailLiveCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runGmailLiveCaptureBatch(payload)
    ),
    [pollGmailLiveJobName]: createPollingTask(
      (now) => orchestration.planGmailLiveCaptureBatch(now),
      {
        jobName: gmailLiveCaptureBatchJobName
      }
    ),
    [salesforceHistoricalCaptureBatchJobName]: createStage1Task(
      (payload) => salesforceHistoricalCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSalesforceHistoricalCaptureBatch(payload)
    ),
    [salesforceLiveCaptureBatchJobName]: createStage1Task(
      (payload) => salesforceLiveCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSalesforceLiveCaptureBatch(payload)
    ),
    [pollSalesforceLiveJobName]: createPollingTask(
      (now) => orchestration.planSalesforceLiveCaptureBatch(now),
      {
        jobName: salesforceLiveCaptureBatchJobName
      }
    ),
    ...(input?.aiKnowledgeAutoSync === undefined
      ? {}
      : {
          [pollAiKnowledgeAutoSyncJobName]: createPollAiKnowledgeAutoSyncTask(
            input.aiKnowledgeAutoSync,
          ),
        }),
    [mailchimpTransitionSchedulerJobName]: async (_rawPayload, helpers) => {
      await orchestration.runMailchimpTransitionSchedulerTick({
        addJob: helpers.addJob,
        now: new Date()
      });
    },
    ...(input?.integrationHealth === undefined
      ? {}
      : {
          [pollIntegrationHealthJobName]: createPollIntegrationHealthTask(
            input.integrationHealth
          )
        }),
    ...(input?.integrationBackfill === undefined
      ? {}
      : {
          [integrationBackfillGmailTaskName]: createIntegrationBackfillGmailTask(
            input.integrationBackfill,
          ),
        }),
    [simpleTextingHistoricalCaptureBatchJobName]: createStage1Task(
      (payload) => simpleTextingHistoricalCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSimpleTextingHistoricalCaptureBatch(payload)
    ),
    [simpleTextingLiveCaptureBatchJobName]: createStage1Task(
      (payload) => simpleTextingLiveCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSimpleTextingLiveCaptureBatch(payload)
    ),
    [mailchimpHistoricalCaptureBatchJobName]: createStage1Task(
      (payload) => mailchimpHistoricalCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runMailchimpHistoricalCaptureBatch(payload)
    ),
    [mailchimpTransitionCaptureBatchJobName]: createStage1Task(
      (payload) => mailchimpTransitionCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runMailchimpTransitionCaptureBatch(payload)
    ),
    [replayBatchJobName]: createStage1Task(
      (payload) => replayBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runReplayBatch(payload)
    ),
    [projectionRebuildBatchJobName]: createStage1Task(
      (payload) => projectionRebuildBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runProjectionRebuildBatch(payload)
    ),
    [parityCheckBatchJobName]: createStage1Task(
      (payload) => parityCheckBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runParityCheckBatch(payload)
    ),
    [cutoverCheckpointBatchJobName]: createStage1Task(
      (payload) => cutoverCheckpointBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runCutoverCheckpointBatch(payload)
    )
  };
}
