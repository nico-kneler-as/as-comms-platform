import { z } from "zod";

import {
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  inboxProjectionSchema,
  sourceEvidenceSchema,
  syncStateSchema
} from "./stage1-records.js";
import {
  canonicalEventTypeSchema,
  contactIdentityKindSchema,
  identityResolutionReasonCodeSchema,
  providerSchema,
  reviewCaseStatusSchema,
  routingReviewReasonCodeSchema
} from "./stage1-taxonomy.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().min(1).nullable();
const stringArraySchema = z.array(z.string().min(1));

export const normalizedIdentityEvidenceSchema = z
  .object({
    salesforceContactId: nullableStringSchema.default(null),
    volunteerIdPlainValues: stringArraySchema.default([]),
    normalizedEmails: stringArraySchema.default([]),
    normalizedPhones: stringArraySchema.default([])
  })
  .superRefine((value, context) => {
    const totalSignalCount =
      value.volunteerIdPlainValues.length +
      value.normalizedEmails.length +
      value.normalizedPhones.length +
      (value.salesforceContactId === null ? 0 : 1);

    if (totalSignalCount === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one identity signal is required"
      });
    }
  });
export type NormalizedIdentityEvidence = z.infer<
  typeof normalizedIdentityEvidenceSchema
>;

export const normalizedRoutingContextSchema = z.object({
  required: z.boolean().default(false),
  projectId: nullableStringSchema.default(null),
  expeditionId: nullableStringSchema.default(null)
});
export type NormalizedRoutingContext = z.infer<
  typeof normalizedRoutingContextSchema
>;

export const normalizedSourceEvidenceIntakeSchema = z.object({
  sourceEvidence: sourceEvidenceSchema
});
export type NormalizedSourceEvidenceIntake = z.infer<
  typeof normalizedSourceEvidenceIntakeSchema
>;

export const normalizedContactGraphUpsertInputSchema = z.object({
  contact: contactSchema,
  identities: z.array(contactIdentitySchema).default([]),
  memberships: z.array(contactMembershipSchema).default([])
});
export type NormalizedContactGraphUpsertInput = z.infer<
  typeof normalizedContactGraphUpsertInputSchema
>;

export const supportingSourceReferenceSchema = z.object({
  provider: providerSchema,
  sourceEvidenceId: idSchema
});
export type SupportingSourceReference = z.infer<
  typeof supportingSourceReferenceSchema
>;

export const normalizedCanonicalEventPayloadSchema = z.object({
  id: idSchema,
  eventType: canonicalEventTypeSchema,
  occurredAt: timestampSchema,
  idempotencyKey: z.string().min(1),
  summary: z.string().min(1),
  snippet: z.string().default("")
});
export type NormalizedCanonicalEventPayload = z.infer<
  typeof normalizedCanonicalEventPayloadSchema
>;

export const normalizedCanonicalEventIntakeSchema = z
  .object({
    sourceEvidence: sourceEvidenceSchema,
    canonicalEvent: normalizedCanonicalEventPayloadSchema,
    identity: normalizedIdentityEvidenceSchema,
    routing: normalizedRoutingContextSchema.optional(),
    supportingSources: z.array(supportingSourceReferenceSchema).default([])
  })
  .superRefine((value, context) => {
    const supportingIds = value.supportingSources.map(
      (entry) => entry.sourceEvidenceId
    );

    if (supportingIds.includes(value.sourceEvidence.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supportingSources must not repeat the primary source evidence"
      });
    }

    if (new Set(supportingIds).size !== supportingIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supporting source evidence references must be unique"
      });
    }
  });
export type NormalizedCanonicalEventIntake = z.infer<
  typeof normalizedCanonicalEventIntakeSchema
>;

export const identityAmbiguityInputSchema = z.object({
  sourceEvidenceId: idSchema,
  candidateContactIds: stringArraySchema.default([]),
  reasonCode: identityResolutionReasonCodeSchema,
  status: reviewCaseStatusSchema.default("open"),
  openedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable().default(null),
  normalizedIdentityValues: stringArraySchema.default([]),
  anchoredContactId: idSchema.nullable().default(null),
  explanation: z.string().min(1)
});
export type IdentityAmbiguityInput = z.infer<
  typeof identityAmbiguityInputSchema
>;

export const routingAmbiguityInputSchema = z.object({
  contactId: idSchema,
  sourceEvidenceId: idSchema,
  reasonCode: routingReviewReasonCodeSchema,
  status: reviewCaseStatusSchema.default("open"),
  openedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable().default(null),
  candidateMembershipIds: stringArraySchema.default([]),
  explanation: z.string().min(1)
});
export type RoutingAmbiguityInput = z.infer<
  typeof routingAmbiguityInputSchema
>;

export const timelineProjectionApplyInputSchema = z.object({
  canonicalEvent: canonicalEventSchema,
  summary: z.string().min(1)
});
export type TimelineProjectionApplyInput = z.infer<
  typeof timelineProjectionApplyInputSchema
>;

export const inboxProjectionApplyInputSchema = z.object({
  canonicalEvent: canonicalEventSchema,
  snippet: z.string()
});
export type InboxProjectionApplyInput = z.infer<
  typeof inboxProjectionApplyInputSchema
>;

export const inboxReviewOverlayRefreshInputSchema = z.object({
  contactId: idSchema
});
export type InboxReviewOverlayRefreshInput = z.infer<
  typeof inboxReviewOverlayRefreshInputSchema
>;

export const syncStateUpdateInputSchema = z.object({
  syncState: syncStateSchema
});
export type SyncStateUpdateInput = z.infer<typeof syncStateUpdateInputSchema>;

export const contactIdentityLookupInputSchema = z.object({
  kind: contactIdentityKindSchema,
  normalizedValue: z.string().min(1)
});
export type ContactIdentityLookupInput = z.infer<
  typeof contactIdentityLookupInputSchema
>;

export const inboxProjectionSnapshotSchema = z.object({
  projection: inboxProjectionSchema.nullable()
});
export type InboxProjectionSnapshot = z.infer<
  typeof inboxProjectionSnapshotSchema
>;
