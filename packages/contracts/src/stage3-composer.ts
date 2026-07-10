import { z } from "zod";

const PROJECT_ALIAS_SIGNATURE_MAX_LENGTH = 2000;
const PLAINTEXT_HTML_TAG_PATTERN = /<[^>]+>/u;

export const composerRecipientSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contact"),
    contactId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("email"),
    emailAddress: z.string().email(),
  }),
]);

export const composerAttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  contentBase64: z.string().min(1),
});

const composerEmailAddressSchema = z.string().trim().email();

const composerBodyPlaintextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "Body is required.",
  });

const composerBodyHtmlSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "HTML body is required.",
  });

const composerSignatureOverrideSchema = z
  .string()
  .max(PROJECT_ALIAS_SIGNATURE_MAX_LENGTH, {
    message: `Signature must be ${String(PROJECT_ALIAS_SIGNATURE_MAX_LENGTH)} characters or fewer.`,
  })
  .refine((value) => !PLAINTEXT_HTML_TAG_PATTERN.test(value), {
    message: "Signature must be plain text only.",
  });

export const composerSendInputSchema = z.object({
  recipient: composerRecipientSchema,
  alias: z.string().email(),
  subject: z.string().trim().min(1),
  bodyPlaintext: composerBodyPlaintextSchema,
  bodyHtml: composerBodyHtmlSchema,
  signatureOverride: composerSignatureOverrideSchema.optional(),
  attachments: z.array(composerAttachmentSchema),
  cc: z.array(composerEmailAddressSchema).optional(),
  bcc: z.array(composerEmailAddressSchema).optional(),
  threadId: z.string().min(1).optional(),
  inReplyToRfc822: z.string().min(1).optional(),
  supersedesPendingId: z.string().min(1).optional(),
});

export type ComposerSendInput = z.input<typeof composerSendInputSchema>;
