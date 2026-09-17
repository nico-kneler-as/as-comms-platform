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
  salesforceDeletedAt: optionalTimestampSchema.optional(),
  salesforceReconciledAt: optionalTimestampSchema.optional(),
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
  salesforceDeletedAt: optionalTimestampSchema.optional(),
  salesforceReconciledAt: optionalTimestampSchema.optional(),
  createdAt: timestampSchema,
});
export type ContactMembershipRecord = z.infer<typeof contactMembershipSchema>;

export const projectDimensionSchema = z.object({
  projectId: idSchema,
  projectName: z.string().min(1),
  projectAlias: nullableStringSchema.optional(),
  // Historical project_alias values, appended by setProjectAlias on
  // rename so the email bubble-side renderer (D-049) keeps messages
  // from prior aliases on the right side.
  previousAliases: z.array(z.string()).optional(),
  // Pointer to the host project this row rolls up into (NULL = host or
  // standalone). See migration 0056. The platform supports two Salesforce
  // projects sharing one inbox alias / AI knowledge by marking one as the
  // host and the other(s) connected to it.
  connectedToProjectId: nullableStringSchema.optional(),
  source: recordSourceSchema,
  isActive: z.boolean().optional(),
  aiKnowledgeUrl: nullableStringSchema.optional(),
  aiKnowledgeSyncedAt: optionalTimestampSchema.optional(),
  aiKnowledgeSources: z.lazy(() => aiKnowledgeSourcesSchema).optional(),
  aiOperatingContext: z.string().optional(),
  aiAutoSyncSchedule: z.enum(["never", "daily", "weekly"]).optional(),
  aiOptimizedSynthesizedAt: optionalTimestampSchema.optional(),
  // Bumped on every successful synthesis orchestrator run, including the
  // skip-if-unchanged path. Lets the UI show "auto-sync ran at X, no
  // changes detected" separately from "content last regenerated at Y".
  aiOptimizedLastCheckedAt: optionalTimestampSchema.optional(),
  aiOptimizedInputHash: nullableStringSchema.optional(),
  salesforceDeletedAt: optionalTimestampSchema.optional(),
  salesforceReconciledAt: optionalTimestampSchema.optional(),
});
export type ProjectDimensionRecord = z.input<typeof projectDimensionSchema>;

export const salesforceReconciliationRunSchema = z.object({
  id: idSchema,
  startedAt: timestampSchema,
  completedAt: optionalTimestampSchema,
  mode: z.enum(["dry_run", "enforce"]),
  entityType: z.enum(["contact", "membership", "project"]),
  scanned: z.number().int().nonnegative(),
  confirmedPresent: z.number().int().nonnegative(),
  markedDeleted: z.number().int().nonnegative(),
  missingLocallyCount: z.number().int().nonnegative(),
  errors: z.array(z.unknown()).readonly(),
  abortedReason: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type SalesforceReconciliationRunRecord = z.infer<
  typeof salesforceReconciliationRunSchema
>;

export const aiKnowledgeSourceKindSchema = z.enum([
  "notion",
  "web_page",
  "inline_text",
]);
export type AiKnowledgeSourceKind = z.infer<typeof aiKnowledgeSourceKindSchema>;

export const aiKnowledgeSourceSyncStatusSchema = z.enum([
  "pending",
  "healthy",
  "stale",
  "broken",
]);
export type AiKnowledgeSourceSyncStatus = z.infer<
  typeof aiKnowledgeSourceSyncStatusSchema
>;

export const aiKnowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  kind: aiKnowledgeSourceKindSchema,
  label: z.string().nullable(),
  enabled: z.boolean(),
  last_synced_at: z.string().datetime().nullable(),
  last_sync_status: aiKnowledgeSourceSyncStatusSchema.nullable(),
  last_sync_error: z.string().nullable(),
  source_id: z.string().nullable(),
  source_content_hash: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AiKnowledgeSource = z.infer<typeof aiKnowledgeSourceSchema>;

export const aiKnowledgeSourcesSchema = z.array(aiKnowledgeSourceSchema);
export type AiKnowledgeSources = z.infer<typeof aiKnowledgeSourcesSchema>;

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
  // corpus_example added 2026-05-10: bulk historical outbound replies
  // backfilled per project to populate the EMAIL_CORPUS block in the
  // synthesis prompt. Lower training weight than canonical_reply
  // (which represents operator-endorsed exemplars). See PRD #366 +
  // backfill-project-corpus ops script.
  kind: z.enum(["canonical_reply", "snippet", "pattern", "corpus_example"]),
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

export const canonicalEventParticipantRoleSchema = z.enum([
  "sender",
  "direct_recipient",
  "cc",
  "bcc",
]);
export type CanonicalEventParticipantRole = z.infer<
  typeof canonicalEventParticipantRoleSchema
>;

export const messageAttachmentProviderSchema = z.enum(["gmail", "drive"]);
export type MessageAttachmentProvider = z.infer<
  typeof messageAttachmentProviderSchema
>;

const messageAttachmentCommonFields = {
  id: idSchema,
  sourceEvidenceId: idSchema,
  mimeType: z.string().min(1),
  filename: nullableStringSchema,
  sizeBytes: z.number().int().nonnegative(),
  isDecoration: z.boolean(),
  createdAt: timestampSchema,
};

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
  fromEmails: stringArraySchema.default([]),
  toEmails: stringArraySchema.default([]),
  ccEmails: stringArraySchema.default([]),
  bccEmails: stringArraySchema.default([]),
  labelIds: stringArraySchema.nullable().optional(),
  snippetClean: z.string(),
  bodyTextPreview: z.string(),
  bodyKind: gmailMessageBodyKindSchema.nullable().optional(),
  capturedMailbox: nullableStringSchema,
  projectInboxAlias: nullableStringSchema,
});
export type GmailMessageDetailRecord = z.infer<typeof gmailMessageDetailSchema>;

