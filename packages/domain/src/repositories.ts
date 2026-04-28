import type {
  AiKnowledgeEntryRecord,
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactIdentityKind,
  ContactIdentityRecord,
  ContactMembershipRecord,
  ContactRecord,
  ExpeditionDimensionRecord,
  GmailMessageDetailRecord,
  IdentityResolutionCase,
  IdentityResolutionReasonCode,
  InboxBucket,
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  MessageAttachmentRecord,
  ManualNoteDetailRecord,
  ProjectKnowledgeEntryRecord,
  ProjectDimensionRecord,
  Provider,
  RoutingReviewCase,
  RoutingReviewReasonCode,
  SalesforceCommunicationDetailRecord,
  SalesforceEventContextRecord,
  SimpleTextingMessageDetailRecord,
  SourceEvidenceRecord,
  SyncScope,
  SyncJobType,
  SyncStateRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import type { PendingComposerOutboundRecord } from "./pending-outbounds.js";

export interface SourceEvidenceRepository {
  append(record: SourceEvidenceRecord): Promise<SourceEvidenceRecord>;
  findById(id: string): Promise<SourceEvidenceRecord | null>;
  listByIds(ids: readonly string[]): Promise<readonly SourceEvidenceRecord[]>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<SourceEvidenceRecord | null>;
  countByProvider(provider: Provider): Promise<number>;
  listByProviderRecord(input: {
    readonly provider: Provider;
    readonly providerRecordType: string;
    readonly providerRecordId: string;
  }): Promise<readonly SourceEvidenceRecord[]>;
}

export interface CanonicalEventRepository {
  findById(id: string): Promise<CanonicalEventRecord | null>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CanonicalEventRecord | null>;
  listByContentFingerprintWindow(input: {
    readonly contactId: string;
    readonly channel: CanonicalEventRecord["channel"];
    readonly contentFingerprint: string;
    readonly occurredAt: string;
    readonly windowMinutes: number;
  }): Promise<readonly CanonicalEventRecord[]>;
  countAll(): Promise<number>;
  countByPrimaryProvider(provider: Provider): Promise<number>;
  countDistinctInboxContacts(): Promise<number>;
  listByIds(ids: readonly string[]): Promise<readonly CanonicalEventRecord[]>;
  listByContactId(contactId: string): Promise<readonly CanonicalEventRecord[]>;
  upsert(record: CanonicalEventRecord): Promise<CanonicalEventRecord>;
}

export interface AiKnowledgeRepository {
  findByScope(input: {
    readonly scope: "global" | "project";
    readonly scopeKey: string | null;
  }): Promise<AiKnowledgeEntryRecord | null>;
  findProjectNotionContent(projectId: string): Promise<AiKnowledgeEntryRecord | null>;
  hasProjectNotionContent(projectId: string): Promise<boolean>;
  findProjectIdsWithNotionContent(
    projectIds: readonly string[],
  ): Promise<readonly string[]>;
  upsert(record: AiKnowledgeEntryRecord): Promise<AiKnowledgeEntryRecord>;
}

export interface ProjectKnowledgeRepository {
  list(input: {
    readonly projectId: string;
    readonly approvedOnly?: boolean;
  }): Promise<readonly ProjectKnowledgeEntryRecord[]>;
  upsert(
    record: ProjectKnowledgeEntryRecord,
  ): Promise<ProjectKnowledgeEntryRecord>;
  setApproved(input: {
    readonly id: string;
    readonly approved: boolean;
    readonly reviewedAt: Date;
  }): Promise<void>;
  deleteById(id: string): Promise<void>;
  getForRetrieval(input: {
    readonly projectId: string;
    readonly issueTypeHint: string | null;
    readonly keywordsLower: readonly string[];
    readonly limitPerKind: number;
  }): Promise<readonly ProjectKnowledgeEntryRecord[]>;
}

export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  findBySalesforceContactId(
    salesforceContactId: string,
  ): Promise<ContactRecord | null>;
  listAll(): Promise<readonly ContactRecord[]>;
  listByIds(ids: readonly string[]): Promise<readonly ContactRecord[]>;
  searchByQuery(input: {
    readonly query: string;
    readonly limit: number;
  }): Promise<readonly ContactRecord[]>;
  upsert(record: ContactRecord): Promise<ContactRecord>;
}

