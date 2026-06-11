import {
  aiKnowledgeSourcesSchema,
  aiKnowledgeEntrySchema,
  auditEvidenceSchema,
  canonicalEventSchema,
  canonicalEventAudienceSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  integrationBackfillJobSchema,
  integrationHealthSchema,
  identityResolutionSchema,
  inboxProjectionSchema,
  mailchimpCampaignActivityDetailSchema,
  messageAttachmentSchema,
  manualNoteDetailSchema,
  projectKnowledgeEntrySchema,
  projectDimensionSchema,
  routingReviewSchema,
  salesforceReconciliationRunSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  simpleTextingMessageDetailSchema,
  sourceEvidenceSchema,
  syncStateSchema,
  timelineProjectionSchema,
  type AuditEvidenceRecord,
  type AiKnowledgeEntryRecord,
  type CanonicalEventRecord,
  type CanonicalEventAudienceRecord,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IntegrationBackfillJobRecord,
  type IntegrationHealthRecord,
  type IdentityResolutionCase,
  type InboxProjectionRow,
  type MailchimpCampaignActivityDetailRecord,
  type MessageAttachmentRecord,
  type ManualNoteDetailRecord,
  type ProjectKnowledgeEntryRecord,
  type ProjectDimensionRecord,
  type RoutingReviewCase,
  type SalesforceReconciliationRunRecord,
  type SalesforceCommunicationDetailRecord,
  type SalesforceEventContextRecord,
  type SimpleTextingMessageDetailRecord,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type TimelineProjectionRow,
} from "@as-comms/contracts";

import type {
  PendingComposerOutboundRecord,
  ProjectAliasRecord,
  SourceEvidenceQuarantineInput,
  SourceEvidenceQuarantineRecord,
  ConsentRecord,
  SmsMessageRecord,
  SmsSenderRecord,
  UserRecord,
} from "@as-comms/domain";

import type {
  aiKnowledgeEntries,
  auditPolicyEvidence,
  canonicalEventLedger,
  canonicalEventAudience,
  consentRecords,
  contactIdentities,
  contactInboxProjection,
  contactMemberships,
  contactTimelineProjection,
  contacts,
  expeditionDimensions,
  gmailMessageDetails,
  integrationBackfillJobs,
  integrationHealth,
  identityResolutionQueue,
  mailchimpCampaignActivityDetails,
  messageAttachments,
  manualNoteDetails,
  pendingComposerOutbounds,
  projectAliases,
  projectKnowledgeEntries,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceReconciliationRuns,
  salesforceEventContext,
  simpleTextingMessageDetails,
  smsMessages,
  smsSenders,
  sourceEvidenceLog,
  sourceEvidenceQuarantine,
  syncState,
  users,
} from "./schema/index.js";

type SourceEvidenceRow = typeof sourceEvidenceLog.$inferSelect;
type SourceEvidenceQuarantineRow = typeof sourceEvidenceQuarantine.$inferSelect;
type AiKnowledgeEntryRow = typeof aiKnowledgeEntries.$inferSelect;
type ProjectKnowledgeEntryRow = typeof projectKnowledgeEntries.$inferSelect;
type CanonicalEventRow = typeof canonicalEventLedger.$inferSelect;
type CanonicalEventAudienceRow = typeof canonicalEventAudience.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type ContactIdentityRow = typeof contactIdentities.$inferSelect;
type ContactMembershipRow = typeof contactMemberships.$inferSelect;
type SmsMessageRow = typeof smsMessages.$inferSelect;
type ConsentRecordRow = typeof consentRecords.$inferSelect;
type SmsSenderRow = typeof smsSenders.$inferSelect;
type ProjectDimensionRow = typeof projectDimensions.$inferSelect;
type ExpeditionDimensionRow = typeof expeditionDimensions.$inferSelect;
type GmailMessageDetailRow = typeof gmailMessageDetails.$inferSelect;
type IntegrationBackfillJobRow = typeof integrationBackfillJobs.$inferSelect;
type IntegrationHealthRow = typeof integrationHealth.$inferSelect;
type SalesforceEventContextRow = typeof salesforceEventContext.$inferSelect;
type SalesforceCommunicationDetailRow =
  typeof salesforceCommunicationDetails.$inferSelect;
type SimpleTextingMessageDetailRow =
  typeof simpleTextingMessageDetails.$inferSelect;
type MailchimpCampaignActivityDetailRow =
  typeof mailchimpCampaignActivityDetails.$inferSelect;
type MessageAttachmentRow = typeof messageAttachments.$inferSelect;
type ManualNoteDetailRow = typeof manualNoteDetails.$inferSelect;
type PendingComposerOutboundRow = typeof pendingComposerOutbounds.$inferSelect;
type IdentityResolutionRow = typeof identityResolutionQueue.$inferSelect;
type RoutingReviewRow = typeof routingReviewQueue.$inferSelect;
type InboxProjectionRowDb = typeof contactInboxProjection.$inferSelect;
type TimelineProjectionRowDb = typeof contactTimelineProjection.$inferSelect;
type SyncStateRow = typeof syncState.$inferSelect;
type AuditEvidenceRow = typeof auditPolicyEvidence.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ProjectAliasRow = typeof projectAliases.$inferSelect;
type SalesforceReconciliationRunRow =
  typeof salesforceReconciliationRuns.$inferSelect;

