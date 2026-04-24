import { z } from "zod";

import { providerSchema } from "./stage1-taxonomy.js";
import type { Provider, SyncJobType } from "./stage1-taxonomy.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const nullableStringSchema = z.string().min(1).nullable();

export const stage1JobVersion = 1 as const;
const stage1JobVersionSchema = z.literal(stage1JobVersion);

export const stage1OrchestrationModeValues = [
  "historical",
  "live",
  "transition_live"
] as const;
export const stage1OrchestrationModeSchema = z.enum(
  stage1OrchestrationModeValues
);
export type Stage1OrchestrationMode = z.infer<
  typeof stage1OrchestrationModeSchema
>;

export const stage1LaunchScopeProviderValues = [
  "gmail",
  "salesforce"
] as const;

const captureBatchPayloadBaseSchema = z.object({
  version: stage1JobVersionSchema,
  jobId: idSchema,
  correlationId: idSchema,
  traceId: nullableStringSchema.default(null),
  batchId: idSchema,
  syncStateId: idSchema,
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(3),
  cursor: nullableStringSchema.default(null),
  checkpoint: nullableStringSchema.default(null),
  windowStart: nullableTimestampSchema.default(null),
  windowEnd: nullableTimestampSchema.default(null),
  recordIds: z.array(idSchema).default([]),
  maxRecords: z.number().int().positive().max(1000).default(100)
});

function defineCapturePayloadSchema(input: {
  readonly provider: Provider;
  readonly mode: Stage1OrchestrationMode;
  readonly jobType: SyncJobType;
}) {
  return captureBatchPayloadBaseSchema.extend({
    provider: z.literal(input.provider),
    mode: z.literal(input.mode),
    jobType: z.literal(input.jobType)
  });
}

export const gmailHistoricalCaptureBatchJobName =
  "stage1.gmail.capture.historical" as const;
export const gmailLiveCaptureBatchJobName = "stage1.gmail.capture.live" as const;
export const salesforceHistoricalCaptureBatchJobName =
  "stage1.salesforce.capture.historical" as const;
export const salesforceLiveCaptureBatchJobName =
  "stage1.salesforce.capture.live" as const;
export const simpleTextingHistoricalCaptureBatchJobName =
  "stage1.simpletexting.capture.historical" as const;
export const simpleTextingLiveCaptureBatchJobName =
  "stage1.simpletexting.capture.live" as const;
export const mailchimpHistoricalCaptureBatchJobName =
  "stage1.mailchimp.capture.historical" as const;
export const mailchimpTransitionCaptureBatchJobName =
  "stage1.mailchimp.capture.transition" as const;
export const replayBatchJobName = "stage1.replay.batch" as const;
export const projectionRebuildBatchJobName =
  "stage1.projection.rebuild" as const;
export const parityCheckBatchJobName = "stage1.parity.check" as const;
export const cutoverCheckpointBatchJobName =
  "stage1.cutover.checkpoint" as const;
export const bootstrapProjectKnowledgeJobName =
  "bootstrap-project-knowledge" as const;

export const stage1WorkerJobNames = [
  gmailHistoricalCaptureBatchJobName,
  gmailLiveCaptureBatchJobName,
  salesforceHistoricalCaptureBatchJobName,
  salesforceLiveCaptureBatchJobName,
  simpleTextingHistoricalCaptureBatchJobName,
  simpleTextingLiveCaptureBatchJobName,
  mailchimpHistoricalCaptureBatchJobName,
  mailchimpTransitionCaptureBatchJobName,
  replayBatchJobName,
  projectionRebuildBatchJobName,
  parityCheckBatchJobName,
  cutoverCheckpointBatchJobName
] as const;

export const gmailHistoricalCaptureBatchPayloadSchema = defineCapturePayloadSchema(
  {
    provider: "gmail",
    mode: "historical",
    jobType: "historical_backfill"
  }
);
export type GmailHistoricalCaptureBatchPayload = z.infer<
  typeof gmailHistoricalCaptureBatchPayloadSchema
>;

export const gmailLiveCaptureBatchPayloadSchema = defineCapturePayloadSchema({
  provider: "gmail",
  mode: "live",
  jobType: "live_ingest"
});
export type GmailLiveCaptureBatchPayload = z.infer<
  typeof gmailLiveCaptureBatchPayloadSchema
>;

export const salesforceHistoricalCaptureBatchPayloadSchema =
  defineCapturePayloadSchema({
    provider: "salesforce",
    mode: "historical",
    jobType: "historical_backfill"
  });
export type SalesforceHistoricalCaptureBatchPayload = z.infer<
  typeof salesforceHistoricalCaptureBatchPayloadSchema
>;

export const salesforceLiveCaptureBatchPayloadSchema = defineCapturePayloadSchema(
  {
    provider: "salesforce",
    mode: "live",
    jobType: "live_ingest"
  }
);
export type SalesforceLiveCaptureBatchPayload = z.infer<
  typeof salesforceLiveCaptureBatchPayloadSchema
>;

export const simpleTextingHistoricalCaptureBatchPayloadSchema =
  defineCapturePayloadSchema({
    provider: "simpletexting",
    mode: "historical",
    jobType: "historical_backfill"
  });
