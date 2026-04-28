import { z } from "zod";

import {
  auditActorTypeSchema,
  auditResultSchema,
  campaignEmailActivityTypeSchema,
  canonicalEventTypeSchema,
  channelSchema,
  communicationDirectionSchema,
  communicationMessageKindSchema,
  contactIdentityKindSchema,
  identityResolutionReasonCodeSchema,
  inboxBucketSchema,
  inboxDrivingEventTypeSchema,
  provenanceWinnerReasonSchema,
  providerSchema,
  recordSourceSchema,
  resolveCanonicalChannel,
  reviewCaseStatusSchema,
  reviewStateSchema,
  routingReviewReasonCodeSchema,
  syncScopeSchema,
  syncJobTypeSchema,
  syncStatusSchema,
} from "./stage1-taxonomy.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const optionalTimestampSchema = timestampSchema.nullable();
const optionalIdSchema = idSchema.nullable();
const stringArraySchema = z.array(z.string().min(1));
const metadataJsonSchema = z.record(z.string(), z.unknown());
const nullableStringSchema = z.string().min(1).nullable();

export const communicationCampaignRefSchema = z.object({
  providerCampaignId: nullableStringSchema.default(null),
  providerAudienceId: nullableStringSchema.default(null),
  providerMessageName: nullableStringSchema.default(null),
});
export type CommunicationCampaignRef = z.infer<
  typeof communicationCampaignRefSchema
>;

export const communicationThreadRefSchema = z.object({
  crossProviderCollapseKey: nullableStringSchema.default(null),
  providerThreadId: nullableStringSchema.default(null),
});
export type CommunicationThreadRef = z.infer<
  typeof communicationThreadRefSchema
>;

// Stage 1 intentionally keeps provenance serialization compact and explicit.
export const canonicalEventProvenanceSchema = z.object({
  primaryProvider: providerSchema,
  primarySourceEvidenceId: idSchema,
  supportingSourceEvidenceIds: stringArraySchema.default([]),
  winnerReason: provenanceWinnerReasonSchema,
  sourceRecordType: nullableStringSchema.default(null),
  sourceRecordId: nullableStringSchema.default(null),
  messageKind: communicationMessageKindSchema.nullable().default(null),
  campaignRef: communicationCampaignRefSchema.nullable().default(null),
  threadRef: communicationThreadRefSchema.nullable().default(null),
  direction: communicationDirectionSchema.nullable().default(null),
  inboxProjectionExclusionReason: z
    .enum(["forwarded_chain"])
    .nullable()
    .optional(),
  notes: z.string().min(1).nullable().optional(),
});
export type CanonicalEventProvenance = z.infer<
  typeof canonicalEventProvenanceSchema
>;

export const sourceEvidenceSchema = z.object({
  id: idSchema,
  provider: providerSchema,
  providerRecordType: z.string().min(1),
  providerRecordId: z.string().min(1),
  receivedAt: timestampSchema,
  occurredAt: timestampSchema,
  payloadRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  checksum: z.string().min(1),
});
export type SourceEvidenceRecord = z.infer<typeof sourceEvidenceSchema>;

export const canonicalEventSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    eventType: canonicalEventTypeSchema,
    channel: channelSchema,
    occurredAt: timestampSchema,
    contentFingerprint: nullableStringSchema.default(null),
    sourceEvidenceId: idSchema,
    idempotencyKey: z.string().min(1),
    provenance: canonicalEventProvenanceSchema,
    reviewState: reviewStateSchema,
  })
  .superRefine((value, context) => {
    if (value.channel !== resolveCanonicalChannel(value.eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel must match the canonical event type",
      });
    }

    if (value.sourceEvidenceId !== value.provenance.primarySourceEvidenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "sourceEvidenceId must match provenance.primarySourceEvidenceId",
      });
    }
  });
export type CanonicalEventRecord = z.infer<typeof canonicalEventSchema>;

export const contactSchema = z.object({
  id: idSchema,
  salesforceContactId: z.string().min(1).nullable(),
  displayName: z.string().min(1),
  primaryEmail: z.string().min(1).nullable(),
  primaryPhone: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ContactRecord = z.infer<typeof contactSchema>;

export const contactIdentitySchema = z.object({
  id: idSchema,
  contactId: idSchema,
  kind: contactIdentityKindSchema,
  normalizedValue: z.string().min(1),
  isPrimary: z.boolean(),
  source: recordSourceSchema,
  verifiedAt: optionalTimestampSchema,
});
export type ContactIdentityRecord = z.infer<typeof contactIdentitySchema>;

export const contactMembershipSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  projectId: z.string().min(1).nullable(),
  expeditionId: z.string().min(1).nullable(),
  salesforceMembershipId: nullableStringSchema.optional(),
  role: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  source: recordSourceSchema,
  createdAt: timestampSchema,
});
export type ContactMembershipRecord = z.infer<typeof contactMembershipSchema>;

