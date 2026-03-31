import { quickAddJob } from "graphile-worker";

import {
  cutoverCheckpointBatchJobName,
  cutoverCheckpointBatchPayloadSchema,
  gmailHistoricalCaptureBatchJobName,
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchJobName,
  gmailLiveCaptureBatchPayloadSchema,
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
  stage1JobVersion,
  stage1LaunchScopeProviderValues,
} from "@as-comms/contracts";
import { z } from "zod";

import {
  buildOperationId,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringArrayFlag,
  readOptionalStringFlag,
  readRequiredFlag,
  type CliFlags
} from "./helpers.js";

type EnqueueableStage1Job =
  | "gmail-historical"
  | "gmail-live"
  | "salesforce-historical"
  | "salesforce-live"
  | "replay"
  | "projection-rebuild"
  | "parity-check"
  | "cutover-checkpoint";

export interface Stage1EnqueueRequest<TPayload = unknown> {
  readonly jobName: string;
  readonly payload: TPayload;
}

function buildCapturePayloadBase(
  flags: CliFlags,
  prefix: string
) {
  return {
    version: stage1JobVersion,
    jobId: readOptionalStringFlag(flags, "job-id") ?? buildOperationId(`${prefix}:job`),
    correlationId:
      readOptionalStringFlag(flags, "correlation-id") ??
      buildOperationId(`${prefix}:correlation`),
    traceId: readOptionalStringFlag(flags, "trace-id"),
    batchId:
      readOptionalStringFlag(flags, "batch-id") ?? buildOperationId(`${prefix}:batch`),
    syncStateId:
      readOptionalStringFlag(flags, "sync-state-id") ??
      buildOperationId(`${prefix}:sync-state`),
    attempt: readOptionalIntegerFlag(flags, "attempt", 1),
    maxAttempts: readOptionalIntegerFlag(flags, "max-attempts", 3),
    cursor: readOptionalStringFlag(flags, "cursor"),
    checkpoint: readOptionalStringFlag(flags, "checkpoint"),
    windowStart: readOptionalStringFlag(flags, "window-start"),
    windowEnd: readOptionalStringFlag(flags, "window-end"),
    recordIds: readOptionalStringArrayFlag(flags, "record-ids"),
    maxRecords: readOptionalIntegerFlag(flags, "max-records", 25)
  };
}

const enqueuedJobSummarySchema = z.object({
  id: z.string().min(1)
});

function buildReplayItems(
  flags: CliFlags
): z.infer<typeof replayBatchPayloadSchema>["items"] {
  const values = readOptionalStringArrayFlag(flags, "items");

  if (values.length === 0) {
    throw new Error(
      "Flag --items is required for replay jobs and must use recordType:recordId pairs."
    );
  }

  return values.map((value) => {
    const [providerRecordType, providerRecordId] = value.split(":");

    if (
      providerRecordType === undefined ||
      providerRecordId === undefined ||
      providerRecordType.trim().length === 0 ||
      providerRecordId.trim().length === 0
    ) {
      throw new Error(
        "Replay items must use recordType:recordId pairs, separated by commas."
      );
    }

    return {
      providerRecordType: providerRecordType.trim(),
      providerRecordId: providerRecordId.trim()
    };
  });
}

