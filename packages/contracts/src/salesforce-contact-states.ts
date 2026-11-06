import { z } from "zod";

export const salesforceContactStatesCaptureRequestSchema = z.object({
  version: z.literal(1).default(1),
});
export type SalesforceContactStatesCaptureRequest = z.infer<
  typeof salesforceContactStatesCaptureRequestSchema
>;

export const salesforceContactStateRowSchema = z.object({
  salesforceContactId: z.string().min(1),
  email: z.string().trim().min(1),
  rawState: z.string(),
  lastModifiedAt: z.string().datetime(),
});
export type SalesforceContactStateRow = z.infer<
  typeof salesforceContactStateRowSchema
>;

export const salesforceContactStatesSnapshotSchema = z.object({
  rows: z.array(salesforceContactStateRowSchema),
  capturedAt: z.string().datetime(),
});
export type SalesforceContactStatesSnapshot = z.infer<
  typeof salesforceContactStatesSnapshotSchema
>;

export const salesforceContactStatesCaptureResponseSchema =
  salesforceContactStatesSnapshotSchema;
export type SalesforceContactStatesCaptureResponse = z.infer<
  typeof salesforceContactStatesCaptureResponseSchema
>;

export const salesforceContactStatesSyncPayloadSchema = z.object({
  version: z.literal(1).default(1),
});
export type SalesforceContactStatesSyncPayload = z.infer<
  typeof salesforceContactStatesSyncPayloadSchema
>;

export const salesforceContactStatesSyncJobName =
  "salesforce-contact-states-sync" as const;
export const salesforceContactStatesSyncJobMaxAttempts = 3;
