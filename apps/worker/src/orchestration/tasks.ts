import type { Task, TaskList } from "graphile-worker";

import {
  cutoverCheckpointBatchPayloadSchema,
  cutoverCheckpointBatchJobName,
  gmailHistoricalCaptureBatchJobName,
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchJobName,
  gmailLiveCaptureBatchPayloadSchema,
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
  simpleTextingLiveCaptureBatchPayloadSchema
} from "@as-comms/contracts";

import type { Stage1WorkerOrchestrationService } from "./types.js";

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

export function createStage1TaskList(
  orchestration: Stage1WorkerOrchestrationService
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
    [salesforceHistoricalCaptureBatchJobName]: createStage1Task(
      (payload) => salesforceHistoricalCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSalesforceHistoricalCaptureBatch(payload)
    ),
    [salesforceLiveCaptureBatchJobName]: createStage1Task(
      (payload) => salesforceLiveCaptureBatchPayloadSchema.parse(payload),
      (payload) => orchestration.runSalesforceLiveCaptureBatch(payload)
    ),
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
