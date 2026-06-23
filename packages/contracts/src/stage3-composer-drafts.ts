import { z } from "zod";

const draftIdSchema = z.string().uuid();
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().nullable();
const emailAddressSchema = z.string().trim().email();

export const composerDraftPaneModeValues = [
  "new_draft",
  "replying",
  "forwarding",
] as const;
export const composerDraftPaneModeSchema = z.enum(composerDraftPaneModeValues);
export type ComposerDraftPaneMode = z.infer<
  typeof composerDraftPaneModeSchema
>;

export const composerDraftChannelValues = ["email", "sms", "note"] as const;
export const composerDraftChannelSchema = z.enum(composerDraftChannelValues);
export type ComposerDraftChannel = z.infer<typeof composerDraftChannelSchema>;

export const composerDraftRecipientKindValues = [
  "contact",
  "email",
  "phone",
] as const;
export const composerDraftRecipientKindSchema = z.enum(
  composerDraftRecipientKindValues,
);
export type ComposerDraftRecipientKind = z.infer<
  typeof composerDraftRecipientKindSchema
>;

export const composerDraftAttachmentSchema = z.object({
  filename: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});
export type ComposerDraftAttachment = z.infer<
  typeof composerDraftAttachmentSchema
>;

export const composerDraftForwardContextSchema = z.object({
  originalEntryId: z.string().min(1),
  originalSubject: z.string(),
  originalFromLabel: z.string().min(1),
  originalToLabel: z.string().min(1),
  originalCcLabel: nullableStringSchema,
  originalOccurredAtIso: timestampSchema,
  originalBodyPlaintext: z.string(),
  originalBodyHtml: nullableStringSchema,
  defaultAlias: nullableStringSchema,
});
export type ComposerDraftForwardContext = z.infer<
  typeof composerDraftForwardContextSchema
>;

const composerDraftBaseSchema = z.object({
  actor_id: z.string().min(1),
  pane_mode: composerDraftPaneModeSchema,
  channel: composerDraftChannelSchema,
  recipient_anchor_kind: composerDraftRecipientKindSchema.nullable(),
  recipient_contact_id: nullableStringSchema,
  recipient_email: emailAddressSchema.nullable(),
  recipient_phone: nullableStringSchema,
  subject: z.string(),
  body_plaintext: z.string(),
  body_html: z.string(),
  selected_alias: emailAddressSchema.nullable(),
  cc: z.array(emailAddressSchema).default([]),
  bcc: z.array(emailAddressSchema).default([]),
  attachments: z.array(composerDraftAttachmentSchema).default([]),
  ai_directive: z.string().default(""),
  reply_context_thread_cursor: nullableStringSchema,
  forward_context: composerDraftForwardContextSchema.nullable(),
});

function validateComposerDraft(
  value: z.infer<typeof composerDraftBaseSchema>,
  context: z.RefinementCtx,
): void {
  const hasContactId =
    value.recipient_contact_id !== null && value.recipient_contact_id.length > 0;
  const hasEmail =
    value.recipient_email !== null && value.recipient_email.length > 0;
  const hasPhone =
    value.recipient_phone !== null && value.recipient_phone.length > 0;

  if (value.recipient_anchor_kind === "contact" && !hasContactId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_contact_id"],
      message: "recipient_contact_id is required when recipient_anchor_kind=contact",
    });
  }

  if (value.recipient_anchor_kind === "email" && !hasEmail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_email"],
      message: "recipient_email is required when recipient_anchor_kind=email",
    });
  }

  if (value.recipient_anchor_kind === "phone" && !hasPhone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_phone"],
      message: "recipient_phone is required when recipient_anchor_kind=phone",
    });
  }

  if (value.pane_mode === "replying" && value.reply_context_thread_cursor === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reply_context_thread_cursor"],
      message: "reply_context_thread_cursor is required when pane_mode=replying",
    });
  }

  if (value.pane_mode === "forwarding" && value.forward_context === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["forward_context"],
      message: "forward_context is required when pane_mode=forwarding",
    });
  }
}

export const composerDraftRecordSchema = composerDraftBaseSchema
  .extend({
    id: draftIdSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine(validateComposerDraft);

export const composerDraftUpsertInputSchema = composerDraftBaseSchema.superRefine(
  validateComposerDraft,
);

export const composerDraftIdSchema = draftIdSchema;

export const composerDraftsListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().nullable().optional(),
});

export type ComposerDraftRecord = z.infer<typeof composerDraftRecordSchema>;
export type ComposerDraftRecordInput = z.input<typeof composerDraftRecordSchema>;
export type ComposerDraftUpsertInput = z.infer<
  typeof composerDraftUpsertInputSchema
>;
export type ComposerDraftUpsertInputValue = z.input<
  typeof composerDraftUpsertInputSchema
>;
export type ComposerDraftId = z.infer<typeof composerDraftIdSchema>;
export type ComposerDraftsListInput = z.infer<
  typeof composerDraftsListInputSchema
>;
export type ComposerDraftsListInputValue = z.input<
  typeof composerDraftsListInputSchema
>;