export const projectDimensionSchema = z.object({
  projectId: idSchema,
  projectName: z.string().min(1),
  projectAlias: nullableStringSchema.optional(),
  source: recordSourceSchema,
  isActive: z.boolean().optional(),
  aiKnowledgeUrl: nullableStringSchema.optional(),
  aiKnowledgeSyncedAt: optionalTimestampSchema.optional(),
});
export type ProjectDimensionRecord = z.infer<typeof projectDimensionSchema>;

export const aiKnowledgeEntrySchema = z.object({
  id: idSchema,
  scope: z.enum(["global", "project"]),
  scopeKey: nullableStringSchema.default(null),
  sourceProvider: z.string().min(1),
  sourceId: z.string().min(1),
  sourceUrl: nullableStringSchema.default(null),
  title: nullableStringSchema.default(null),
  content: z.string(),
  contentHash: z.string().min(1),
  metadataJson: metadataJsonSchema.default({}),
  sourceLastEditedAt: optionalTimestampSchema.default(null),
  syncedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type AiKnowledgeEntryRecord = z.infer<typeof aiKnowledgeEntrySchema>;

export const projectKnowledgeEntrySchema = z.object({
  id: idSchema,
  projectId: z.string().min(1),
  kind: z.enum(["canonical_reply", "snippet", "pattern"]),
  issueType: nullableStringSchema.default(null),
  volunteerStage: nullableStringSchema.default(null),
  questionSummary: z.string().min(1),
  replyStrategy: nullableStringSchema.default(null),
  maskedExample: nullableStringSchema.default(null),
  sourceKind: z.enum([
    "hand_authored",
    "captured_from_send",
    "bootstrap_synthesized",
  ]),
  approvedForAi: z.boolean().default(false),
  sourceEventId: nullableStringSchema.default(null),
  metadataJson: metadataJsonSchema.default({}),
  lastReviewedAt: optionalTimestampSchema.default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProjectKnowledgeEntryRecord = z.infer<
  typeof projectKnowledgeEntrySchema
>;

export const projectKnowledgeSourceKindSchema = z.enum([
  "public_project_page",
  "volunteer_homepage",
  "training_site",
  "gmail_alias_history",
  "other",
]);
export type ProjectKnowledgeSourceKind = z.infer<
  typeof projectKnowledgeSourceKindSchema
>;

export const projectKnowledgeSourceLinkSchema = z.object({
  id: idSchema,
  projectId: z.string().min(1),
  kind: projectKnowledgeSourceKindSchema,
  label: nullableStringSchema.default(null),
  url: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProjectKnowledgeSourceLinkRecord = z.infer<
  typeof projectKnowledgeSourceLinkSchema
>;

export const projectKnowledgeBootstrapRunStatusSchema = z.enum([
  "queued",
  "fetching",
  "synthesizing",
  "writing",
  "done",
  "error",
]);
export type ProjectKnowledgeBootstrapRunStatus = z.infer<
  typeof projectKnowledgeBootstrapRunStatusSchema
>;

export const projectKnowledgeBootstrapRunSchema = z.object({
  id: idSchema,
  projectId: z.string().min(1),
  status: projectKnowledgeBootstrapRunStatusSchema,
  force: z.boolean().default(false),
  startedAt: timestampSchema,
  completedAt: optionalTimestampSchema.default(null),
  statsJson: metadataJsonSchema.default({}),
  errorDetail: z.string().min(1).nullable().default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProjectKnowledgeBootstrapRunRecord = z.infer<
  typeof projectKnowledgeBootstrapRunSchema
>;

export const expeditionDimensionSchema = z.object({
  expeditionId: idSchema,
  projectId: nullableStringSchema,
  expeditionName: z.string().min(1),
  source: recordSourceSchema,
});
export type ExpeditionDimensionRecord = z.infer<
  typeof expeditionDimensionSchema
>;

export const gmailMessageDirectionSchema = z.enum(["inbound", "outbound"]);
export type GmailMessageDirection = z.infer<typeof gmailMessageDirectionSchema>;

export const gmailMessageBodyKindSchema = z.enum([
  "plaintext",
  "encrypted_placeholder",
  "binary_fallback",
]);
export type GmailMessageBodyKind = z.infer<typeof gmailMessageBodyKindSchema>;

export const messageAttachmentProviderSchema = z.literal("gmail");
export type MessageAttachmentProvider = z.infer<
  typeof messageAttachmentProviderSchema
>;

export const gmailMessageDetailSchema = z.object({
  sourceEvidenceId: idSchema,
  providerRecordId: z.string().min(1),
  gmailThreadId: nullableStringSchema,
  rfc822MessageId: nullableStringSchema,
  direction: gmailMessageDirectionSchema,
  subject: nullableStringSchema,
  fromHeader: nullableStringSchema.default(null),
  toHeader: nullableStringSchema.default(null),
  ccHeader: nullableStringSchema.default(null),
  labelIds: stringArraySchema.nullable().optional(),
  snippetClean: z.string(),
  bodyTextPreview: z.string(),
  bodyKind: gmailMessageBodyKindSchema.nullable().optional(),
  capturedMailbox: nullableStringSchema,
  projectInboxAlias: nullableStringSchema,
});
export type GmailMessageDetailRecord = z.infer<typeof gmailMessageDetailSchema>;

export const messageAttachmentSchema = z.object({
  id: idSchema,
  sourceEvidenceId: idSchema,
  provider: messageAttachmentProviderSchema,
  gmailAttachmentId: z.string().min(1),
  mimeType: z.string().min(1),
  filename: nullableStringSchema,
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
  createdAt: timestampSchema,
});
export type MessageAttachmentRecord = z.infer<typeof messageAttachmentSchema>;

export const salesforceEventContextSchema = z.object({
  sourceEvidenceId: idSchema,
  salesforceContactId: nullableStringSchema,
  projectId: nullableStringSchema,
  expeditionId: nullableStringSchema,
  sourceField: nullableStringSchema.default(null),
});
export type SalesforceEventContextRecord = z.infer<
  typeof salesforceEventContextSchema
>;

export const salesforceCommunicationDetailSchema = z.object({
  sourceEvidenceId: idSchema,
  providerRecordId: z.string().min(1),
  channel: z.enum(["email", "sms"]),
  messageKind: communicationMessageKindSchema,
  subject: nullableStringSchema,
  snippet: z.string(),
  sourceLabel: z.string().min(1),
});
export type SalesforceCommunicationDetailRecord = z.infer<
  typeof salesforceCommunicationDetailSchema
>;

export const simpleTextingMessageDetailSchema = z.object({
  sourceEvidenceId: idSchema,
  providerRecordId: z.string().min(1),
  direction: communicationDirectionSchema,
  messageKind: communicationMessageKindSchema,
  messageTextPreview: z.string(),
  normalizedPhone: nullableStringSchema,
  campaignId: nullableStringSchema,
  campaignName: nullableStringSchema,
  providerThreadId: nullableStringSchema,
  threadKey: nullableStringSchema,
});
export type SimpleTextingMessageDetailRecord = z.infer<
  typeof simpleTextingMessageDetailSchema
>;

export const mailchimpCampaignActivityDetailSchema = z.object({
  sourceEvidenceId: idSchema,
  providerRecordId: z.string().min(1),
  activityType: campaignEmailActivityTypeSchema,
  campaignId: nullableStringSchema,
  audienceId: nullableStringSchema,
  memberId: nullableStringSchema,
  campaignName: nullableStringSchema,
  snippet: z.string(),
});
export type MailchimpCampaignActivityDetailRecord = z.infer<
  typeof mailchimpCampaignActivityDetailSchema
>;

export const manualNoteDetailSchema = z.object({
  sourceEvidenceId: idSchema,
  providerRecordId: z.string().min(1),
  body: z.string().min(1),
  authorDisplayName: nullableStringSchema.default(null),
  authorId: nullableStringSchema.default(null),
});
export type ManualNoteDetailRecord = z.infer<typeof manualNoteDetailSchema>;

export const identityResolutionSchema = z
  .object({
    id: idSchema,
    sourceEvidenceId: idSchema,
    candidateContactIds: stringArraySchema,
    reasonCode: identityResolutionReasonCodeSchema,
    status: reviewCaseStatusSchema,
    openedAt: timestampSchema,
    resolvedAt: optionalTimestampSchema,
    normalizedIdentityValues: stringArraySchema.default([]),
    anchoredContactId: optionalIdSchema,
    explanation: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.status === "resolved" && value.resolvedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resolved identity cases must include resolvedAt",
      });
    }
  });
export type IdentityResolutionCase = z.infer<typeof identityResolutionSchema>;

export const routingReviewSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    sourceEvidenceId: idSchema,
    reasonCode: routingReviewReasonCodeSchema,
    status: reviewCaseStatusSchema,
    openedAt: timestampSchema,
    resolvedAt: optionalTimestampSchema,
    candidateMembershipIds: stringArraySchema.default([]),
    explanation: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.status === "resolved" && value.resolvedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resolved routing cases must include resolvedAt",
      });
    }
  });
