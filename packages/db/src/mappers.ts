import {
  aiKnowledgeEntrySchema,
  auditEvidenceSchema,
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  integrationHealthSchema,
  identityResolutionSchema,
  inboxProjectionSchema,
  mailchimpCampaignActivityDetailSchema,
  manualNoteDetailSchema,
  projectDimensionSchema,
  routingReviewSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  simpleTextingMessageDetailSchema,
  sourceEvidenceSchema,
  syncStateSchema,
  timelineProjectionSchema,
  type AuditEvidenceRecord,
  type AiKnowledgeEntryRecord,
  type CanonicalEventRecord,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IntegrationHealthRecord,
  type IdentityResolutionCase,
  type InboxProjectionRow,
  type MailchimpCampaignActivityDetailRecord,
  type ManualNoteDetailRecord,
  type ProjectDimensionRecord,
  type RoutingReviewCase,
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
  UserRecord,
} from "@as-comms/domain";

import type {
  aiKnowledgeEntries,
  auditPolicyEvidence,
  canonicalEventLedger,
  contactIdentities,
  contactInboxProjection,
  contactMemberships,
  contactTimelineProjection,
  contacts,
  expeditionDimensions,
  gmailMessageDetails,
  integrationHealth,
  identityResolutionQueue,
  mailchimpCampaignActivityDetails,
  manualNoteDetails,
  pendingComposerOutbounds,
  projectAliases,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceEventContext,
  simpleTextingMessageDetails,
  sourceEvidenceLog,
  syncState,
  users,
} from "./schema/index.js";

type SourceEvidenceRow = typeof sourceEvidenceLog.$inferSelect;
type AiKnowledgeEntryRow = typeof aiKnowledgeEntries.$inferSelect;
type CanonicalEventRow = typeof canonicalEventLedger.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type ContactIdentityRow = typeof contactIdentities.$inferSelect;
type ContactMembershipRow = typeof contactMemberships.$inferSelect;
type ProjectDimensionRow = typeof projectDimensions.$inferSelect;
type ExpeditionDimensionRow = typeof expeditionDimensions.$inferSelect;
type GmailMessageDetailRow = typeof gmailMessageDetails.$inferSelect;
type IntegrationHealthRow = typeof integrationHealth.$inferSelect;
type SalesforceEventContextRow = typeof salesforceEventContext.$inferSelect;
type SalesforceCommunicationDetailRow =
  typeof salesforceCommunicationDetails.$inferSelect;
type SimpleTextingMessageDetailRow =
  typeof simpleTextingMessageDetails.$inferSelect;
type MailchimpCampaignActivityDetailRow =
  typeof mailchimpCampaignActivityDetails.$inferSelect;
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

export function mapContactRow(row: ContactRow): ContactRecord {
  return contactSchema.parse({
    id: row.id,
    salesforceContactId: row.salesforceContactId,
    displayName: row.displayName,
    primaryEmail: row.primaryEmail,
    primaryPhone: row.primaryPhone,
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
  row: ContactMembershipRow,
): ContactMembershipRecord {
  return contactMembershipSchema.parse({
    id: row.id,
    contactId: row.contactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    role: row.role,
    status: row.status,
    source: row.source,
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
    role: parsed.role,
    status: parsed.status,
    source: parsed.source,
  };
}

export function mapProjectDimensionRow(
  row: ProjectDimensionRow,
): ProjectDimensionRecord {
  return projectDimensionSchema.parse({
    projectId: row.projectId,
    projectName: row.projectName,
    projectAlias: row.projectAlias,
    source: row.source,
    isActive: row.isActive,
    aiKnowledgeUrl: row.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: fromDate(row.aiKnowledgeSyncedAt),
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
    isActive: parsed.isActive ?? false,
    aiKnowledgeUrl: parsed.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt:
      parsed.aiKnowledgeSyncedAt === undefined ||
      parsed.aiKnowledgeSyncedAt === null
        ? null
        : toDate(parsed.aiKnowledgeSyncedAt),
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
    labelIds: row.labelIds,
    snippetClean: row.snippetClean,
    bodyTextPreview: row.bodyTextPreview,
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
    labelIds: parsed.labelIds,
    snippetClean: parsed.snippetClean,
    bodyTextPreview: parsed.bodyTextPreview,
    capturedMailbox: parsed.capturedMailbox,
    projectInboxAlias: parsed.projectInboxAlias,
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
    bodySha256: row.bodySha256,
    attachmentMetadata: row.attachmentMetadataJson,
    gmailThreadId: row.gmailThreadId,
    inReplyToRfc822: row.inReplyToRfc822,
    sentAt: row.sentAt.toISOString(),
    reconciledEventId: row.reconciledEventId,
    reconciledAt: fromDate(row.reconciledAt),
    failedReason: row.failedReason,
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
    bodySha256: record.bodySha256,
    attachmentMetadataJson: record.attachmentMetadata,
    gmailThreadId: record.gmailThreadId,
    inReplyToRfc822: record.inReplyToRfc822,
    sentAt: toDate(record.sentAt),
    reconciledEventId: record.reconciledEventId,
    reconciledAt:
      record.reconciledAt === null ? null : toDate(record.reconciledAt),
    failedReason: record.failedReason,
    orphanedAt: record.orphanedAt === null ? null : toDate(record.orphanedAt),
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
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
