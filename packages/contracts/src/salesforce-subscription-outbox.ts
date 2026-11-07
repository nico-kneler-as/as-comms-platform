import { z } from "zod";

export const salesforceSubscriptionOutboxEventKindSchema = z.enum([
  "newsletter_opt_out",
  "project_opt_out",
  "all_opt_out",
  "newsletter_signup",
  "hard_bounce",
]);
export type SalesforceSubscriptionOutboxEventKind = z.infer<
  typeof salesforceSubscriptionOutboxEventKindSchema
>;

export const salesforceSubscriptionOutboxStatusSchema = z.enum([
  "pending",
  "sent",
  "parked",
]);
export type SalesforceSubscriptionOutboxStatus = z.infer<
  typeof salesforceSubscriptionOutboxStatusSchema
>;

export const salesforceSubscriptionOutboxRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  contactId: z.string().nullable(),
  eventKind: salesforceSubscriptionOutboxEventKindSchema,
  projectId: z.string().nullable(),
  occurredAt: z.string().datetime(),
  status: salesforceSubscriptionOutboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime(),
  lastErrorKind: z.enum(["transient", "permanent", "permission"]).nullable(),
  lastErrorCode: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  claimedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type SalesforceSubscriptionOutboxRow = z.infer<
  typeof salesforceSubscriptionOutboxRowSchema
>;

export const salesforceSubscriptionPushJobName =
  "salesforce-subscription-push" as const;
