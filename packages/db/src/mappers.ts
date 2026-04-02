import {
  auditEvidenceSchema,
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  identityResolutionSchema,
  inboxProjectionSchema,
  projectDimensionSchema,
  routingReviewSchema,
  salesforceEventContextSchema,
  sourceEvidenceSchema,
  syncStateSchema,
  timelineProjectionSchema,
  type AuditEvidenceRecord,
  type CanonicalEventRecord,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IdentityResolutionCase,
  type InboxProjectionRow,
  type ProjectDimensionRecord,
  type RoutingReviewCase,
  type SalesforceEventContextRecord,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type TimelineProjectionRow
} from "@as-comms/contracts";

import type {
  auditPolicyEvidence,
  canonicalEventLedger,
  contactIdentities,
  contactInboxProjection,
  contactMemberships,
  contactTimelineProjection,
  contacts,
  expeditionDimensions,
  gmailMessageDetails,
  identityResolutionQueue,
  projectDimensions,
  routingReviewQueue,
  salesforceEventContext,
  sourceEvidenceLog,
  syncState
} from "./schema/index.js";

type SourceEvidenceRow = typeof sourceEvidenceLog.$inferSelect;
type CanonicalEventRow = typeof canonicalEventLedger.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type ContactIdentityRow = typeof contactIdentities.$inferSelect;
type ContactMembershipRow = typeof contactMemberships.$inferSelect;
type ProjectDimensionRow = typeof projectDimensions.$inferSelect;
type ExpeditionDimensionRow = typeof expeditionDimensions.$inferSelect;
type GmailMessageDetailRow = typeof gmailMessageDetails.$inferSelect;
type SalesforceEventContextRow = typeof salesforceEventContext.$inferSelect;
type IdentityResolutionRow = typeof identityResolutionQueue.$inferSelect;
type RoutingReviewRow = typeof routingReviewQueue.$inferSelect;
type InboxProjectionRowDb = typeof contactInboxProjection.$inferSelect;
type TimelineProjectionRowDb = typeof contactTimelineProjection.$inferSelect;
type SyncStateRow = typeof syncState.$inferSelect;
type AuditEvidenceRow = typeof auditPolicyEvidence.$inferSelect;

function fromDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toDate(value: string): Date {
  return new Date(value);
}

export function mapSourceEvidenceRow(row: SourceEvidenceRow): SourceEvidenceRecord {
  return sourceEvidenceSchema.parse({
    id: row.id,
    provider: row.provider,
    providerRecordType: row.providerRecordType,
    providerRecordId: row.providerRecordId,
    receivedAt: row.receivedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    payloadRef: row.payloadRef,
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum
  });
}

export function mapSourceEvidenceToInsert(
  record: SourceEvidenceRecord
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
    checksum: parsed.checksum
  };
}

export function mapCanonicalEventRow(row: CanonicalEventRow): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: row.id,
    contactId: row.contactId,
    eventType: row.eventType,
    channel: row.channel,
    occurredAt: row.occurredAt.toISOString(),
    sourceEvidenceId: row.sourceEvidenceId,
    idempotencyKey: row.idempotencyKey,
    provenance: row.provenance,
    reviewState: row.reviewState
  });
}

export function mapCanonicalEventToInsert(
  record: CanonicalEventRecord
): typeof canonicalEventLedger.$inferInsert {
  const parsed = canonicalEventSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    eventType: parsed.eventType,
    channel: parsed.channel,
    occurredAt: toDate(parsed.occurredAt),
    sourceEvidenceId: parsed.sourceEvidenceId,
    idempotencyKey: parsed.idempotencyKey,
    provenance: parsed.provenance,
    reviewState: parsed.reviewState
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
    updatedAt: row.updatedAt.toISOString()
  });
}

