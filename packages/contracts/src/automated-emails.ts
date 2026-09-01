import { z } from "zod";

export const automatedEmailKindValues = [
  "application_received",
  "application_nudge",
  "application_submitted",
  "accepted",
  "denied",
  "training_reminder",
  "training_passed",
  "trip_planning",
  "data_reminder",
  "first_record",
  "post_trip",
  "custom",
] as const;

export const automatedEmailKindSchema = z.enum(automatedEmailKindValues);

export const automatedEmailSendStatusValues = [
  "received",
  "sent",
  "duplicate",
  "held",
  "failed",
] as const;

export const automatedEmailSendStatusSchema = z.enum(
  automatedEmailSendStatusValues,
);

const timestampSchema = z.string().datetime();

export const automatedEmailWebhookPayloadSchema = z.object({
  templateId: z.string().uuid(),
  expeditionMemberId: z.string().min(1),
  firedAt: timestampSchema.optional(),
  flowApiName: z.string().optional(),
});

export type AutomatedEmailWebhookPayload = z.infer<
  typeof automatedEmailWebhookPayloadSchema
>;

export const automatedEmailSendJobName = "send-automated-email" as const;
export const automatedEmailSendJobMaxAttempts = 5 as const;
export const automatedEmailSendPayloadSchema = z.object({
  sendId: z.string().uuid(),
});
export type AutomatedEmailSendPayload = z.infer<
  typeof automatedEmailSendPayloadSchema
>;

export const automatedEmailDedupeWindowMs = 24 * 60 * 60 * 1_000;

export const automatedEmailRenderedPreviewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const automatedEmailTemplateRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  kind: automatedEmailKindSchema,
  name: z.string().min(1),
  draftSubject: z.string(),
  draftDoc: z.unknown(),
  publishedSubject: z.string().nullable(),
  publishedDoc: z.unknown().nullable(),
  publishedAt: timestampSchema.nullable(),
  publishedBy: z.string().min(1).nullable(),
  isActive: z.boolean(),
  createdBy: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const automatedEmailSendRecordSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  projectId: z.string().min(1),
  expeditionMemberId: z.string().min(1),
  contactId: z.string().min(1).nullable(),
  status: automatedEmailSendStatusSchema,
  statusReason: z.string().nullable(),
  payload: z.unknown(),
  renderedPreview: automatedEmailRenderedPreviewSchema.nullable(),
  ledgerEventId: z.string().min(1).nullable(),
  providerMessageId: z.string().min(1).nullable(),
  receivedAt: timestampSchema,
  processedAt: timestampSchema.nullable(),
});

export type AutomatedEmailKind = z.infer<typeof automatedEmailKindSchema>;
export type AutomatedEmailSendStatus = z.infer<
  typeof automatedEmailSendStatusSchema
>;
export type AutomatedEmailRenderedPreview = z.infer<
  typeof automatedEmailRenderedPreviewSchema
>;
export type AutomatedEmailTemplateRecord = z.infer<
  typeof automatedEmailTemplateRecordSchema
>;
export type AutomatedEmailSendRecord = z.infer<
  typeof automatedEmailSendRecordSchema
>;
