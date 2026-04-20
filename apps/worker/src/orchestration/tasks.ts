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
import type { IntegrationHealthRepository } from "@as-comms/domain";

import type { Stage1WorkerOrchestrationService } from "./types.js";

export const pollGmailLiveJobName = "poll-gmail-live" as const;
export const pollSalesforceLiveJobName = "poll-salesforce-live" as const;
export const pollIntegrationHealthJobName = "poll-integration-health" as const;
const polledIntegrationServices = [
  "salesforce",
  "gmail"
] as const satisfies readonly IntegrationHealthRecord["id"][];

export interface IntegrationHealthTaskDependencies {
  readonly integrationHealth: IntegrationHealthRepository;
  readonly captureBaseUrls: {
    readonly gmail: string;
    readonly salesforce: string;
  };
  readonly fetchImplementation?: typeof fetch;
  readonly logger?: Pick<Console, "error" | "warn">;
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
  const logger = dependencies.logger ?? console;

  return async () => {
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

      const nextRecord = await pollIntegrationHealthRecord(record, {
        captureBaseUrls: dependencies.captureBaseUrls,
        fetchImplementation
      });

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
            error instanceof Error ? error.message : String(error)
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
    ...(input?.integrationHealth === undefined
      ? {}
      : {
          [pollIntegrationHealthJobName]: createPollIntegrationHealthTask(
            input.integrationHealth
          )
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