export function mapContactToInsert(
  record: ContactRecord
): typeof contacts.$inferInsert {
  const parsed = contactSchema.parse(record);

  return {
    id: parsed.id,
    salesforceContactId: parsed.salesforceContactId,
    displayName: parsed.displayName,
    primaryEmail: parsed.primaryEmail,
    primaryPhone: parsed.primaryPhone,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt)
  };
}

export function mapContactIdentityRow(
  row: ContactIdentityRow
): ContactIdentityRecord {
  return contactIdentitySchema.parse({
    id: row.id,
    contactId: row.contactId,
    kind: row.kind,
    normalizedValue: row.normalizedValue,
    isPrimary: row.isPrimary,
    source: row.source,
    verifiedAt: fromDate(row.verifiedAt)
  });
}

export function mapContactIdentityToInsert(
  record: ContactIdentityRecord
): typeof contactIdentities.$inferInsert {
  const parsed = contactIdentitySchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    kind: parsed.kind,
    normalizedValue: parsed.normalizedValue,
    isPrimary: parsed.isPrimary,
    source: parsed.source,
    verifiedAt: parsed.verifiedAt === null ? null : toDate(parsed.verifiedAt)
  };
}

export function mapContactMembershipRow(
  row: ContactMembershipRow
): ContactMembershipRecord {
  return contactMembershipSchema.parse({
    id: row.id,
    contactId: row.contactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    role: row.role,
    status: row.status,
    source: row.source
  });
}

export function mapContactMembershipToInsert(
  record: ContactMembershipRecord
): typeof contactMemberships.$inferInsert {
  const parsed = contactMembershipSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId,
    role: parsed.role,
    status: parsed.status,
    source: parsed.source
  };
}

export function mapProjectDimensionRow(
  row: ProjectDimensionRow
): ProjectDimensionRecord {
  return projectDimensionSchema.parse({
    projectId: row.projectId,
    projectName: row.projectName,
    source: row.source
  });
}

export function mapProjectDimensionToInsert(
  record: ProjectDimensionRecord
): typeof projectDimensions.$inferInsert {
  const parsed = projectDimensionSchema.parse(record);

  return {
    projectId: parsed.projectId,
    projectName: parsed.projectName,
    source: parsed.source
  };
}

export function mapExpeditionDimensionRow(
  row: ExpeditionDimensionRow
): ExpeditionDimensionRecord {
  return expeditionDimensionSchema.parse({
    expeditionId: row.expeditionId,
    projectId: row.projectId,
    expeditionName: row.expeditionName,
    source: row.source
  });
}

export function mapExpeditionDimensionToInsert(
  record: ExpeditionDimensionRecord
): typeof expeditionDimensions.$inferInsert {
  const parsed = expeditionDimensionSchema.parse(record);

  return {
    expeditionId: parsed.expeditionId,
    projectId: parsed.projectId,
    expeditionName: parsed.expeditionName,
    source: parsed.source
  };
}

export function mapGmailMessageDetailRow(
  row: GmailMessageDetailRow
): GmailMessageDetailRecord {
  return gmailMessageDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    gmailThreadId: row.gmailThreadId,
    rfc822MessageId: row.rfc822MessageId,
    direction: row.direction,
    subject: row.subject,
    snippetClean: row.snippetClean,
    bodyTextPreview: row.bodyTextPreview,
    capturedMailbox: row.capturedMailbox,
    projectInboxAlias: row.projectInboxAlias
  });
}

export function mapGmailMessageDetailToInsert(
  record: GmailMessageDetailRecord
): typeof gmailMessageDetails.$inferInsert {
  const parsed = gmailMessageDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    gmailThreadId: parsed.gmailThreadId,
    rfc822MessageId: parsed.rfc822MessageId,
    direction: parsed.direction,
    subject: parsed.subject,
    snippetClean: parsed.snippetClean,
    bodyTextPreview: parsed.bodyTextPreview,
    capturedMailbox: parsed.capturedMailbox,
    projectInboxAlias: parsed.projectInboxAlias
  };
}

