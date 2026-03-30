import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactIdentityKind,
  ContactIdentityRecord,
  ContactMembershipRecord,
  ContactRecord,
  IdentityResolutionCase,
  IdentityResolutionReasonCode,
  InboxProjectionRow,
  Provider,
  RoutingReviewCase,
  RoutingReviewReasonCode,
  SourceEvidenceRecord,
  SyncScope,
  SyncJobType,
  SyncStateRecord,
  TimelineProjectionRow
} from "@as-comms/contracts";

export interface SourceEvidenceRepository {
  append(record: SourceEvidenceRecord): Promise<SourceEvidenceRecord>;
  findById(id: string): Promise<SourceEvidenceRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<SourceEvidenceRecord | null>;
  countByProvider(provider: Provider): Promise<number>;
  listByProviderRecord(input: {
    readonly provider: Provider;
    readonly providerRecordType: string;
    readonly providerRecordId: string;
  }): Promise<readonly SourceEvidenceRecord[]>;
}

export interface CanonicalEventRepository {
  findById(id: string): Promise<CanonicalEventRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<CanonicalEventRecord | null>;
  countAll(): Promise<number>;
  countByPrimaryProvider(provider: Provider): Promise<number>;
  countDistinctInboxContacts(): Promise<number>;
  listByContactId(contactId: string): Promise<readonly CanonicalEventRecord[]>;
  upsert(record: CanonicalEventRecord): Promise<CanonicalEventRecord>;
}

export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  findBySalesforceContactId(
    salesforceContactId: string
  ): Promise<ContactRecord | null>;
  listAll(): Promise<readonly ContactRecord[]>;
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
    contactId: string
  ): Promise<readonly ContactMembershipRecord[]>;
  upsert(record: ContactMembershipRecord): Promise<ContactMembershipRecord>;
}

export interface IdentityResolutionRepository {
  findById(id: string): Promise<IdentityResolutionCase | null>;
  listOpenByReasonCode(
    reasonCode: IdentityResolutionReasonCode
  ): Promise<readonly IdentityResolutionCase[]>;
  upsert(record: IdentityResolutionCase): Promise<IdentityResolutionCase>;
}

export interface RoutingReviewRepository {
  findById(id: string): Promise<RoutingReviewCase | null>;
  listOpenByReasonCode(
    reasonCode: RoutingReviewReasonCode
  ): Promise<readonly RoutingReviewCase[]>;
  upsert(record: RoutingReviewCase): Promise<RoutingReviewCase>;
}

export interface InboxProjectionRepository {
  countAll(): Promise<number>;
  findByContactId(contactId: string): Promise<InboxProjectionRow | null>;
  upsert(record: InboxProjectionRow): Promise<InboxProjectionRow>;
}

export interface TimelineProjectionRepository {
  countAll(): Promise<number>;
  findByCanonicalEventId(canonicalEventId: string): Promise<TimelineProjectionRow | null>;
  listByContactId(contactId: string): Promise<readonly TimelineProjectionRow[]>;
  upsert(record: TimelineProjectionRow): Promise<TimelineProjectionRow>;
}

export interface SyncStateRepository {
  findById(id: string): Promise<SyncStateRecord | null>;
  findLatest(input: {
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
  }): Promise<SyncStateRecord | null>;
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
  readonly identityResolutionQueue: IdentityResolutionRepository;
  readonly routingReviewQueue: RoutingReviewRepository;
  readonly inboxProjection: InboxProjectionRepository;
  readonly timelineProjection: TimelineProjectionRepository;
  readonly syncState: SyncStateRepository;
  readonly auditEvidence: AuditEvidenceRepository;
}

export function defineStage1RepositoryBundle<T extends Stage1RepositoryBundle>(
  bundle: T
): T {
  return bundle;
}