export interface ContactIdentityRepository {
  listByContactId(contactId: string): Promise<readonly ContactIdentityRecord[]>;
  listByNormalizedValue(input: {
    readonly kind: ContactIdentityKind;
    readonly normalizedValue: string;
  }): Promise<readonly ContactIdentityRecord[]>;
  upsert(record: ContactIdentityRecord): Promise<ContactIdentityRecord>;
}

export interface ContactMembershipRepository {
  listByContactId(
    contactId: string,
  ): Promise<readonly ContactMembershipRecord[]>;
  listByContactIds(
    contactIds: readonly string[],
  ): Promise<readonly ContactMembershipRecord[]>;
  upsert(record: ContactMembershipRecord): Promise<ContactMembershipRecord>;
}

export interface ProjectDimensionRepository {
  listAll(): Promise<readonly ProjectDimensionRecord[]>;
  listActive(): Promise<readonly ProjectDimensionRecord[]>;
  listByIds(
    projectIds: readonly string[],
  ): Promise<readonly ProjectDimensionRecord[]>;
  upsert(record: ProjectDimensionRecord): Promise<ProjectDimensionRecord>;
}

export interface ExpeditionDimensionRepository {
  listByIds(
    expeditionIds: readonly string[],
  ): Promise<readonly ExpeditionDimensionRecord[]>;
  upsert(record: ExpeditionDimensionRecord): Promise<ExpeditionDimensionRecord>;
}

export interface GmailMessageDetailRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly GmailMessageDetailRecord[]>;
  listLastInboundAliasByContactIds(
    contactIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  upsert(record: GmailMessageDetailRecord): Promise<GmailMessageDetailRecord>;
}

export interface MessageAttachmentInsert {
  readonly id: string;
  readonly provider: "gmail";
  readonly gmailAttachmentId: string;
  readonly mimeType: string;
  readonly filename: string | null;
  readonly sizeBytes: number;
  readonly storageKey: string;
}

export interface MessageAttachmentRepository {
  findById(id: string): Promise<MessageAttachmentRecord | null>;
  findByMessageIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly MessageAttachmentRecord[]>;
  upsertManyForMessage(
    sourceEvidenceId: string,
    rows: readonly MessageAttachmentInsert[],
  ): Promise<void>;
}

export interface SalesforceEventContextRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly SalesforceEventContextRecord[]>;
  upsert(
    record: SalesforceEventContextRecord,
  ): Promise<SalesforceEventContextRecord>;
}

export interface SalesforceCommunicationDetailRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly SalesforceCommunicationDetailRecord[]>;
  upsert(
    record: SalesforceCommunicationDetailRecord,
  ): Promise<SalesforceCommunicationDetailRecord>;
}

export interface SimpleTextingMessageDetailRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly SimpleTextingMessageDetailRecord[]>;
  upsert(
    record: SimpleTextingMessageDetailRecord,
  ): Promise<SimpleTextingMessageDetailRecord>;
}

export interface MailchimpCampaignActivityDetailRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly MailchimpCampaignActivityDetailRecord[]>;
  upsert(
    record: MailchimpCampaignActivityDetailRecord,
  ): Promise<MailchimpCampaignActivityDetailRecord>;
}

export interface ManualNoteDetailRepository {
  listBySourceEvidenceIds(
    sourceEvidenceIds: readonly string[],
  ): Promise<readonly ManualNoteDetailRecord[]>;
  findLatestForContact(contactId: string): Promise<{
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string | null;
    readonly createdAt: string;
  } | null>;
  upsert(record: ManualNoteDetailRecord): Promise<ManualNoteDetailRecord>;
  updateBody(input: {
    readonly sourceEvidenceId: string;
    readonly authorId: string;
    readonly body: string;
  }): Promise<ManualNoteDetailRecord | null>;
  deleteByAuthor(input: {
    readonly sourceEvidenceId: string;
    readonly authorId: string;
  }): Promise<number>;
}