export type RoutingReviewCase = z.infer<typeof routingReviewSchema>;

export const inboxProjectionSchema = z
  .object({
    contactId: idSchema,
    bucket: inboxBucketSchema,
    needsFollowUp: z.boolean(),
    hasUnresolved: z.boolean(),
    lastInboundAt: optionalTimestampSchema,
    lastOutboundAt: optionalTimestampSchema,
    lastActivityAt: timestampSchema,
    snippet: z.string(),
    lastCanonicalEventId: idSchema,
    lastEventType: inboxDrivingEventTypeSchema,
  })
  .superRefine((value, context) => {
    if (value.lastInboundAt === null && value.lastOutboundAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "an inbox projection must include at least one inbound or outbound timestamp",
      });
    }

    if (
      value.lastInboundAt === null &&
      value.lastOutboundAt !== null &&
      value.lastActivityAt < value.lastOutboundAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "outbound-only inbox rows must set lastActivityAt at or after lastOutboundAt",
      });
    }

    if (
      value.lastInboundAt !== null &&
      value.lastActivityAt < value.lastInboundAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "lastActivityAt must be at least as recent as lastInboundAt when inbound history exists",
      });
    }

    const expectedLastActivityAt =
      value.lastInboundAt === null
        ? value.lastOutboundAt
        : value.lastOutboundAt === null
          ? value.lastInboundAt
          : value.lastInboundAt > value.lastOutboundAt
            ? value.lastInboundAt
            : value.lastOutboundAt;

    if (
      expectedLastActivityAt !== null &&
      value.lastActivityAt < expectedLastActivityAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "lastActivityAt must be at least as recent as the newest inbound or outbound timestamp",
      });
    }
  });