export function mapSalesforceEventContextRow(
  row: SalesforceEventContextRow
): SalesforceEventContextRecord {
  return salesforceEventContextSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    salesforceContactId: row.salesforceContactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId
  });
}

export function mapSalesforceEventContextToInsert(
  record: SalesforceEventContextRecord
): typeof salesforceEventContext.$inferInsert {
  const parsed = salesforceEventContextSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    salesforceContactId: parsed.salesforceContactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId
  };
}

export function mapIdentityResolutionRow(
  row: IdentityResolutionRow
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
    explanation: row.explanation
  });
}

export function mapIdentityResolutionToInsert(
  record: IdentityResolutionCase
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
    explanation: parsed.explanation
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
    explanation: row.explanation
  });
}

export function mapRoutingReviewToInsert(
  record: RoutingReviewCase
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
    explanation: parsed.explanation
  };
}

export function mapInboxProjectionRow(
  row: InboxProjectionRowDb
): InboxProjectionRow {
  return inboxProjectionSchema.parse({
    contactId: row.contactId,
    bucket: row.bucket,
    isStarred: row.isStarred,
    hasUnresolved: row.hasUnresolved,
    lastInboundAt: fromDate(row.lastInboundAt),
    lastOutboundAt: fromDate(row.lastOutboundAt),
    lastActivityAt: row.lastActivityAt.toISOString(),
    snippet: row.snippet,
    lastCanonicalEventId: row.lastCanonicalEventId,
    lastEventType: row.lastEventType
  });
}

export function mapInboxProjectionToInsert(
  record: InboxProjectionRow
): typeof contactInboxProjection.$inferInsert {
  const parsed = inboxProjectionSchema.parse(record);

  return {
    contactId: parsed.contactId,
    bucket: parsed.bucket,
    isStarred: parsed.isStarred,
    hasUnresolved: parsed.hasUnresolved,
    lastInboundAt:
      parsed.lastInboundAt === null ? null : toDate(parsed.lastInboundAt),
    lastOutboundAt:
      parsed.lastOutboundAt === null ? null : toDate(parsed.lastOutboundAt),
    lastActivityAt: toDate(parsed.lastActivityAt),
    snippet: parsed.snippet,
    lastCanonicalEventId: parsed.lastCanonicalEventId,
    lastEventType: parsed.lastEventType
  };
}

export function mapTimelineProjectionRow(
  row: TimelineProjectionRowDb
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
    reviewState: row.reviewState
  });
}

export function mapTimelineProjectionToInsert(
  record: TimelineProjectionRow
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
    reviewState: parsed.reviewState
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
    deadLetterCount: row.deadLetterCount
  });
}

export function mapSyncStateToInsert(
  record: SyncStateRecord
): typeof syncState.$inferInsert {
  const parsed = syncStateSchema.parse(record);

  return {
    id: parsed.id,
    scope: parsed.scope,
    provider: parsed.provider,
    jobType: parsed.jobType,
    cursor: parsed.cursor,
    windowStart: parsed.windowStart === null ? null : toDate(parsed.windowStart),
    windowEnd: parsed.windowEnd === null ? null : toDate(parsed.windowEnd),
    status: parsed.status,
    parityPercent:
      parsed.parityPercent === null ? null : parsed.parityPercent.toString(),
    freshnessP95Seconds: parsed.freshnessP95Seconds,
    freshnessP99Seconds: parsed.freshnessP99Seconds,
    lastSuccessfulAt:
      parsed.lastSuccessfulAt === null ? null : toDate(parsed.lastSuccessfulAt),
    deadLetterCount: parsed.deadLetterCount
  };
}

export function mapAuditEvidenceRow(row: AuditEvidenceRow): AuditEvidenceRecord {
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
    metadataJson: row.metadataJson
  });
}

export function mapAuditEvidenceToInsert(
  record: AuditEvidenceRecord
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
    metadataJson: parsed.metadataJson
  };
}