export type SimpleTextingHistoricalCaptureBatchPayload = z.infer<
  typeof simpleTextingHistoricalCaptureBatchPayloadSchema
>;

export const simpleTextingLiveCaptureBatchPayloadSchema =
  defineCapturePayloadSchema({
    provider: "simpletexting",
    mode: "live",
    jobType: "live_ingest"
  });
export type SimpleTextingLiveCaptureBatchPayload = z.infer<
  typeof simpleTextingLiveCaptureBatchPayloadSchema
>;

export const mailchimpHistoricalCaptureBatchPayloadSchema =
  defineCapturePayloadSchema({
    provider: "mailchimp",
    mode: "historical",
    jobType: "historical_backfill"
  });
export type MailchimpHistoricalCaptureBatchPayload = z.infer<
  typeof mailchimpHistoricalCaptureBatchPayloadSchema
>;

export const mailchimpTransitionCaptureBatchPayloadSchema =
  defineCapturePayloadSchema({
    provider: "mailchimp",
    mode: "transition_live",
    jobType: "live_ingest"
  });
export type MailchimpTransitionCaptureBatchPayload = z.infer<
  typeof mailchimpTransitionCaptureBatchPayloadSchema
>;

export const replayBatchItemSchema = z.object({
  providerRecordType: z.string().min(1),
  providerRecordId: z.string().min(1)
});
export type ReplayBatchItem = z.infer<typeof replayBatchItemSchema>;

export const replayBatchPayloadSchema = z.object({
  version: stage1JobVersionSchema,
  jobId: idSchema,
  correlationId: idSchema,
  traceId: nullableStringSchema.default(null),
  batchId: idSchema,
  syncStateId: idSchema,
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(3),
  provider: providerSchema,
  mode: stage1OrchestrationModeSchema,
  jobType: z.literal("dead_letter_reprocess"),
  cursor: nullableStringSchema.default(null),
  checkpoint: nullableStringSchema.default(null),
  windowStart: nullableTimestampSchema.default(null),
  windowEnd: nullableTimestampSchema.default(null),
  items: z.array(replayBatchItemSchema).min(1)
});
export type ReplayBatchPayload = z.infer<typeof replayBatchPayloadSchema>;

export const projectionRebuildTargetValues = ["timeline", "inbox", "all"] as const;
export const projectionRebuildTargetSchema = z.enum(
  projectionRebuildTargetValues
);
export type ProjectionRebuildTarget = z.infer<
  typeof projectionRebuildTargetSchema
>;

export const projectionRebuildBatchPayloadSchema = z.object({
  version: stage1JobVersionSchema,
  jobId: idSchema,
  correlationId: idSchema,
  traceId: nullableStringSchema.default(null),
  batchId: idSchema,
  syncStateId: idSchema,
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(3),
  jobType: z.literal("projection_rebuild"),
  projection: projectionRebuildTargetSchema,
  contactIds: z.array(idSchema).default([]),
  includeReviewOverlayRefresh: z.boolean().default(true)
});
export type ProjectionRebuildBatchPayload = z.infer<
  typeof projectionRebuildBatchPayloadSchema
>;

export const parityCheckBatchPayloadSchema = z.object({
  version: stage1JobVersionSchema,
  jobId: idSchema,
  correlationId: idSchema,
  traceId: nullableStringSchema.default(null),
  batchId: idSchema,
  syncStateId: idSchema,
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(3),
  jobType: z.literal("parity_snapshot"),
  checkpointId: idSchema,
  providers: z
    .array(providerSchema)
    .min(1)
    .default([...stage1LaunchScopeProviderValues]),
  sampleContactIds: z.array(idSchema).default([]),
  sampleSize: z.number().int().positive().max(500).default(25),
  queueParityThresholdPercent: z.number().min(0).max(100).default(99.5),
  timelineParityThresholdPercent: z.number().min(0).max(100).default(99.0),
  evaluatedAt: timestampSchema
});
export type ParityCheckBatchPayload = z.infer<
  typeof parityCheckBatchPayloadSchema
>;

export const cutoverCheckpointBatchPayloadSchema = z.object({
  version: stage1JobVersionSchema,
  jobId: idSchema,
  correlationId: idSchema,
  traceId: nullableStringSchema.default(null),
  batchId: idSchema,
  syncStateId: idSchema,
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(3),
  jobType: z.literal("final_delta_sync"),
  checkpointId: idSchema,
  providers: z
    .array(providerSchema)
    .min(1)
    .default([...stage1LaunchScopeProviderValues]),
  evaluatedAt: timestampSchema,
  requireHistoricalBackfillComplete: z.boolean().default(true),
  requireLiveIngestCoverage: z.boolean().default(true)
});
export type CutoverCheckpointBatchPayload = z.infer<
  typeof cutoverCheckpointBatchPayloadSchema
>;

export const bootstrapProjectKnowledgePayloadSchema = z.object({
  runId: idSchema,
  projectId: idSchema,
  force: z.boolean().default(false),
});
export type BootstrapProjectKnowledgePayload = z.infer<
  typeof bootstrapProjectKnowledgePayloadSchema
>;