type ContactRowInput = Omit<
  ContactRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<Pick<ContactRow, "salesforceDeletedAt" | "salesforceReconciledAt">>;

type ContactMembershipRowInput = Omit<
  ContactMembershipRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<
    Pick<ContactMembershipRow, "salesforceDeletedAt" | "salesforceReconciledAt">
  >;

type ProjectDimensionRowInput = Omit<
  ProjectDimensionRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<
    Pick<ProjectDimensionRow, "salesforceDeletedAt" | "salesforceReconciledAt">
  >;

function fromDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toDate(value: string): Date {
  return new Date(value);
}

export function mapSourceEvidenceRow(
  row: SourceEvidenceRow,
): SourceEvidenceRecord {
  return sourceEvidenceSchema.parse({
    id: row.id,
    provider: row.provider,
    providerRecordType: row.providerRecordType,
    providerRecordId: row.providerRecordId,
    receivedAt: row.receivedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    payloadRef: row.payloadRef,
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum,
  });
}

export function mapAiKnowledgeEntryRow(
  row: AiKnowledgeEntryRow,
): AiKnowledgeEntryRecord {
  return aiKnowledgeEntrySchema.parse({
    id: row.id,
    scope: row.scope,
    scopeKey: row.scopeKey,
    sourceProvider: row.sourceProvider,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    content: row.content,
    contentHash: row.contentHash,
    metadataJson: row.metadataJson,
    sourceLastEditedAt: fromDate(row.sourceLastEditedAt),
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapAiKnowledgeEntryToInsert(
  record: AiKnowledgeEntryRecord,
): typeof aiKnowledgeEntries.$inferInsert {
  const parsed = aiKnowledgeEntrySchema.parse(record);

  return {
    id: parsed.id,
    scope: parsed.scope,
    scopeKey: parsed.scopeKey,
    sourceProvider: parsed.sourceProvider,
    sourceId: parsed.sourceId,
    sourceUrl: parsed.sourceUrl,
    title: parsed.title,
    content: parsed.content,
    contentHash: parsed.contentHash,
    metadataJson: parsed.metadataJson,
    sourceLastEditedAt:
      parsed.sourceLastEditedAt === null ? null : toDate(parsed.sourceLastEditedAt),
    syncedAt: toDate(parsed.syncedAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapProjectKnowledgeEntryRow(
  row: ProjectKnowledgeEntryRow,
): ProjectKnowledgeEntryRecord {
  return projectKnowledgeEntrySchema.parse({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    issueType: row.issueType,
    volunteerStage: row.volunteerStage,
    questionSummary: row.questionSummary,
    replyStrategy: row.replyStrategy,
    maskedExample: row.maskedExample,
    sourceKind: row.sourceKind,
    approvedForAi: row.approvedForAi,
    sourceEventId: row.sourceEventId,
    metadataJson: row.metadataJson,
    lastReviewedAt: fromDate(row.lastReviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapProjectKnowledgeEntryToInsert(
  record: ProjectKnowledgeEntryRecord,
): typeof projectKnowledgeEntries.$inferInsert {
  const parsed = projectKnowledgeEntrySchema.parse(record);

  return {
    id: parsed.id,
    projectId: parsed.projectId,
    kind: parsed.kind,
    issueType: parsed.issueType,
    volunteerStage: parsed.volunteerStage,
    questionSummary: parsed.questionSummary,
    replyStrategy: parsed.replyStrategy,
    maskedExample: parsed.maskedExample,
    sourceKind: parsed.sourceKind,
    approvedForAi: parsed.approvedForAi,
    sourceEventId: parsed.sourceEventId,
    metadataJson: parsed.metadataJson,
    lastReviewedAt:
      parsed.lastReviewedAt === null ? null : toDate(parsed.lastReviewedAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapSourceEvidenceToInsert(
  record: SourceEvidenceRecord,
): typeof sourceEvidenceLog.$inferInsert {
  const parsed = sourceEvidenceSchema.parse(record);

  return {
    id: parsed.id,
    provider: parsed.provider,
    providerRecordType: parsed.providerRecordType,
    providerRecordId: parsed.providerRecordId,
    receivedAt: toDate(parsed.receivedAt),
    occurredAt: toDate(parsed.occurredAt),
    payloadRef: parsed.payloadRef,
    idempotencyKey: parsed.idempotencyKey,
    checksum: parsed.checksum,
  };
}

export function mapSourceEvidenceQuarantineRow(
  row: SourceEvidenceQuarantineRow,
): SourceEvidenceQuarantineRecord {
  return {
    id: row.id,
    provider: row.provider,
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum,
    attemptedAt: row.attemptedAt,
    reason: row.reason as SourceEvidenceQuarantineRecord["reason"],
    payloadRef: row.payloadRef,
    details: row.detailsJsonb as Readonly<Record<string, unknown>>,
    createdAt: row.createdAt,
  };
}

export function mapSourceEvidenceQuarantineToInsert(input: {
  readonly id: string;
  readonly record: SourceEvidenceQuarantineInput;
}): typeof sourceEvidenceQuarantine.$inferInsert {
  return {
    id: input.id,
    provider: input.record.provider,
    idempotencyKey: input.record.idempotencyKey,
    checksum: input.record.checksum,
    attemptedAt: input.record.attemptedAt,
    reason: input.record.reason,
    payloadRef: input.record.payloadRef,
    detailsJsonb: input.record.details,
  };
}

export function mapCanonicalEventRow(
  row: CanonicalEventRow,
): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: row.id,
    contactId: row.contactId,
    eventType: row.eventType,
    channel: row.channel,
    occurredAt: row.occurredAt.toISOString(),
    contentFingerprint: row.contentFingerprint,
    sourceEvidenceId: row.sourceEvidenceId,
    idempotencyKey: row.idempotencyKey,
    provenance: row.provenance,
    reviewState: row.reviewState,
  });
}

export function mapCanonicalEventToInsert(
  record: CanonicalEventRecord,
): typeof canonicalEventLedger.$inferInsert {
  const parsed = canonicalEventSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    eventType: parsed.eventType,
    channel: parsed.channel,
    occurredAt: toDate(parsed.occurredAt),
    contentFingerprint: parsed.contentFingerprint,
    sourceEvidenceId: parsed.sourceEvidenceId,
    idempotencyKey: parsed.idempotencyKey,
    provenance: parsed.provenance,
    reviewState: parsed.reviewState,
  };
}

export function mapCanonicalEventAudienceRow(
  row: CanonicalEventAudienceRow,
): CanonicalEventAudienceRecord {
  return canonicalEventAudienceSchema.parse({
    canonicalEventId: row.canonicalEventId,
    contactId: row.contactId,
    participantRole: row.participantRole,
    normalizedEmail: row.normalizedEmail,
  });
}

export function mapCanonicalEventAudienceToInsert(
  record: CanonicalEventAudienceRecord,
): typeof canonicalEventAudience.$inferInsert {
  const parsed = canonicalEventAudienceSchema.parse(record);

  return {
    canonicalEventId: parsed.canonicalEventId,
    contactId: parsed.contactId,
    participantRole: parsed.participantRole,
    normalizedEmail: parsed.normalizedEmail,
  };
}

export function mapContactRow(row: ContactRowInput): ContactRecord {
  return contactSchema.parse({
    id: row.id,
    salesforceContactId: row.salesforceContactId,
    displayName: row.displayName,
    primaryEmail: row.primaryEmail,
    primaryPhone: row.primaryPhone,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapContactToInsert(
  record: ContactRecord,
): typeof contacts.$inferInsert {
  const parsed = contactSchema.parse(record);

  return {
    id: parsed.id,
    salesforceContactId: parsed.salesforceContactId,
    displayName: parsed.displayName,
    primaryEmail: parsed.primaryEmail,
    primaryPhone: parsed.primaryPhone,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapContactIdentityRow(
  row: ContactIdentityRow,
): ContactIdentityRecord {
  return contactIdentitySchema.parse({
    id: row.id,
    contactId: row.contactId,
    kind: row.kind,
    normalizedValue: row.normalizedValue,
    isPrimary: row.isPrimary,
    source: row.source,
    verifiedAt: fromDate(row.verifiedAt),
  });
}

export function mapContactIdentityToInsert(
  record: ContactIdentityRecord,
): typeof contactIdentities.$inferInsert {
  const parsed = contactIdentitySchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    kind: parsed.kind,
    normalizedValue: parsed.normalizedValue,
    isPrimary: parsed.isPrimary,
    source: parsed.source,
    verifiedAt: parsed.verifiedAt === null ? null : toDate(parsed.verifiedAt),
  };
}

export function mapContactMembershipRow(
  row: ContactMembershipRowInput,
): ContactMembershipRecord {
  return contactMembershipSchema.parse({
    id: row.id,
    contactId: row.contactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    salesforceMembershipId: row.salesforceMembershipId ?? undefined,
    role: row.role,
    status: row.status,
    source: row.source,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
    createdAt: row.createdAt.toISOString(),
  });
}

export function mapContactMembershipToInsert(
  record: ContactMembershipRecord,
): typeof contactMemberships.$inferInsert {
  const parsed = contactMembershipSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId,
    salesforceMembershipId: parsed.salesforceMembershipId ?? null,
    role: parsed.role,
    status: parsed.status,
    source: parsed.source,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapSmsMessageRow(row: SmsMessageRow): SmsMessageRecord {
  return {
    id: row.id,
    twilioMessageSid: row.twilioMessageSid,
    direction: row.direction as SmsMessageRecord["direction"],
    contactId: row.contactId,
    phoneE164: row.phoneE164,
    senderId: row.senderId,
    body: row.body,
    segments: row.segments,
    encoding: row.encoding as SmsMessageRecord["encoding"],
    mediaUrls: row.mediaUrls,
    sendStatus: row.sendStatus,
    failedReason: row.failedReason,
    failedDetail: row.failedDetail,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    actorId: row.actorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSmsMessageToInsert(
  record: SmsMessageRecord,
): typeof smsMessages.$inferInsert {
  return {
    id: record.id,
    twilioMessageSid: record.twilioMessageSid,
    direction: record.direction,
    contactId: record.contactId,
    phoneE164: record.phoneE164,
    senderId: record.senderId,
    body: record.body,
    segments: record.segments,
    encoding: record.encoding,
    mediaUrls: record.mediaUrls === null ? null : [...record.mediaUrls],
    sendStatus: record.sendStatus,
    failedReason: record.failedReason,
    failedDetail: record.failedDetail,
    sentAt: record.sentAt,
    receivedAt: record.receivedAt,
    actorId: record.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapConsentRecordRow(row: ConsentRecordRow): ConsentRecord {
  return {
    id: row.id,
    contactId: row.contactId,
    phoneE164: row.phoneE164,
    status: row.status as ConsentRecord["status"],
    source: row.source as ConsentRecord["source"],
    sourceDetail: row.sourceDetail,
    consentedAt: row.consentedAt,
    revokedAt: row.revokedAt,
    recordedByUserId: row.recordedByUserId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapConsentRecordToInsert(
  record: ConsentRecord,
): typeof consentRecords.$inferInsert {
  return {
    id: record.id,
    contactId: record.contactId,
    phoneE164: record.phoneE164,
    status: record.status,
    source: record.source,
    sourceDetail: record.sourceDetail,
    consentedAt: record.consentedAt,
    revokedAt: record.revokedAt,
    recordedByUserId: record.recordedByUserId,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapSmsSenderRow(row: SmsSenderRow): SmsSenderRecord {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    monthlyCap: row.monthlyCap,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSmsSenderToInsert(
  record: SmsSenderRecord,
): typeof smsSenders.$inferInsert {
  return {
    id: record.id,
    phoneE164: record.phoneE164,
    displayName: record.displayName,
    monthlyCap: record.monthlyCap,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapProjectDimensionRow(
  row: ProjectDimensionRowInput,
): ProjectDimensionRecord {
  return projectDimensionSchema.parse({
    projectId: row.projectId,
    projectName: row.projectName,
    projectAlias: row.projectAlias,
    previousAliases: row.previousAliases,
    connectedToProjectId: row.connectedToProjectId,
    source: row.source,
    isActive: row.isActive,
    aiKnowledgeUrl: row.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: fromDate(row.aiKnowledgeSyncedAt),
    aiKnowledgeSources: aiKnowledgeSourcesSchema.parse(row.aiKnowledgeSources),
    aiOperatingContext: row.aiOperatingContext,
    aiAutoSyncSchedule: row.aiAutoSyncSchedule,
    aiOptimizedSynthesizedAt: fromDate(row.aiOptimizedSynthesizedAt),
    aiOptimizedLastCheckedAt: fromDate(row.aiOptimizedLastCheckedAt),
    aiOptimizedInputHash: row.aiOptimizedInputHash,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
  });
}

export function mapProjectDimensionToInsert(
  record: ProjectDimensionRecord,
): typeof projectDimensions.$inferInsert {
  const parsed = projectDimensionSchema.parse(record);

  return {
    projectId: parsed.projectId,
    projectName: parsed.projectName,
    projectAlias: parsed.projectAlias ?? null,
    // connectedToProjectId is operator-managed; absent in incoming records
    // means "don't set it" (mirrors projectAlias behaviour). Salesforce
    // capture never sets this — only Settings/admin actions should.
    connectedToProjectId: parsed.connectedToProjectId ?? null,
    isActive: parsed.isActive ?? false,
    aiKnowledgeUrl: parsed.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt:
      parsed.aiKnowledgeSyncedAt === undefined ||
      parsed.aiKnowledgeSyncedAt === null
        ? null
        : toDate(parsed.aiKnowledgeSyncedAt),
    aiKnowledgeSources: parsed.aiKnowledgeSources ?? undefined,
    aiOperatingContext: parsed.aiOperatingContext ?? undefined,
    aiAutoSyncSchedule: parsed.aiAutoSyncSchedule,
    aiOptimizedSynthesizedAt:
      parsed.aiOptimizedSynthesizedAt === undefined
        ? undefined
        : parsed.aiOptimizedSynthesizedAt === null
          ? null
          : toDate(parsed.aiOptimizedSynthesizedAt),
    aiOptimizedLastCheckedAt:
      parsed.aiOptimizedLastCheckedAt === undefined
        ? undefined
        : parsed.aiOptimizedLastCheckedAt === null
          ? null
          : toDate(parsed.aiOptimizedLastCheckedAt),
    aiOptimizedInputHash:
      parsed.aiOptimizedInputHash === undefined
        ? undefined
        : parsed.aiOptimizedInputHash,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    source: parsed.source,
  };
}

export function mapIntegrationHealthRow(
  row: IntegrationHealthRow,
): IntegrationHealthRecord {
  return integrationHealthSchema.parse({
    id: row.id,
    serviceName: row.serviceName,
    category: row.category,
    status: row.status,
    lastCheckedAt: fromDate(row.lastCheckedAt),
    degradedSinceAt: fromDate(row.degradedSinceAt),
    lastAlertSentAt: fromDate(row.lastAlertSentAt),
    detail: row.detail,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapIntegrationHealthToInsert(
  record: IntegrationHealthRecord,
): typeof integrationHealth.$inferInsert {
  const parsed = integrationHealthSchema.parse(record);

  return {
    id: parsed.id,
    serviceName: parsed.serviceName,
    category: parsed.category,
    status: parsed.status,
    lastCheckedAt:
      parsed.lastCheckedAt === null ? null : toDate(parsed.lastCheckedAt),
    degradedSinceAt:
      parsed.degradedSinceAt === null ? null : toDate(parsed.degradedSinceAt),
    lastAlertSentAt:
      parsed.lastAlertSentAt === null ? null : toDate(parsed.lastAlertSentAt),
    detail: parsed.detail,
    metadataJson: parsed.metadataJson,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapExpeditionDimensionRow(
  row: ExpeditionDimensionRow,
): ExpeditionDimensionRecord {
  return expeditionDimensionSchema.parse({
    expeditionId: row.expeditionId,
    projectId: row.projectId,
    expeditionName: row.expeditionName,
    source: row.source,
  });
}

export function mapExpeditionDimensionToInsert(
  record: ExpeditionDimensionRecord,
): typeof expeditionDimensions.$inferInsert {
  const parsed = expeditionDimensionSchema.parse(record);

  return {
    expeditionId: parsed.expeditionId,
    projectId: parsed.projectId,
    expeditionName: parsed.expeditionName,
    source: parsed.source,
  };
}

export function mapGmailMessageDetailRow(
  row: GmailMessageDetailRow,
): GmailMessageDetailRecord {
  return gmailMessageDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    gmailThreadId: row.gmailThreadId,
    rfc822MessageId: row.rfc822MessageId,
    direction: row.direction,
    subject: row.subject,
    fromHeader: row.fromHeader,
    toHeader: row.toHeader,
    ccHeader: row.ccHeader,
    fromEmails: row.fromEmails,
    toEmails: row.toEmails,
    ccEmails: row.ccEmails,
    bccEmails: row.bccEmails,
    labelIds: row.labelIds,
    snippetClean: row.snippetClean,
    bodyTextPreview: row.bodyTextPreview,
    bodyKind: row.bodyKind,
    capturedMailbox: row.capturedMailbox,
    projectInboxAlias: row.projectInboxAlias,
  });
}

export function mapGmailMessageDetailToInsert(
  record: GmailMessageDetailRecord,
): typeof gmailMessageDetails.$inferInsert {
  const parsed = gmailMessageDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    gmailThreadId: parsed.gmailThreadId,
    rfc822MessageId: parsed.rfc822MessageId,
    direction: parsed.direction,
    subject: parsed.subject,
    fromHeader: parsed.fromHeader,
    toHeader: parsed.toHeader,
    ccHeader: parsed.ccHeader,
    fromEmails: [...parsed.fromEmails],
    toEmails: [...parsed.toEmails],
    ccEmails: [...parsed.ccEmails],
    bccEmails: [...parsed.bccEmails],
    labelIds: parsed.labelIds,
    snippetClean: parsed.snippetClean,
    bodyTextPreview: parsed.bodyTextPreview,
    bodyKind: parsed.bodyKind ?? null,
    capturedMailbox: parsed.capturedMailbox,
    projectInboxAlias: parsed.projectInboxAlias,
  };
}

export function mapMessageAttachmentRow(
  row: MessageAttachmentRow,
): MessageAttachmentRecord {
  return messageAttachmentSchema.parse({
    id: row.id,
    sourceEvidenceId: row.sourceEvidenceId,
    provider: row.provider,
    gmailAttachmentId: row.gmailAttachmentId,
    mimeType: row.mimeType,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    externalUrl: row.externalUrl,
    isDecoration: row.isDecoration,
    createdAt: row.createdAt.toISOString(),
  });
}

export function mapMessageAttachmentToInsert(
  record: MessageAttachmentRecord,
): typeof messageAttachments.$inferInsert {
  const parsed = messageAttachmentSchema.parse(record);

  return {
    id: parsed.id,
    sourceEvidenceId: parsed.sourceEvidenceId,
    provider: parsed.provider,
    gmailAttachmentId: parsed.gmailAttachmentId,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
    sizeBytes: parsed.sizeBytes,
    storageKey: parsed.storageKey,
    externalUrl: parsed.externalUrl,
    isDecoration: parsed.isDecoration,
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapSalesforceEventContextRow(
  row: SalesforceEventContextRow,
): SalesforceEventContextRecord {
  return salesforceEventContextSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    salesforceContactId: row.salesforceContactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    sourceField: row.sourceField,
  });
}

export function mapSalesforceEventContextToInsert(
  record: SalesforceEventContextRecord,
): typeof salesforceEventContext.$inferInsert {
  const parsed = salesforceEventContextSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    salesforceContactId: parsed.salesforceContactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId,
    sourceField: parsed.sourceField,
  };
}

export function mapSalesforceCommunicationDetailRow(
  row: SalesforceCommunicationDetailRow,
): SalesforceCommunicationDetailRecord {
  return salesforceCommunicationDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    channel: row.channel,
    messageKind: row.messageKind,
    subject: row.subject,
    snippet: row.snippet,
    sourceLabel: row.sourceLabel,
  });
}

export function mapSalesforceCommunicationDetailToInsert(
  record: SalesforceCommunicationDetailRecord,
): typeof salesforceCommunicationDetails.$inferInsert {
  const parsed = salesforceCommunicationDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    channel: parsed.channel,
    messageKind: parsed.messageKind,
    subject: parsed.subject,
    snippet: parsed.snippet,
    sourceLabel: parsed.sourceLabel,
  };
}

export function mapSimpleTextingMessageDetailRow(
  row: SimpleTextingMessageDetailRow,
): SimpleTextingMessageDetailRecord {
  return simpleTextingMessageDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    direction: row.direction,
    messageKind: row.messageKind,
    messageTextPreview: row.messageTextPreview,
    normalizedPhone: row.normalizedPhone,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    providerThreadId: row.providerThreadId,
    threadKey: row.threadKey,
  });
}

export function mapSimpleTextingMessageDetailToInsert(
  record: SimpleTextingMessageDetailRecord,
): typeof simpleTextingMessageDetails.$inferInsert {
  const parsed = simpleTextingMessageDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    direction: parsed.direction,
    messageKind: parsed.messageKind,
    messageTextPreview: parsed.messageTextPreview,
    normalizedPhone: parsed.normalizedPhone,
    campaignId: parsed.campaignId,
    campaignName: parsed.campaignName,
    providerThreadId: parsed.providerThreadId,
    threadKey: parsed.threadKey,
  };
}

export function mapMailchimpCampaignActivityDetailRow(
  row: MailchimpCampaignActivityDetailRow,
): MailchimpCampaignActivityDetailRecord {
  return mailchimpCampaignActivityDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType: row.activityType,
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    memberId: row.memberId,
    campaignName: row.campaignName,
    snippet: row.snippet,
  });
}

export function mapMailchimpCampaignActivityDetailToInsert(
  record: MailchimpCampaignActivityDetailRecord,
): typeof mailchimpCampaignActivityDetails.$inferInsert {
  const parsed = mailchimpCampaignActivityDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    activityType: parsed.activityType,
    campaignId: parsed.campaignId,
    audienceId: parsed.audienceId,
    memberId: parsed.memberId,
    campaignName: parsed.campaignName,
    snippet: parsed.snippet,
  };
}

export function mapManualNoteDetailRow(
  row: ManualNoteDetailRow,
): ManualNoteDetailRecord {
  return manualNoteDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    body: row.body,
    authorDisplayName: row.authorDisplayName,
    authorId: row.authorId,
  });
}

export function mapManualNoteDetailToInsert(
  record: ManualNoteDetailRecord,
): typeof manualNoteDetails.$inferInsert {
  const parsed = manualNoteDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    body: parsed.body,
    authorDisplayName: parsed.authorDisplayName,
    authorId: parsed.authorId,
  };
}

export function mapIdentityResolutionRow(
  row: IdentityResolutionRow,
): IdentityResolutionCase {
  return identityResolutionSchema.parse({
    id: row.id,
    sourceEvidenceId: row.sourceEvidenceId,
    candidateContactIds: row.candidateContactIds,
    reasonCode: row.reasonCode,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: fromDate(row.resolvedAt),
    lastAttemptedAt: fromDate(row.lastAttemptedAt),
    normalizedIdentityValues: row.normalizedIdentityValues,
    anchoredContactId: row.anchoredContactId,
    explanation: row.explanation,
  });
}

export function mapIdentityResolutionToInsert(
  record: IdentityResolutionCase,
): typeof identityResolutionQueue.$inferInsert {
  const parsed = identityResolutionSchema.parse(record);

  return {
    id: parsed.id,
    sourceEvidenceId: parsed.sourceEvidenceId,
    candidateContactIds: [...parsed.candidateContactIds],
    reasonCode: parsed.reasonCode,
    status: parsed.status,
    openedAt: toDate(parsed.openedAt),
    resolvedAt: parsed.resolvedAt === null ? null : toDate(parsed.resolvedAt),
    lastAttemptedAt:
      parsed.lastAttemptedAt == null ? null : toDate(parsed.lastAttemptedAt),
    normalizedIdentityValues: [...parsed.normalizedIdentityValues],
    anchoredContactId: parsed.anchoredContactId,
    explanation: parsed.explanation,
  };
}

export function mapRoutingReviewRow(row: RoutingReviewRow): RoutingReviewCase {
  return routingReviewSchema.parse({
    id: row.id,
    contactId: row.contactId,
    sourceEvidenceId: row.sourceEvidenceId,
    reasonCode: row.reasonCode,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: fromDate(row.resolvedAt),
    candidateMembershipIds: row.candidateMembershipIds,
    explanation: row.explanation,
  });
}

export function mapRoutingReviewToInsert(
  record: RoutingReviewCase,
): typeof routingReviewQueue.$inferInsert {
  const parsed = routingReviewSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    sourceEvidenceId: parsed.sourceEvidenceId,
    reasonCode: parsed.reasonCode,
    status: parsed.status,
    openedAt: toDate(parsed.openedAt),
    resolvedAt: parsed.resolvedAt === null ? null : toDate(parsed.resolvedAt),
    candidateMembershipIds: [...parsed.candidateMembershipIds],
    explanation: parsed.explanation,
  };
}

export function mapInboxProjectionRow(
  row: InboxProjectionRowDb,
): InboxProjectionRow {
  return inboxProjectionSchema.parse({
    contactId: row.contactId,
    bucket: row.bucket,
    needsFollowUp: row.isStarred,
    hasUnresolved: row.hasUnresolved,
    lastInboundAt: fromDate(row.lastInboundAt),
    lastOutboundAt: fromDate(row.lastOutboundAt),
    lastActivityAt: row.lastActivityAt.toISOString(),
    snippet: row.snippet,
    archivedAt: fromDate(row.archivedAt),
    lastCanonicalEventId: row.lastCanonicalEventId,
    lastEventType: row.lastEventType,
  });
}

export function mapInboxProjectionToInsert(
  record: InboxProjectionRow,
): typeof contactInboxProjection.$inferInsert {
  const parsed = inboxProjectionSchema.parse(record);

  return {
    contactId: parsed.contactId,
    bucket: parsed.bucket,
    isStarred: parsed.needsFollowUp,
    hasUnresolved: parsed.hasUnresolved,
    lastInboundAt:
      parsed.lastInboundAt === null ? null : toDate(parsed.lastInboundAt),
    lastOutboundAt:
      parsed.lastOutboundAt === null ? null : toDate(parsed.lastOutboundAt),
    lastActivityAt: toDate(parsed.lastActivityAt),
    snippet: parsed.snippet,
    archivedAt: parsed.archivedAt === null ? null : toDate(parsed.archivedAt),
    lastCanonicalEventId: parsed.lastCanonicalEventId,
    lastEventType: parsed.lastEventType,
  };
}

export function mapTimelineProjectionRow(
  row: TimelineProjectionRowDb,
): TimelineProjectionRow {
  return timelineProjectionSchema.parse({
    id: row.id,
    contactId: row.contactId,
    canonicalEventId: row.canonicalEventId,
    occurredAt: row.occurredAt.toISOString(),
    sortKey: row.sortKey,
    eventType: row.eventType,
    summary: row.summary,
    channel: row.channel,
    primaryProvider: row.primaryProvider,
    reviewState: row.reviewState,
  });
}

export function mapTimelineProjectionToInsert(
  record: TimelineProjectionRow,
): typeof contactTimelineProjection.$inferInsert {
  const parsed = timelineProjectionSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    canonicalEventId: parsed.canonicalEventId,
    occurredAt: toDate(parsed.occurredAt),
    sortKey: parsed.sortKey,
    eventType: parsed.eventType,
    summary: parsed.summary,
    channel: parsed.channel,
    primaryProvider: parsed.primaryProvider,
    reviewState: parsed.reviewState,
  };
}

export function mapSyncStateRow(row: SyncStateRow): SyncStateRecord {
  return syncStateSchema.parse({
    id: row.id,
    scope: row.scope,
    provider: row.provider,
    jobType: row.jobType,
    cursor: row.cursor,
    windowStart: fromDate(row.windowStart),
    windowEnd: fromDate(row.windowEnd),
    status: row.status,
    parityPercent:
      row.parityPercent === null ? null : Number.parseFloat(row.parityPercent),
    freshnessP95Seconds: row.freshnessP95Seconds,
    freshnessP99Seconds: row.freshnessP99Seconds,
    lastSuccessfulAt: fromDate(row.lastSuccessfulAt),
    consecutiveFailureCount: row.consecutiveFailureCount,
    leaseOwner: row.leaseOwner,
    heartbeatAt: fromDate(row.heartbeatAt),
    deadLetterCount: row.deadLetterCount,
  });
}

export function mapSyncStateToInsert(
  record: SyncStateRecord,
): typeof syncState.$inferInsert {
  const parsed = syncStateSchema.parse(record);

  return {
    id: parsed.id,
    scope: parsed.scope,
    provider: parsed.provider,
    jobType: parsed.jobType,
    cursor: parsed.cursor,
    windowStart:
      parsed.windowStart === null ? null : toDate(parsed.windowStart),
    windowEnd: parsed.windowEnd === null ? null : toDate(parsed.windowEnd),
    status: parsed.status,
    parityPercent:
      parsed.parityPercent === null ? null : parsed.parityPercent.toString(),
    freshnessP95Seconds: parsed.freshnessP95Seconds,
    freshnessP99Seconds: parsed.freshnessP99Seconds,
    lastSuccessfulAt:
      parsed.lastSuccessfulAt === null ? null : toDate(parsed.lastSuccessfulAt),
    consecutiveFailureCount: parsed.consecutiveFailureCount,
    leaseOwner: parsed.leaseOwner,
    heartbeatAt: parsed.heartbeatAt === null ? null : toDate(parsed.heartbeatAt),
    deadLetterCount: parsed.deadLetterCount,
  };
}

export function mapAuditEvidenceRow(
  row: AuditEvidenceRow,
): AuditEvidenceRecord {
  return auditEvidenceSchema.parse({
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    occurredAt: row.occurredAt.toISOString(),
    result: row.result,
    policyCode: row.policyCode,
    metadataJson: row.metadataJson,
  });
}

export function mapAuditEvidenceToInsert(
  record: AuditEvidenceRecord,
): typeof auditPolicyEvidence.$inferInsert {
  const parsed = auditEvidenceSchema.parse(record);

  return {
    id: parsed.id,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: parsed.action,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    occurredAt: toDate(parsed.occurredAt),
    result: parsed.result,
    policyCode: parsed.policyCode,
    metadataJson: parsed.metadataJson,
  };
}

export function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapUserToInsert(record: UserRecord): typeof users.$inferInsert {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    emailVerified: record.emailVerified,
    image: record.image,
    role: record.role,
    deactivatedAt: record.deactivatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapPendingComposerOutboundRow(
  row: PendingComposerOutboundRow,
): PendingComposerOutboundRecord {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status,
    actorId: row.actorId,
    canonicalContactId: row.canonicalContactId,
    projectId: row.projectId,
    fromAlias: row.fromAlias,
    toEmailNormalized: row.toEmailNormalized,
    subject: row.subject,
    bodyPlaintext: row.bodyPlaintext,
    bodyHtml: row.bodyHtml,
    bodySha256: row.bodySha256,
    attachmentMetadata: row.attachmentMetadataJson,
    gmailThreadId: row.gmailThreadId,
    inReplyToRfc822: row.inReplyToRfc822,
    attemptedAt: row.attemptedAt.toISOString(),
    reconciledEventId: row.reconciledEventId,
    reconciledAt: fromDate(row.reconciledAt),
    failedReason: row.failedReason,
    sentRfc822MessageId: row.sentRfc822MessageId,
    failedDetail: row.failedDetail,
    orphanedAt: fromDate(row.orphanedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapPendingComposerOutboundToInsert(
  record: PendingComposerOutboundRecord,
): typeof pendingComposerOutbounds.$inferInsert {
  return {
    id: record.id,
    fingerprint: record.fingerprint,
    status: record.status,
    actorId: record.actorId,
    canonicalContactId: record.canonicalContactId,
    projectId: record.projectId,
    fromAlias: record.fromAlias,
    toEmailNormalized: record.toEmailNormalized,
    subject: record.subject,
    bodyPlaintext: record.bodyPlaintext,
    bodyHtml: record.bodyHtml,
    bodySha256: record.bodySha256,
    attachmentMetadataJson: record.attachmentMetadata,
    gmailThreadId: record.gmailThreadId,
    inReplyToRfc822: record.inReplyToRfc822,
    attemptedAt: toDate(record.attemptedAt),
    reconciledEventId: record.reconciledEventId,
    reconciledAt:
      record.reconciledAt === null ? null : toDate(record.reconciledAt),
    failedReason: record.failedReason,
    sentRfc822MessageId: record.sentRfc822MessageId,
    failedDetail: record.failedDetail,
    orphanedAt: record.orphanedAt === null ? null : toDate(record.orphanedAt),
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  };
}

export function mapIntegrationBackfillJobRow(
  row: IntegrationBackfillJobRow,
): IntegrationBackfillJobRecord {
  return integrationBackfillJobSchema.parse({
    id: row.id,
    service: row.service,
    idempotencyKey: row.idempotencyKey,
    triggeredBy: row.triggeredBy,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    mailbox: row.mailbox,
    status: row.status,
    enqueuedAt: row.enqueuedAt.toISOString(),
    startedAt: fromDate(row.startedAt),
    completedAt: fromDate(row.completedAt),
    resultJson: row.resultJson,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapIntegrationBackfillJobToInsert(
  record: IntegrationBackfillJobRecord,
): typeof integrationBackfillJobs.$inferInsert {
  const parsed = integrationBackfillJobSchema.parse(record);

  return {
    id: parsed.id,
    service: parsed.service,
    idempotencyKey: parsed.idempotencyKey,
    triggeredBy: parsed.triggeredBy,
    windowStart: toDate(parsed.windowStart),
    windowEnd: toDate(parsed.windowEnd),
    mailbox: parsed.mailbox,
    status: parsed.status,
    enqueuedAt: toDate(parsed.enqueuedAt),
    startedAt: parsed.startedAt === null ? null : toDate(parsed.startedAt),
    completedAt:
      parsed.completedAt === null ? null : toDate(parsed.completedAt),
    resultJson: parsed.resultJson,
    failureReason: parsed.failureReason,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapProjectAliasRow(row: ProjectAliasRow): ProjectAliasRecord {
  return {
    id: row.id,
    alias: row.alias,
    signature: row.signature,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

export function mapProjectAliasToInsert(
  record: ProjectAliasRecord,
): typeof projectAliases.$inferInsert {
  return {
    id: record.id,
    alias: record.alias,
    signature: record.signature,
    projectId: record.projectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

export function mapSalesforceReconciliationRunRow(
  row: SalesforceReconciliationRunRow,
): SalesforceReconciliationRunRecord {
  return salesforceReconciliationRunSchema.parse({
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    completedAt: fromDate(row.completedAt),
    mode: row.mode,
    entityType: row.entityType,
    scanned: row.scanned,
    confirmedPresent: row.confirmedPresent,
    markedDeleted: row.markedDeleted,
    missingLocallyCount: row.missingLocallyCount,
    errors: row.errors,
    abortedReason: row.abortedReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapSalesforceReconciliationRunToInsert(
  record: SalesforceReconciliationRunRecord,
): typeof salesforceReconciliationRuns.$inferInsert {
  const parsed = salesforceReconciliationRunSchema.parse(record);

  return {
    id: parsed.id,
    startedAt: toDate(parsed.startedAt),
    completedAt:
      parsed.completedAt === null ? null : toDate(parsed.completedAt),
    mode: parsed.mode,
    entityType: parsed.entityType,
    scanned: parsed.scanned,
    confirmedPresent: parsed.confirmedPresent,
    markedDeleted: parsed.markedDeleted,
    missingLocallyCount: parsed.missingLocallyCount,
    errors: parsed.errors,
    abortedReason: parsed.abortedReason,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}
