import type {
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
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  ManualNoteDetailRecord,
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
  countAll(): Promise<number>;
  countByPrimaryProvider(provider: Provider): Promise<number>;
  countDistinctInboxContacts(): Promise<number>;
  listByIds(ids: readonly string[]): Promise<readonly CanonicalEventRecord[]>;
  listByContactId(contactId: string): Promise<readonly CanonicalEventRecord[]>;
  upsert(record: CanonicalEventRecord): Promise<CanonicalEventRecord>;
}

export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  findBySalesforceContactId(
    salesforceContactId: string,
  ): Promise<ContactRecord | null>;
  listAll(): Promise<readonly ContactRecord[]>;
  listByIds(ids: readonly string[]): Promise<readonly ContactRecord[]>;
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
  upsert(record: GmailMessageDetailRecord): Promise<GmailMessageDetailRecord>;
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
  upsert(record: ManualNoteDetailRecord): Promise<ManualNoteDetailRecord>;
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
    readonly filter: "all" | "unread" | "follow-up" | "unresolved";
    readonly limit: number;
    readonly query: string;
    readonly projectId?: string | null;
    readonly cursor: {
      readonly lastInboundAt: string | null;
      readonly lastActivityAt: string;
      readonly contactId: string;
    } | null;
  }): Promise<{
    readonly rows: readonly InboxProjectionRow[];
    readonly total: number;
  }>;
  listPageOrderedByRecency(input: {
    readonly filter: "all" | "unread" | "follow-up" | "unresolved";
    readonly limit: number;
    readonly projectId?: string | null;
    readonly cursor: {
      readonly lastInboundAt: string | null;
      readonly lastActivityAt: string;
      readonly contactId: string;
    } | null;
  }): Promise<readonly InboxProjectionRow[]>;
  countByFilters(input?: { readonly projectId?: string | null }): Promise<{
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
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
  readonly contacts: ContactRepository;
  readonly contactIdentities: ContactIdentityRepository;
  readonly contactMemberships: ContactMembershipRepository;
  readonly projectDimensions: ProjectDimensionRepository;
  readonly expeditionDimensions: ExpeditionDimensionRepository;
  readonly gmailMessageDetails: GmailMessageDetailRepository;
  readonly salesforceEventContext: SalesforceEventContextRepository;
  readonly salesforceCommunicationDetails: SalesforceCommunicationDetailRepository;
  readonly simpleTextingMessageDetails: SimpleTextingMessageDetailRepository;
  readonly mailchimpCampaignActivityDetails: MailchimpCampaignActivityDetailRepository;
  readonly manualNoteDetails: ManualNoteDetailRepository;
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