export const canonicalEventAudienceSchema = z.object({
  canonicalEventId: idSchema,
  contactId: idSchema,
  participantRole: canonicalEventParticipantRoleSchema,
  normalizedEmail: z.string().email(),
});
export type CanonicalEventAudienceRecord = z.infer<
  typeof canonicalEventAudienceSchema
>;

export const messageAttachmentSchema = z.discriminatedUnion("provider", [
  z.object({
    ...messageAttachmentCommonFields,
    provider: z.literal("gmail"),
    gmailAttachmentId: z.string().min(1),
    storageKey: z.string().min(1),
    externalUrl: z.null(),
  }),
  z.object({
    ...messageAttachmentCommonFields,
    provider: z.literal("drive"),
    gmailAttachmentId: z.null(),
    storageKey: z.null(),
    externalUrl: z.string().min(1),
  }),
]);
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

export const integrationBackfillJobSchema = z.object({
  id: idSchema,
  service: z.string().min(1),
  idempotencyKey: z.string().min(1),
  triggeredBy: z.string().min(1),
  windowStart: timestampSchema,
  windowEnd: timestampSchema,
  mailbox: nullableStringSchema,
  status: z.enum(["pending", "running", "completed", "failed"]),
  enqueuedAt: timestampSchema,
  startedAt: optionalTimestampSchema,
  completedAt: optionalTimestampSchema,
  resultJson: metadataJsonSchema.nullable(),
  failureReason: nullableStringSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type IntegrationBackfillJobRecord = z.infer<
  typeof integrationBackfillJobSchema
>;

export const identityResolutionSchema = z
  .object({
    id: idSchema,
    sourceEvidenceId: idSchema,
    candidateContactIds: stringArraySchema,
    reasonCode: identityResolutionReasonCodeSchema,
    status: reviewCaseStatusSchema,
    openedAt: timestampSchema,
    resolvedAt: optionalTimestampSchema,
    lastAttemptedAt: optionalTimestampSchema.optional(),
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
    archivedAt: optionalTimestampSchema.default(null),
    lastCanonicalEventId: idSchema,
    lastEventType: canonicalEventTypeSchema,
  })
  .superRefine((value, context) => {
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
    consecutiveFailureCount: z.number().int().nonnegative(),
    leaseOwner: z.string().min(1).nullable(),
    heartbeatAt: optionalTimestampSchema,
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