export interface PendingComposerOutboundRepository {
  insert(input: {
    readonly id: string;
    readonly fingerprint: string;
    readonly actorId: string;
    readonly canonicalContactId: string;
    readonly projectId: string | null;
    readonly fromAlias: string;
    readonly toEmailNormalized: string;
    readonly subject: string;
    readonly bodyPlaintext: string;
    readonly bodyHtml?: string | null;
    readonly bodySha256: string;
    readonly attachmentMetadata: PendingComposerOutboundRecord["attachmentMetadata"];
    readonly gmailThreadId: string | null;
    readonly inReplyToRfc822: string | null;
    readonly sentAt: string;
  }): Promise<string>;
  findByFingerprint(
    fingerprint: string,
  ): Promise<PendingComposerOutboundRecord | null>;
  markSentRfc822(id: string, sentRfc822MessageId: string): Promise<void>;
  findBySentRfc822MessageId(
    messageId: string,
  ): Promise<PendingComposerOutboundRecord | null>;
  markConfirmed(
    id: string,
    input: { readonly reconciledEventId: string | null },
  ): Promise<void>;
  markFailed(
    id: string,
    input: { readonly reason: string; readonly detail?: string | null },
  ): Promise<void>;
  markSuperseded(id: string): Promise<void>;
  sweepOrphans(input: { readonly olderThan: Date }): Promise<number>;
  findForContact(
    contactId: string,
    input: { readonly limit: number },
  ): Promise<readonly PendingComposerOutboundRecord[]>;
}

export interface IdentityResolutionRepository {
  findById(id: string): Promise<IdentityResolutionCase | null>;
  listOpenByContactId(
    contactId: string,
  ): Promise<readonly IdentityResolutionCase[]>;
  listOpenByReasonCode(
    reasonCode: IdentityResolutionReasonCode,
  ): Promise<readonly IdentityResolutionCase[]>;
  upsert(record: IdentityResolutionCase): Promise<IdentityResolutionCase>;
}

export interface RoutingReviewRepository {
  findById(id: string): Promise<RoutingReviewCase | null>;
  listOpenByContactId(contactId: string): Promise<readonly RoutingReviewCase[]>;
  listOpenByReasonCode(
    reasonCode: RoutingReviewReasonCode,
  ): Promise<readonly RoutingReviewCase[]>;
  upsert(record: RoutingReviewCase): Promise<RoutingReviewCase>;
}

export interface InboxProjectionRepository {
  countAll(): Promise<number>;
  countInvalidRecencyRows(): Promise<number>;
  findByContactId(contactId: string): Promise<InboxProjectionRow | null>;
  listInvalidRecencyContactIds(): Promise<readonly string[]>;
  listAllOrderedByRecency(): Promise<readonly InboxProjectionRow[]>;
  searchPageOrderedByRecency(input: {
    readonly filter: "all" | "unread" | "follow-up" | "unresolved" | "sent";
    readonly order: "last-inbound" | "last-outbound";
    readonly limit: number;
    readonly query: string;
    readonly projectId?: string | null;
    readonly cursor: {
      readonly lastInboundAt: string | null;
      readonly lastOutboundAt: string | null;
      readonly lastActivityAt: string;
      readonly contactId: string;
    } | null;
  }): Promise<{
    readonly rows: readonly InboxProjectionRow[];
    readonly total: number;
  }>;
  listPageOrderedByRecency(input: {
    readonly filter: "all" | "unread" | "follow-up" | "unresolved" | "sent";
    readonly order: "last-inbound" | "last-outbound";
    readonly limit: number;
    readonly projectId?: string | null;
    readonly cursor: {
      readonly lastInboundAt: string | null;
      readonly lastOutboundAt: string | null;
      readonly lastActivityAt: string;
      readonly contactId: string;
    } | null;
  }): Promise<readonly InboxProjectionRow[]>;
  countByFilters(input?: { readonly projectId?: string | null }): Promise<{
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
    readonly sent: number;
  }>;
  getFreshness(): Promise<{
    readonly total: number;
    readonly latestUpdatedAt: string | null;
  }>;
  getFreshnessByContactId(contactId: string): Promise<{
    readonly contactId: string;
    readonly updatedAt: string | null;
  } | null>;
  deleteByContactId(contactId: string): Promise<void>;
  setNeedsFollowUp(input: {
    readonly contactId: string;
    readonly needsFollowUp: boolean;
  }): Promise<InboxProjectionRow | null>;
  setBucket(input: {
    readonly contactId: string;
    readonly bucket: InboxBucket;
  }): Promise<InboxProjectionRow | null>;
  upsert(record: InboxProjectionRow): Promise<InboxProjectionRow>;
}