export type InboxProjectionRow = z.infer<typeof inboxProjectionSchema>;

export const timelineProjectionSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    canonicalEventId: idSchema,
    occurredAt: timestampSchema,
    sortKey: z.string().min(1),
    eventType: canonicalEventTypeSchema,
    summary: z.string().min(1),
    channel: channelSchema,
    primaryProvider: providerSchema,
    reviewState: reviewStateSchema,
  })
  .superRefine((value, context) => {
    if (value.channel !== resolveCanonicalChannel(value.eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline channel must match the canonical event type",
      });
    }
  });
export type TimelineProjectionRow = z.infer<typeof timelineProjectionSchema>;

export const syncStateSchema = z
  .object({
    id: idSchema,
    scope: syncScopeSchema,
    provider: providerSchema.nullable(),
    jobType: syncJobTypeSchema,
    cursor: z.string().min(1).nullable(),
    windowStart: optionalTimestampSchema,
    windowEnd: optionalTimestampSchema,
    status: syncStatusSchema,
    parityPercent: z.number().min(0).max(100).nullable(),
    freshnessP95Seconds: z.number().int().nonnegative().nullable(),
    freshnessP99Seconds: z.number().int().nonnegative().nullable(),
    lastSuccessfulAt: optionalTimestampSchema,
    deadLetterCount: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.scope === "provider" && value.provider === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provider-scoped sync state must include a provider",
      });
    }

    if (value.scope === "orchestration" && value.provider !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "orchestration-scoped sync state must not include a provider",
      });
    }
  });
export type SyncStateRecord = z.infer<typeof syncStateSchema>;

export const auditEvidenceSchema = z.object({
  id: idSchema,
  actorType: auditActorTypeSchema,
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  occurredAt: timestampSchema,
  result: auditResultSchema,
  policyCode: z.string().min(1),
  metadataJson: metadataJsonSchema,
});
export type AuditEvidenceRecord = z.infer<typeof auditEvidenceSchema>;
