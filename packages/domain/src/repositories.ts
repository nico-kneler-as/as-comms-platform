import type {
  AiKnowledgeSource,
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
import type {
  ConsentRecord,
  SmsMessageRecord,
  SmsSenderRecord,
} from "./records.js";

export type SourceEvidenceQuarantineReason =
  | "checksum_mismatch"
  | "superseded_canonical";

export interface SourceEvidenceRepository {
  append(record: SourceEvidenceRecord): Promise<SourceEvidenceRecord>;
  // Replaces the canonical row matched by (provider, idempotency_key) with
  // the incoming record's mutable fields, preserving the existing row id.
  // Used by the supersede branch in recordSourceEvidence so downstream FK
  // references to source_evidence_id stay valid across capture-mapper
  // refinements.
  replaceByIdempotencyKey(
    record: SourceEvidenceRecord,
  ): Promise<SourceEvidenceRecord>;
  findById(id: string): Promise<SourceEvidenceRecord | null>;
  listByIds(ids: readonly string[]): Promise<readonly SourceEvidenceRecord[]>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<SourceEvidenceRecord | null>;
  listIdempotencyChecksumCollisions(input: {
    readonly limit: number;
    readonly beforeTimestamp?: Date;
  }): Promise<{
    readonly entries: readonly SourceEvidenceCollisionEntry[];
    readonly hasMore: boolean;
  }>;
  countByProvider(provider: Provider): Promise<number>;
  listByProviderRecord(input: {
    readonly provider: Provider;
    readonly providerRecordType: string;
    readonly providerRecordId: string;
  }): Promise<readonly SourceEvidenceRecord[]>;
}

export interface SourceEvidenceQuarantineInput {
  readonly provider: Provider;
  readonly idempotencyKey: string;
  readonly checksum: string;
  readonly attemptedAt: Date;
  readonly reason: SourceEvidenceQuarantineReason;
  readonly payloadRef: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SourceEvidenceQuarantineRecord extends SourceEvidenceQuarantineInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface SourceEvidenceQuarantineRepository {
  record(
    input: SourceEvidenceQuarantineInput,
  ): Promise<SourceEvidenceQuarantineRecord>;
  listRecent(input: {
    readonly limit: number;
    readonly beforeTimestamp?: Date;
  }): Promise<{
    readonly entries: readonly SourceEvidenceQuarantineRecord[];
    readonly hasMore: boolean;
  }>;
}

export interface SourceEvidenceCollisionEntry {
  readonly provider: Provider;
  readonly idempotencyKey: string;
  readonly latestReceivedAt: Date;
  readonly winning: {
    readonly sourceEvidenceId: string;
    readonly checksum: string;
    readonly receivedAt: Date;
  };
  readonly losing: readonly {
    readonly quarantineId: string;
    readonly checksum: string;
    readonly attemptedAt: Date;
  }[];
}

export interface CanonicalEventRepository {
  findById(id: string): Promise<CanonicalEventRecord | null>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CanonicalEventRecord | null>;
  findBySourceEvidenceId(
    sourceEvidenceId: string,
    eventType: CanonicalEventRecord["eventType"],
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
  listByContactIds(
    contactIds: readonly string[],
  ): Promise<readonly CanonicalEventRecord[]>;
  upsert(record: CanonicalEventRecord): Promise<CanonicalEventRecord>;
}

export interface AiKnowledgeRepository {
  findByScope(input: {
    readonly scope: "global" | "project";
    readonly scopeKey: string | null;
  }): Promise<AiKnowledgeEntryRecord | null>;
  findProjectNotionContent(
    projectId: string,
  ): Promise<AiKnowledgeEntryRecord | null>;
  /**
   * Like {@link findProjectNotionContent}, but transparently falls back to
   * the host project's cached Notion content when `projectId` refers to a
   * connected sub-project (one with `project_dimensions.connected_to_project_id`
   * set). Used by the AI Draft retriever so a thread tagged with the sub's
   * project_id still gets the host-curated grounding.
   *
   * Settings + sync code paths must NOT call this — they need the raw
   * project's content keyed by its own id.
   */
  findEffectiveProjectNotionContent(
    projectId: string,
  ): Promise<AiKnowledgeEntryRecord | null>;
  hasProjectNotionContent(projectId: string): Promise<boolean>;
  /**
   * Returns the subset of input project IDs whose effective project has had
   * AI Knowledge synthesis run at least once — i.e.
   * `ai_optimized_synthesized_at IS NOT NULL`. Connected sub-projects
   * transparently hop to their host's synthesis timestamp (same semantics as
   * {@link findEffectiveProjectNotionContent} for the bulk path).
   *
   * This is the chip-facing signal (composer "Knowledge Base" indicator).
   * It reflects whether synthesis has produced a published AI Knowledge
   * document, not whether the Notion -> cache sync has populated
   * `ai_knowledge_entries`.
   */
  findProjectIdsWithAiKnowledgeConfigured(
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
  /**
   * Count approved-for-AI rows for a project captured strictly after the
   * given timestamp. Pass `null` to count every approved-for-AI row in the
   * project (useful when synthesis has never run).
   *
   * Used by the Phase 3 capture-trigger path to decide whether enough new
   * approved replies have accumulated to re-synthesize.
   */
  countCapturedSinceTimestamp(input: {
    readonly projectId: string;
    readonly since: Date | null;
  }): Promise<number>;
}

export interface InboxUnifiedSearchMembership {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias: string | null;
}

/**
 * One result row from the unified inbox search. Whether the contact has an
 * inbox-projection row or not is signalled by `hasProjection` and the
 * thread-metadata fields below it; the renderer picks between the two row
 * formats (conversation row vs contact-only row) based on those.
 */
export interface InboxUnifiedSearchRow {
  readonly contact: ContactRecord;
  readonly memberships: readonly InboxUnifiedSearchMembership[];
  /**
   * True when the contact has at least one row in `contact_memberships`,
   * regardless of whether the membership is active or past. Drives the
   * Volunteers / Contacts partition on the client.
   */
  readonly hasMembership: boolean;
  /**
   * MAX(canonicalEventLedger.occurredAt) WHERE event_type is
   * volunteer-initiated (lifecycle.* + inbound 1:1 comm + sms.opt_*).
   * Excludes outbound 1:1 sends, all campaign events, and internal notes
   * so an operator's reply doesn't bump a contact to the top. Drives the
   * "last activity" sort key and timestamp label. Null when the contact has
   * no qualifying events at all.
   */
  readonly lastActivityAt: string | null;
  /**
   * True when the contact has a row in `contact_inbox_projection`. Drives the
   * choice between the conversation-row format and the contact-only row
   * format on the client.
   */
  readonly hasProjection: boolean;
  /**
   * Latest message snippet from the inbox projection, when available. Only
   * present for projection contacts. May still be empty string when the
   * projection row was upserted with an empty snippet.
   */
  readonly snippet: string | null;
  /**
   * Latest message subject resolved from the projection's
   * `last_canonical_event_id` join (gmail or salesforce comm details). Null
   * for non-projection contacts or when the linked source had no subject.
   */
  readonly latestMessageSubject: string | null;
  /**
   * Last canonical event type from the inbox projection, used by the client to
   * pick channel icons. Null for non-projection contacts.
   */
  readonly lastEventType: CanonicalEventRecord["eventType"] | null;
}

/**
 * Two-section unified search result. Both sections match on contact
 * attributes (display name, primary email, primary phone) and partition the
 * matched contacts by membership-existence:
 *
 * - `volunteers`: contacts with at least one `contact_memberships` row
 *   (active OR past).
 * - `contacts`: contacts with zero membership rows.
 *
 * Each section is sorted by `lastActivityAt` desc (volunteer-initiated
 * events only — see {@link InboxUnifiedSearchRow.lastActivityAt}) with NULL
 * last and `contacts.created_at` desc as the tiebreaker, then capped at the
 * `limit` passed in. `totals` exposes the count BEFORE truncation so the UI
 * can show "X+ results".
 */
export interface InboxUnifiedSearchResult {
  readonly volunteers: readonly InboxUnifiedSearchRow[];
  readonly contacts: readonly InboxUnifiedSearchRow[];
  readonly totals: {
    readonly volunteers: number;
    readonly contacts: number;
  };
}

export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  findBySalesforceContactId(
    salesforceContactId: string,
  ): Promise<ContactRecord | null>;
  findByPrimaryPhone(phoneE164: string): Promise<ContactRecord | null>;
  listAll(): Promise<readonly ContactRecord[]>;
  listByIds(ids: readonly string[]): Promise<readonly ContactRecord[]>;
  searchByQuery(input: {
    readonly query: string;
    readonly limit: number;
  }): Promise<readonly ContactRecord[]>;
  /**
   * Unified inbox search. Returns contacts matching name / primary email /
   * primary phone (ILIKE), partitioned by whether the contact has any
   * `contact_memberships` row (active OR past):
   *
   * - `volunteers`: matched contacts with at least one membership.
   * - `contacts`: matched contacts with zero memberships.
   *
   * Both sections are sorted by `lastActivityAt` desc — restricted to
   * volunteer-initiated events (lifecycle.* + inbound 1:1 communication +
   * sms.opt_*) so outbound sends and campaign events don't bump a contact
   * to the top — and capped at `limit`.
   */
  searchInboxUnified(input: {
    readonly query: string;
    readonly limit: number;
  }): Promise<InboxUnifiedSearchResult>;
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

export interface SmsMessageRepository {
  insert(record: SmsMessageRecord): Promise<SmsMessageRecord>;
  findByTwilioSid(sid: string): Promise<SmsMessageRecord | null>;
  findLatestByStatuses(
    statuses: readonly SmsMessageRecord["sendStatus"][],
  ): Promise<SmsMessageRecord | null>;
  hasInboundForPhone(phoneE164: string): Promise<boolean>;
  listByContact(
    contactId: string,
    limit?: number,
  ): Promise<readonly SmsMessageRecord[]>;
  updateDelivery(input: {
    readonly messageId: string;
    readonly twilioMessageSid?: string | null;
    readonly status: SmsMessageRecord["sendStatus"];
    readonly failedReason?: string | null;
    readonly failedDetail?: string | null;
    readonly sentAt?: Date | null;
  }): Promise<SmsMessageRecord | null>;
  updateSendStatus(
    messageId: string,
    status: SmsMessageRecord["sendStatus"],
    failedReason?: string | null,
    failedDetail?: string | null,
    sentAt?: Date | null,
  ): Promise<SmsMessageRecord | null>;
}

export interface ConsentRecordRepository {
  findLatestByPhone(phoneE164: string): Promise<ConsentRecord | null>;
  findLatestByContact(contactId: string): Promise<ConsentRecord | null>;
  insert(record: ConsentRecord): Promise<ConsentRecord>;
}

export interface SmsSenderRepository {
  listActive(): Promise<readonly SmsSenderRecord[]>;
  findById(id: string): Promise<SmsSenderRecord | null>;
  findByPhone(phoneE164: string): Promise<SmsSenderRecord | null>;
  getActiveUsageSnapshot(input: { readonly monthStart: Date }): Promise<{
    readonly monthlyCap: number | null;
    readonly monthToDateSegments: number;
  } | null>;
}

/**
 * Effective (i.e. resolved-after-fallback) AI knowledge bundle for a project.
 *
 * - `projectId` is the project the caller asked about.
 * - `resolvedFromProjectId` is the project the values were actually read from.
 *   Equal to `projectId` when the project is a host or standalone; equal to
 *   the host's id when the project is a connected sub.
 * - The remaining fields mirror the AI-knowledge columns on
 *   {@link ProjectDimensionRecord} so the AI Draft pipeline can use them
 *   without caring whether the project is a sub or a host.
 */
export interface EffectiveAiKnowledge {
  readonly projectId: string;
  readonly resolvedFromProjectId: string;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSources: readonly AiKnowledgeSource[];
  readonly aiOperatingContext: string;
  readonly aiAutoSyncSchedule: "never" | "daily" | "weekly";
  readonly aiOptimizedSynthesizedAt: string | null;
  readonly aiOptimizedInputHash: string | null;
}

export interface ProjectDimensionRepository {
  findById(projectId: string): Promise<ProjectDimensionRecord | null>;
  listAll(): Promise<readonly ProjectDimensionRecord[]>;
  listActive(): Promise<readonly ProjectDimensionRecord[]>;
  listByIds(
    projectIds: readonly string[],
  ): Promise<readonly ProjectDimensionRecord[]>;
  /**
   * Returns active projects whose `connected_to_project_id` points at the
   * given host. Ordered by project name.
   */
  listConnectedProjects(
    hostProjectId: string,
  ): Promise<readonly ProjectDimensionRecord[]>;
  /**
   * Returns candidates eligible to be connected: inactive rows with no
   * existing connection. Ordered by project name.
   */
  listAvailableConnectionCandidates(): Promise<
    readonly ProjectDimensionRecord[]
  >;
  /**
   * Returns the AI-knowledge bundle the synthesis + draft pipelines should
   * use for `projectId`, transparently inheriting from the host when the
   * row is a connected sub-project.
   *
   * Settings code paths must NOT call this — they need the raw stored value
   * (see {@link findById}). Use this only when you want the inherited /
   * "effective" value.
   */
  findEffectiveAiKnowledge(
    projectId: string,
  ): Promise<EffectiveAiKnowledge | null>;
  getAiKnowledgeSources(
    projectId: string,
  ): Promise<readonly AiKnowledgeSource[]>;
  setAiKnowledgeSources(
    projectId: string,
    sources: readonly AiKnowledgeSource[],
  ): Promise<void>;
  updateOperatingContext(projectId: string, context: string): Promise<void>;
  setAiAutoSyncSchedule(
    projectId: string,
    schedule: "never" | "daily" | "weekly",
  ): Promise<void>;
  setSynthesisMetadata(
    projectId: string,
    input: {
      readonly synthesizedAt: string | null;
      readonly inputHash: string | null;
    },
  ): Promise<void>;
  upsert(record: ProjectDimensionRecord): Promise<ProjectDimensionRecord>;
}

export interface ExpeditionDimensionRepository {
  listByIds(
    expeditionIds: readonly string[],
  ): Promise<readonly ExpeditionDimensionRecord[]>;
  upsert(record: ExpeditionDimensionRecord): Promise<ExpeditionDimensionRecord>;
}

export interface GmailMessageDetailRepository {
  findByRfc822MessageId(
    rfc822MessageId: string,
  ): Promise<GmailMessageDetailRecord | null>;
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
  readonly isInline: boolean;
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
  listByCampaignIds?(
    campaignIds: readonly string[],
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

export interface InternalNoteRecord {
  readonly id: string;
  readonly contactId: string;
  readonly body: string;
  readonly authorDisplayName: string | null;
  readonly authorId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InternalNoteRepository {
  create(input: {
    readonly id: string;
    readonly contactId: string;
    readonly body: string;
    readonly authorId: string;
    readonly createdAt?: Date;
    readonly updatedAt?: Date;
  }): Promise<InternalNoteRecord>;
  findById(id: string): Promise<InternalNoteRecord | undefined>;
  findByContactId(
    contactId: string,
    limit?: number,
  ): Promise<readonly InternalNoteRecord[]>;
  update(input: {
    readonly id: string;
    readonly body: string;
    readonly updatedAt?: Date;
  }): Promise<InternalNoteRecord>;
  delete(id: string): Promise<void>;
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
    readonly attemptedAt: string;
  }): Promise<string>;
  findByFingerprint(
    fingerprint: string,
  ): Promise<PendingComposerOutboundRecord | null>;
  markSentRfc822(id: string, sentRfc822MessageId: string): Promise<void>;
  findBySentRfc822MessageId(
    messageId: string,
  ): Promise<PendingComposerOutboundRecord | null>;
  listUnreconciledWithRfc822(): Promise<
    readonly PendingComposerOutboundRecord[]
  >;
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
    readonly filter:
      | "visible"
      | "inbox"
      | "unread"
      | "follow-up"
      | "sent"
      | "archived";
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
    readonly filter:
      | "visible"
      | "inbox"
      | "unread"
      | "follow-up"
      | "sent"
      | "archived";
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
    readonly archived: number;
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
  setArchived(input: {
    readonly contactId: string;
    readonly archived: boolean;
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
  listByEntities(input: {
    readonly entityType: string;
    readonly entityIds: readonly string[];
  }): Promise<readonly AuditEvidenceRecord[]>;
}

export interface Stage1RepositoryBundle {
  readonly sourceEvidence: SourceEvidenceRepository;
  readonly sourceEvidenceQuarantine: SourceEvidenceQuarantineRepository;
  readonly canonicalEvents: CanonicalEventRepository;
  readonly aiKnowledge: AiKnowledgeRepository;
  readonly projectKnowledge: ProjectKnowledgeRepository;
  readonly contacts: ContactRepository;
  readonly contactIdentities: ContactIdentityRepository;
  readonly contactMemberships: ContactMembershipRepository;
  readonly smsMessages: SmsMessageRepository;
  readonly consentRecords: ConsentRecordRepository;
  readonly smsSenders: SmsSenderRepository;
  readonly projectDimensions: ProjectDimensionRepository;
  readonly expeditionDimensions: ExpeditionDimensionRepository;
  readonly gmailMessageDetails: GmailMessageDetailRepository;
  readonly messageAttachments: MessageAttachmentRepository;
  readonly salesforceEventContext: SalesforceEventContextRepository;
  readonly salesforceCommunicationDetails: SalesforceCommunicationDetailRepository;
  readonly simpleTextingMessageDetails: SimpleTextingMessageDetailRepository;
  readonly mailchimpCampaignActivityDetails: MailchimpCampaignActivityDetailRepository;
  readonly manualNoteDetails: ManualNoteDetailRepository;
  readonly internalNotes: InternalNoteRepository;
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
