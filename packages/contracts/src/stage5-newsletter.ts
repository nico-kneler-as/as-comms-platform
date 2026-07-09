import { z } from "zod";

const newsletterEmailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const nullableStringSchema = z.string().nullable();
const newsletterSubscriberStatusSchema = z.string().min(1);
const newsletterSourceSchema = z.string().min(1);
const optionalSignupNameSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).max(120).optional());
const optionalWebsiteSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string().max(512).optional());

export const newsletterSuppressionReasonSchema = z.enum([
  "unsubscribed",
  "cleaned",
  "platform_optout",
]);

export const newsletterSubscriberRecordSchema = z.object({
  id: z.string().uuid(),
  email: newsletterEmailSchema,
  firstName: nullableStringSchema,
  lastName: nullableStringSchema,
  status: newsletterSubscriberStatusSchema,
  memberRating: z.number().int().min(1).max(5).nullable(),
  optinTime: nullableTimestampSchema,
  optinIp: nullableStringSchema,
  confirmTime: nullableTimestampSchema,
  confirmIp: nullableStringSchema,
  lastChangedAt: nullableTimestampSchema,
  interests: nullableStringSchema,
  tags: nullableStringSchema,
  source: newsletterSourceSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const upsertNewsletterSubscriberInputSchema = z.object({
  email: newsletterEmailSchema,
  firstName: nullableStringSchema.optional(),
  lastName: nullableStringSchema.optional(),
  status: newsletterSubscriberStatusSchema.optional(),
  memberRating: z.number().int().min(1).max(5).nullable().optional(),
  optinTime: nullableTimestampSchema.optional(),
  optinIp: nullableStringSchema.optional(),
  confirmTime: nullableTimestampSchema.optional(),
  confirmIp: nullableStringSchema.optional(),
  lastChangedAt: nullableTimestampSchema.optional(),
  interests: nullableStringSchema.optional(),
  tags: nullableStringSchema.optional(),
  source: newsletterSourceSchema.optional(),
});

export const newsletterSuppressionRecordSchema = z.object({
  id: z.string().uuid(),
  email: newsletterEmailSchema,
  reason: newsletterSuppressionReasonSchema,
  source: newsletterSourceSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const upsertNewsletterSuppressionInputSchema = z.object({
  email: newsletterEmailSchema,
  reason: newsletterSuppressionReasonSchema,
  source: newsletterSourceSchema,
});

export const newsletterSignupRequestSchema = z
  .object({
    email: newsletterEmailSchema,
    firstName: optionalSignupNameSchema,
    lastName: optionalSignupNameSchema,
    website: optionalWebsiteSchema,
  })
  .strict();

export const newsletterSignupSuccessSchema = z.object({
  ok: z.literal(true),
  requestId: z.string().min(1),
});

export const newsletterSignupErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

export const newsletterSignupResponseSchema = z.union([
  newsletterSignupSuccessSchema,
  newsletterSignupErrorSchema,
]);

export type NewsletterSuppressionReason = z.infer<
  typeof newsletterSuppressionReasonSchema
>;
export type NewsletterSubscriberRecord = z.infer<
  typeof newsletterSubscriberRecordSchema
>;
export type NewsletterSubscriberRecordInput = z.input<
  typeof newsletterSubscriberRecordSchema
>;
export type UpsertNewsletterSubscriberInput = z.infer<
  typeof upsertNewsletterSubscriberInputSchema
>;
export type UpsertNewsletterSubscriberInputValue = z.input<
  typeof upsertNewsletterSubscriberInputSchema
>;
export type NewsletterSuppressionRecord = z.infer<
  typeof newsletterSuppressionRecordSchema
>;
export type NewsletterSuppressionRecordInput = z.input<
  typeof newsletterSuppressionRecordSchema
>;
export type UpsertNewsletterSuppressionInput = z.infer<
  typeof upsertNewsletterSuppressionInputSchema
>;
export type UpsertNewsletterSuppressionInputValue = z.input<
  typeof upsertNewsletterSuppressionInputSchema
>;
export type NewsletterSignupRequest = z.infer<
  typeof newsletterSignupRequestSchema
>;
export type NewsletterSignupRequestValue = z.input<
  typeof newsletterSignupRequestSchema
>;
export type NewsletterSignupSuccess = z.infer<
  typeof newsletterSignupSuccessSchema
>;
export type NewsletterSignupError = z.infer<typeof newsletterSignupErrorSchema>;
export type NewsletterSignupResponse = z.infer<
  typeof newsletterSignupResponseSchema
>;