export function buildStage1EnqueueRequest(
  job: EnqueueableStage1Job,
  flags: CliFlags,
  now = new Date()
): Stage1EnqueueRequest {
  switch (job) {
    case "gmail-historical":
      return {
        jobName: gmailHistoricalCaptureBatchJobName,
        payload: gmailHistoricalCaptureBatchPayloadSchema.parse({
          ...buildCapturePayloadBase(flags, "stage1:gmail:historical"),
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill"
        })
      };
    case "gmail-live":
      return {
        jobName: gmailLiveCaptureBatchJobName,
        payload: gmailLiveCaptureBatchPayloadSchema.parse({
          ...buildCapturePayloadBase(flags, "stage1:gmail:live"),
          provider: "gmail",
          mode: "live",
          jobType: "live_ingest"
        })
      };
    case "salesforce-historical":
      return {
        jobName: salesforceHistoricalCaptureBatchJobName,
        payload: salesforceHistoricalCaptureBatchPayloadSchema.parse({
          ...buildCapturePayloadBase(flags, "stage1:salesforce:historical"),
          provider: "salesforce",
          mode: "historical",
          jobType: "historical_backfill"
        })
      };
    case "salesforce-live":
      return {
        jobName: salesforceLiveCaptureBatchJobName,
        payload: salesforceLiveCaptureBatchPayloadSchema.parse({
          ...buildCapturePayloadBase(flags, "stage1:salesforce:live"),
          provider: "salesforce",
          mode: "live",
          jobType: "live_ingest"
        })
      };
    case "replay":
      return {
        jobName: replayBatchJobName,
        payload: replayBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId:
            readOptionalStringFlag(flags, "job-id") ??
            buildOperationId("stage1:replay:job"),
          correlationId:
            readOptionalStringFlag(flags, "correlation-id") ??
            buildOperationId("stage1:replay:correlation"),
          traceId: readOptionalStringFlag(flags, "trace-id"),
          batchId:
            readOptionalStringFlag(flags, "batch-id") ??
            buildOperationId("stage1:replay:batch"),
          syncStateId:
            readOptionalStringFlag(flags, "sync-state-id") ??
            buildOperationId("stage1:replay:sync-state"),
          attempt: readOptionalIntegerFlag(flags, "attempt", 1),
          maxAttempts: readOptionalIntegerFlag(flags, "max-attempts", 3),
          provider: readRequiredFlag(flags, "provider"),
          mode: readOptionalStringFlag(flags, "mode") ?? "historical",
          jobType: "dead_letter_reprocess",
          cursor: readOptionalStringFlag(flags, "cursor"),
          checkpoint: readOptionalStringFlag(flags, "checkpoint"),
          windowStart: readOptionalStringFlag(flags, "window-start"),
          windowEnd: readOptionalStringFlag(flags, "window-end"),
          items: buildReplayItems(flags)
        })
      };
    case "projection-rebuild":
      return {
        jobName: projectionRebuildBatchJobName,
        payload: projectionRebuildBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId:
            readOptionalStringFlag(flags, "job-id") ??
            buildOperationId("stage1:projection-rebuild:job"),
          correlationId:
            readOptionalStringFlag(flags, "correlation-id") ??
            buildOperationId("stage1:projection-rebuild:correlation"),
          traceId: readOptionalStringFlag(flags, "trace-id"),
          batchId:
            readOptionalStringFlag(flags, "batch-id") ??
            buildOperationId("stage1:projection-rebuild:batch"),
          syncStateId:
            readOptionalStringFlag(flags, "sync-state-id") ??
            buildOperationId("stage1:projection-rebuild:sync-state"),
          attempt: readOptionalIntegerFlag(flags, "attempt", 1),
          maxAttempts: readOptionalIntegerFlag(flags, "max-attempts", 3),
          jobType: "projection_rebuild",
          projection: readOptionalStringFlag(flags, "projection") ?? "all",
          contactIds: readOptionalStringArrayFlag(flags, "contact-ids"),
          includeReviewOverlayRefresh: readOptionalBooleanFlag(
            flags,
            "include-review-overlay-refresh",
            true
          )
        })
      };
    case "parity-check":
      return {
        jobName: parityCheckBatchJobName,
        payload: parityCheckBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId:
            readOptionalStringFlag(flags, "job-id") ??
            buildOperationId("stage1:parity:job"),
          correlationId:
            readOptionalStringFlag(flags, "correlation-id") ??
            buildOperationId("stage1:parity:correlation"),
          traceId: readOptionalStringFlag(flags, "trace-id"),
          batchId:
            readOptionalStringFlag(flags, "batch-id") ??
            buildOperationId("stage1:parity:batch"),
          syncStateId:
            readOptionalStringFlag(flags, "sync-state-id") ??
            buildOperationId("stage1:parity:sync-state"),
          attempt: readOptionalIntegerFlag(flags, "attempt", 1),
          maxAttempts: readOptionalIntegerFlag(flags, "max-attempts", 3),
          jobType: "parity_snapshot",
          checkpointId:
            readOptionalStringFlag(flags, "checkpoint-id") ??
            buildOperationId("stage1:parity:checkpoint"),
          providers:
            readOptionalStringArrayFlag(flags, "providers").length > 0
              ? readOptionalStringArrayFlag(flags, "providers")
              : [...stage1LaunchScopeProviderValues],
          sampleContactIds: readOptionalStringArrayFlag(flags, "sample-contact-ids"),
          sampleSize: readOptionalIntegerFlag(flags, "sample-size", 25),
          queueParityThresholdPercent: Number.parseFloat(
            readOptionalStringFlag(flags, "queue-parity-threshold-percent") ?? "99.5"
          ),
          timelineParityThresholdPercent: Number.parseFloat(
            readOptionalStringFlag(flags, "timeline-parity-threshold-percent") ??
              "99"
          ),
          evaluatedAt: readOptionalStringFlag(flags, "evaluated-at") ?? now.toISOString()
        })
      };
    case "cutover-checkpoint":
      return {
        jobName: cutoverCheckpointBatchJobName,
        payload: cutoverCheckpointBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId:
            readOptionalStringFlag(flags, "job-id") ??
            buildOperationId("stage1:cutover:job"),
          correlationId:
            readOptionalStringFlag(flags, "correlation-id") ??
            buildOperationId("stage1:cutover:correlation"),
          traceId: readOptionalStringFlag(flags, "trace-id"),
          batchId:
            readOptionalStringFlag(flags, "batch-id") ??
            buildOperationId("stage1:cutover:batch"),
          syncStateId:
            readOptionalStringFlag(flags, "sync-state-id") ??
            buildOperationId("stage1:cutover:sync-state"),
          attempt: readOptionalIntegerFlag(flags, "attempt", 1),
          maxAttempts: readOptionalIntegerFlag(flags, "max-attempts", 3),
          jobType: "final_delta_sync",
          checkpointId:
            readOptionalStringFlag(flags, "checkpoint-id") ??
            buildOperationId("stage1:cutover:checkpoint"),
          providers:
            readOptionalStringArrayFlag(flags, "providers").length > 0
              ? readOptionalStringArrayFlag(flags, "providers")
              : [...stage1LaunchScopeProviderValues],
          evaluatedAt: readOptionalStringFlag(flags, "evaluated-at") ?? now.toISOString(),
          requireHistoricalBackfillComplete: readOptionalBooleanFlag(
            flags,
            "require-historical-backfill-complete",
            true
          ),
          requireLiveIngestCoverage: readOptionalBooleanFlag(
            flags,
            "require-live-ingest-coverage",
            true
          )
        })
      };
  }
}

export async function enqueueStage1Job(input: {
  readonly connectionString: string;
  readonly request: Stage1EnqueueRequest;
}): Promise<{
  readonly jobName: string;
  readonly payload: unknown;
  readonly enqueuedJobId: string;
}> {
  const job = enqueuedJobSummarySchema.parse(
    await quickAddJob(
      {
        connectionString: input.connectionString
      },
      input.request.jobName,
      input.request.payload
    )
  );

  return {
    jobName: input.request.jobName,
    payload: input.request.payload,
    enqueuedJobId: job.id
  };
}