export interface TimelineProjectionRepository {
  countAll(): Promise<number>;
  findByCanonicalEventId(
    canonicalEventId: string,
  ): Promise<TimelineProjectionRow | null>;
  listByContactId(contactId: string): Promise<readonly TimelineProjectionRow[]>;
  listRecentByContactId(input: {
    readonly contactId: string;
    readonly limit: number;
    readonly beforeSortKey: string | null;
  }): Promise<readonly TimelineProjectionRow[]>;
  countByContactId(contactId: string): Promise<number>;
  getFreshnessByContactId(contactId: string): Promise<{
    readonly contactId: string;
    readonly total: number;
    readonly latestUpdatedAt: string | null;
    readonly latestSortKey: string | null;
  }>;
  upsert(record: TimelineProjectionRow): Promise<TimelineProjectionRow>;
}

export interface SyncStateRepository {
  findById(id: string): Promise<SyncStateRecord | null>;
  findLatest(input: {
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
  }): Promise<SyncStateRecord | null>;
  listAll(): Promise<readonly SyncStateRecord[]>;
  upsert(record: SyncStateRecord): Promise<SyncStateRecord>;
}

export interface AuditEvidenceRepository {
  append(record: AuditEvidenceRecord): Promise<AuditEvidenceRecord>;
  listByEntity(input: {
    readonly entityType: string;
    readonly entityId: string;
  }): Promise<readonly AuditEvidenceRecord[]>;
}

export interface Stage1RepositoryBundle {
  readonly sourceEvidence: SourceEvidenceRepository;
  readonly canonicalEvents: CanonicalEventRepository;
  readonly aiKnowledge: AiKnowledgeRepository;
  readonly projectKnowledge: ProjectKnowledgeRepository;
  readonly contacts: ContactRepository;
  readonly contactIdentities: ContactIdentityRepository;
  readonly contactMemberships: ContactMembershipRepository;
  readonly projectDimensions: ProjectDimensionRepository;
  readonly expeditionDimensions: ExpeditionDimensionRepository;
  readonly gmailMessageDetails: GmailMessageDetailRepository;
  readonly messageAttachments: MessageAttachmentRepository;
  readonly salesforceEventContext: SalesforceEventContextRepository;
  readonly salesforceCommunicationDetails: SalesforceCommunicationDetailRepository;
  readonly simpleTextingMessageDetails: SimpleTextingMessageDetailRepository;
  readonly mailchimpCampaignActivityDetails: MailchimpCampaignActivityDetailRepository;
  readonly manualNoteDetails: ManualNoteDetailRepository;
  readonly pendingOutbounds: PendingComposerOutboundRepository;
  readonly identityResolutionQueue: IdentityResolutionRepository;
  readonly routingReviewQueue: RoutingReviewRepository;
  readonly inboxProjection: InboxProjectionRepository;
  readonly timelineProjection: TimelineProjectionRepository;
  readonly syncState: SyncStateRepository;
  readonly auditEvidence: AuditEvidenceRepository;
}

export function defineStage1RepositoryBundle<T extends Stage1RepositoryBundle>(
  bundle: T,
): T {
  return bundle;
}
