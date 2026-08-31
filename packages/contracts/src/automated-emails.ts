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
