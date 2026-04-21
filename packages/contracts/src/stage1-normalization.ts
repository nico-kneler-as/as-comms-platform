import { z } from "zod";

import {
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  inboxProjectionSchema,
  mailchimpCampaignActivityDetailSchema,
  manualNoteDetailSchema,
  projectDimensionSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  communicationCampaignRefSchema,
  communicationThreadRefSchema,
  simpleTextingMessageDetailSchema,
  sourceEvidenceSchema,
  syncStateSchema
} from "./stage1-records.js";
import {
  canonicalEventTypeSchema,
  communicationDirectionSchema,
  communicationMessageKindSchema,
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
  expeditionId: nullableStringSchema.default(null),
  projectName: nullableStringSchema.default(null),
  expeditionName: nullableStringSchema.default(null)
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
  memberships: z.array(contactMembershipSchema).default([]),
  projectDimensions: z.array(projectDimensionSchema).default([]),
  expeditionDimensions: z.array(expeditionDimensionSchema).default([])
});
export type NormalizedContactGraphUpsertInput = z.input<
  typeof normalizedContactGraphUpsertInputSchema
>;

export const supportingSourceReferenceSchema = z.object({
  provider: providerSchema,
  sourceEvidenceId: idSchema
});
export type SupportingSourceReference = z.infer<
  typeof supportingSourceReferenceSchema
>;

export const communicationClassificationSchema = z.object({
  messageKind: communicationMessageKindSchema,
  sourceRecordType: z.string().min(1),
  sourceRecordId: z.string().min(1),
  campaignRef: communicationCampaignRefSchema.nullable().default(null),
  threadRef: communicationThreadRefSchema.nullable().default(null),
  direction: communicationDirectionSchema.nullable().default(null)
});
export type CommunicationClassification = z.infer<
  typeof communicationClassificationSchema
>;

export const normalizedCanonicalEventPayloadSchema = z.object({
  id: idSchema,
  eventType: canonicalEventTypeSchema,
  occurredAt: timestampSchema,
  contentFingerprint: nullableStringSchema.default(null),
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
    supportingSources: z.array(supportingSourceReferenceSchema).default([]),
    communicationClassification: communicationClassificationSchema.optional(),
    gmailMessageDetail: gmailMessageDetailSchema.optional(),
    salesforceCommunicationDetail: salesforceCommunicationDetailSchema.optional(),
    simpleTextingMessageDetail: simpleTextingMessageDetailSchema.optional(),
    mailchimpCampaignActivityDetail:
      mailchimpCampaignActivityDetailSchema.optional(),
    manualNoteDetail: manualNoteDetailSchema.optional(),
    salesforceEventContext: salesforceEventContextSchema.optional(),
    projectDimensions: z.array(projectDimensionSchema).default([]),
    expeditionDimensions: z.array(expeditionDimensionSchema).default([])
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

    if (
      value.gmailMessageDetail !== undefined &&
      value.gmailMessageDetail.sourceEvidenceId !== value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "gmailMessageDetail.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.gmailMessageDetail !== undefined &&
      value.sourceEvidence.provider !== "gmail"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gmailMessageDetail is only valid for Gmail source evidence"
      });
    }

    if (
      value.salesforceCommunicationDetail !== undefined &&
      value.salesforceCommunicationDetail.sourceEvidenceId !== value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "salesforceCommunicationDetail.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.salesforceCommunicationDetail !== undefined &&
      value.sourceEvidence.provider !== "salesforce"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "salesforceCommunicationDetail is only valid for Salesforce source evidence"
      });
    }

    if (
      value.simpleTextingMessageDetail !== undefined &&
      value.simpleTextingMessageDetail.sourceEvidenceId !== value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "simpleTextingMessageDetail.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.simpleTextingMessageDetail !== undefined &&
      value.sourceEvidence.provider !== "simpletexting"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "simpleTextingMessageDetail is only valid for SimpleTexting source evidence"
      });
    }

    if (
      value.mailchimpCampaignActivityDetail !== undefined &&
      value.mailchimpCampaignActivityDetail.sourceEvidenceId !==
        value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "mailchimpCampaignActivityDetail.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.mailchimpCampaignActivityDetail !== undefined &&
      value.sourceEvidence.provider !== "mailchimp"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "mailchimpCampaignActivityDetail is only valid for Mailchimp source evidence"
      });
    }

    if (
      value.manualNoteDetail !== undefined &&
      value.manualNoteDetail.sourceEvidenceId !== value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "manualNoteDetail.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.manualNoteDetail !== undefined &&
      value.sourceEvidence.provider !== "manual"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "manualNoteDetail is only valid for manual source evidence"
      });
    }

    if (
      value.salesforceEventContext !== undefined &&
      value.salesforceEventContext.sourceEvidenceId !== value.sourceEvidence.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "salesforceEventContext.sourceEvidenceId must match sourceEvidence.id"
      });
    }

    if (
      value.salesforceEventContext !== undefined &&
      value.sourceEvidence.provider !== "salesforce"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "salesforceEventContext is only valid for Salesforce source evidence"
      });
    }
  });
export type NormalizedCanonicalEventIntake = z.input<
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
