import { z } from "zod";

export const opsDigestWatermarkId = "daily_ops_digest" as const;

const timestampSchema = z.string().datetime();

export const opsDigestHighWaterMarkSchema = z.object({
  id: z.string().min(1),
  timestamp: timestampSchema,
});
export type OpsDigestHighWaterMark = z.infer<
  typeof opsDigestHighWaterMarkSchema
>;

export const opsDigestSyncStateDeadLetterCountsSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .default({});
export type OpsDigestSyncStateDeadLetterCounts = z.infer<
  typeof opsDigestSyncStateDeadLetterCountsSchema
>;

export const opsDigestWatermarkRecordSchema = z.object({
  id: z.literal(opsDigestWatermarkId),
  lastRunAt: timestampSchema.nullable(),
  lastDigestSentAt: timestampSchema.nullable(),
  quietStreakStartedAt: timestampSchema.nullable(),
  syncStateDeadLetterCounts: opsDigestSyncStateDeadLetterCountsSchema,
  postmarkWebhookDeadLetter: opsDigestHighWaterMarkSchema.nullable(),
  identityResolutionQueue: opsDigestHighWaterMarkSchema.nullable(),
  routingReviewQueue: opsDigestHighWaterMarkSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type OpsDigestWatermarkRecord = z.infer<
  typeof opsDigestWatermarkRecordSchema
>;
