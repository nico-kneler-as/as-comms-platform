import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  EffectiveAiKnowledge,
  InboxUnifiedSearchMembership,
  InboxUnifiedSearchRow,
  InternalNoteRecord,
  PendingComposerOutboundRecord,
  ProjectAliasRecord,
  SourceEvidenceCollisionEntry,
  Stage1RepositoryBundle,
  Stage2RepositoryBundle,
  UserRecord,
  UserRole,
} from "@as-comms/domain";
import {
  defineStage1RepositoryBundle,
  defineStage2RepositoryBundle,
} from "@as-comms/domain";
import { aiKnowledgeSourcesSchema } from "@as-comms/contracts";
import {
  audienceCriteriaSchema,
  audienceSnapshotRecordSchema,
  campaignRunProjectionRowSchema,
  campaignRunRecordSchema,
  contactConsentRecordSchema,
  createDraftInputSchema,
  deliveryStatusSchema,
  newAudienceSnapshotSchema,
  orgSettingsRecordSchema,
  postmarkWebhookDeadLetterRecordSchema,
  runStateSchema,
  suppressionListRecordSchema,
  updateDraftInputSchema,
  type AudienceSnapshotRecord,
  type CampaignRunProjectionRow,
  type CampaignRunRecord,
  type ContactConsentRecord,
  type ConsentScopeType,
  type ConsentSource,
  type CreateDraftInput,
  type DeliveryStatus,
  type NewAudienceSnapshot,
  type OrgSettingsRecord,
  type PostmarkWebhookDeadLetterRecord,
  type RunState,
  type SuppressionListRecord,
  type SuppressionReason,
  type UpdateDraftInput,
  type WebhookDeadLetterFailureKind,
} from "@as-comms/contracts";

import type { DatabaseConnection } from "./client.js";
import {
  mapAiKnowledgeEntryRow,
  mapAiKnowledgeEntryToInsert,
  mapAuditEvidenceRow,
  mapAuditEvidenceToInsert,
  mapCanonicalEventAudienceRow,
  mapCanonicalEventAudienceToInsert,
  mapCanonicalEventRow,
  mapCanonicalEventToInsert,
  mapConsentRecordRow,
  mapConsentRecordToInsert,
  mapContactIdentityRow,
  mapContactIdentityToInsert,
  mapContactMembershipRow,
  mapContactMembershipToInsert,
  mapContactRow,
  mapContactToInsert,
  mapExpeditionDimensionRow,
  mapExpeditionDimensionToInsert,
  mapGmailMessageDetailRow,
  mapGmailMessageDetailToInsert,
  mapIntegrationBackfillJobRow,
  mapIntegrationBackfillJobToInsert,
  mapIntegrationHealthRow,
  mapIntegrationHealthToInsert,
  mapIdentityResolutionRow,
  mapIdentityResolutionToInsert,
  mapInboxProjectionRow,
  mapInboxProjectionToInsert,
  mapMessageAttachmentRow,
  mapMessageAttachmentToInsert,
  mapPendingComposerOutboundRow,
  mapPendingComposerOutboundToInsert,
  mapProjectAliasRow,
  mapProjectAliasToInsert,
  mapProjectKnowledgeEntryRow,
  mapProjectKnowledgeEntryToInsert,
  mapProjectDimensionRow,
  mapProjectDimensionToInsert,
  mapRoutingReviewRow,
  mapRoutingReviewToInsert,
  mapSalesforceReconciliationRunToInsert,
  mapSalesforceEventContextRow,
  mapSalesforceEventContextToInsert,
  mapSmsMessageRow,
  mapSmsMessageToInsert,
  mapSmsSenderRow,
  mapSourceEvidenceRow,
  mapSourceEvidenceToInsert,
  mapSourceEvidenceQuarantineRow,
  mapSourceEvidenceQuarantineToInsert,
  mapSyncStateRow,
  mapSyncStateToInsert,
  mapTimelineProjectionRow,
  mapTimelineProjectionToInsert,
  mapUserRow,
  mapUserToInsert,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import {
  audienceSnapshots,
  aiKnowledgeEntries,
  auditPolicyEvidence,
  canonicalEventAudience,
  canonicalEventLedger,
  campaignRuns,
  consentRecords,
  contactConsent,
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
  internalNotes,
  mailchimpCampaignActivityDetails,
  mailchimpCampaignTailState,
  messageAttachments,
  opsAlertState,
  manualNoteDetails,
  orgSettings,
  postmarkWebhookDeadLetter,
  pendingComposerOutbounds,
  projectAliases,
  projectKnowledgeEntries,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceReconciliationRuns,
  salesforceEventContext,
  simpleTextingMessageDetails,
  suppressionList,
  smsMessages,
  smsSenders,
  sourceEvidenceLog,
  sourceEvidenceQuarantine,
  syncState,
  users,
} from "./schema/index.js";

export type Stage1Database = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

export interface MailchimpCampaignTailStateRecord {
  readonly campaignId: string;
  readonly audienceId: string;
  readonly firstSeenSendTime: string;
  readonly lastActivitySeenAt: string | null;
  readonly lastPolledAt: string | null;
  readonly droppedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MailchimpCampaignTailStateRepository {
  findByCampaignId(
    campaignId: string,
  ): Promise<MailchimpCampaignTailStateRecord | null>;
  listActive(): Promise<readonly MailchimpCampaignTailStateRecord[]>;
  upsert(
    record: Pick<
      MailchimpCampaignTailStateRecord,
      "campaignId" | "audienceId" | "firstSeenSendTime"
    >,
  ): Promise<MailchimpCampaignTailStateRecord>;
  markPolled(input: {
    readonly campaignId: string;
    readonly polledAt: string;
  }): Promise<MailchimpCampaignTailStateRecord | null>;
  updateLastActivitySeenAt(input: {
    readonly campaignId: string;
    readonly lastActivitySeenAt: string;
  }): Promise<MailchimpCampaignTailStateRecord | null>;
  markDropped(input: {
    readonly campaignId: string;
    readonly droppedAt: string;
  }): Promise<MailchimpCampaignTailStateRecord | null>;
}

export interface MailchimpCampaignAggregates {
  readonly sent: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly unsubscribed: number;
  readonly distinctMembers: number;
}

export interface MailchimpRecipientRow {
  readonly memberId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly contactId: string | null;
  readonly latestState:
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "bounced"
    | "unsubscribed";
  readonly latestEventAt: string;
}

export class InvalidCampaignRunStateTransitionError extends Error {
  readonly runId: string;
  readonly from: RunState;
  readonly to: RunState;

  constructor(input: {
    readonly runId: string;
    readonly from: RunState;
    readonly to: RunState;
  }) {
    super(
      `Invalid campaign run transition for ${input.runId}: ${input.from} -> ${input.to}.`,
    );
    this.name = "InvalidCampaignRunStateTransitionError";
    this.runId = input.runId;
    this.from = input.from;
    this.to = input.to;
  }
}

export interface Stage5RepositoryBundle {
  readonly campaignRuns: {
    create(input: CreateDraftInput): Promise<CampaignRunRecord>;
    findById(id: string): Promise<CampaignRunRecord | null>;
    listByIds(ids: readonly string[]): Promise<readonly CampaignRunRecord[]>;
    listRecent(opts?: {
      readonly limit?: number;
      readonly filterByProjectIds?: readonly string[];
      readonly state?: readonly RunState[];
    }): Promise<readonly CampaignRunRecord[]>;
    updateDraft(
      id: string,
      input: UpdateDraftInput,
    ): Promise<CampaignRunRecord>;
    transitionState(
      id: string,
      from: RunState,
      to: RunState,
      fields?: Partial<CampaignRunRecord>,
    ): Promise<CampaignRunRecord>;
    update(
      id: string,
      fields: Partial<CampaignRunRecord>,
    ): Promise<CampaignRunRecord>;
  };
  readonly audienceSnapshots: {
    bulkInsert(
      runId: string,
      members: readonly NewAudienceSnapshot[],
    ): Promise<void>;
    listForRun(runId: string): Promise<readonly AudienceSnapshotRecord[]>;
    findByUnsubscribeToken(
      token: string,
    ): Promise<AudienceSnapshotRecord | null>;
    findByProviderMessageId(
      messageId: string,
    ): Promise<AudienceSnapshotRecord | null>;
    update(
      id: string,
      fields: Partial<AudienceSnapshotRecord>,
    ): Promise<AudienceSnapshotRecord>;
    updateDeliveryEvent(
      id: string,
      event: {
        readonly status: DeliveryStatus;
        readonly at: Date;
        readonly activity?: "open" | "click";
        readonly providerEventId?: string;
      },
    ): Promise<void>;
  };
  readonly contactConsent: {
    recordOptOut(
      contactId: string,
      scope: {
        readonly type: ConsentScopeType;
        readonly id?: string;
      },
      source: ConsentSource,
      sourceRunId?: string,
    ): Promise<void>;
    isOptedOut(
      contactId: string,
      scope: {
        readonly type: ConsentScopeType;
        readonly id?: string;
      },
      at: Date,
    ): Promise<boolean>;
    listForContact(contactId: string): Promise<readonly ContactConsentRecord[]>;
  };
  readonly suppressionList: {
    upsertFromBounce(
      email: string,
      reason: SuppressionReason,
      providerEventId: string,
      eventAt: Date,
    ): Promise<void>;
    isSuppressed(normalizedEmail: string, at: Date): Promise<boolean>;
    listAll(): Promise<readonly SuppressionListRecord[]>;
  };
  readonly orgSettings: {
    read(): Promise<OrgSettingsRecord>;
    update(input: Partial<OrgSettingsRecord>): Promise<OrgSettingsRecord>;
  };
  readonly webhookDeadLetter: {
    record(input: {
      readonly recordType: string | null;
      readonly messageId: string | null;
      readonly sourceEvidenceId: string | null;
      readonly payloadJson: unknown;
      readonly failureKind: WebhookDeadLetterFailureKind;
      readonly failureMessage: string;
      readonly terminalReason?: string;
    }): Promise<PostmarkWebhookDeadLetterRecord>;
    listPending(
      limit?: number,
    ): Promise<readonly PostmarkWebhookDeadLetterRecord[]>;
    markRetried(id: string, at: Date): Promise<void>;
    markTerminal(id: string, reason: string): Promise<void>;
  };
  readonly campaignRunProjection: {
    listRecent(opts?: {
      readonly limit?: number;
      readonly offset?: number;
      readonly states?: readonly RunState[];
      readonly projectIds?: readonly string[];
      readonly filterByProjectIds?: readonly string[];
      readonly searchQuery?: string;
    }): Promise<readonly CampaignRunProjectionRow[]>;
    getDetail(
      runId: string,
      provider: "postmark" | "mailchimp",
    ): Promise<CampaignRunProjectionRow | null>;
    count(opts?: {
      readonly states?: readonly RunState[];
      readonly projectIds?: readonly string[];
      readonly filterByProjectIds?: readonly string[];
      readonly searchQuery?: string;
    }): Promise<number>;
    countByState(opts?: {
      readonly projectIds?: readonly string[];
      readonly filterByProjectIds?: readonly string[];
    }): Promise<Partial<Record<RunState, number>>>;
  };
}

export function defineStage5RepositoryBundle<T extends Stage5RepositoryBundle>(
  bundle: T,
): T {
  return bundle;
}

/**
 * Thrown by the projects repository when an attempt is made to flip
 * `is_active` to `true` on a project_dimensions row whose `project_alias`
 * is null or empty/whitespace.
 *
 * The Settings action layer (apps/web/app/settings/actions.ts) already
 * validates this before calling setActive, so this error is defense-in-depth
 * against any future code path that bypasses the action layer. The DB also
 * enforces the same invariant via a CHECK constraint
 * (migration 0045_project_dimensions_active_alias_required.sql).
 */
export class ProjectAliasRequiredError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(
      `Cannot activate project ${projectId}: project_alias must be set and non-empty.`,
    );
    this.name = "ProjectAliasRequiredError";
    this.projectId = projectId;
  }
}

/**
 * Thrown by the projects repository when a connect-projects-to-host call
 * fails its preconditions: host must be active with a non-empty alias, each
 * candidate sub must currently be inactive with no existing connection, and
 * the host can't connect to itself. The action layer should validate the
 * same things up-front so this is defense-in-depth.
 */
export class InvalidProjectConnectionError extends Error {
  readonly code:
    | "host_not_found"
    | "host_inactive"
    | "host_missing_alias"
    | "host_already_connected"
    | "candidate_not_found"
    | "candidate_already_active"
    | "candidate_already_connected"
    | "candidate_is_host"
    | "candidate_is_self";
  readonly projectId: string;

  constructor(
    code: InvalidProjectConnectionError["code"],
    projectId: string,
    message?: string,
  ) {
    super(message ?? `Invalid connection request (${code}) for ${projectId}.`);
    this.name = "InvalidProjectConnectionError";
    this.code = code;
    this.projectId = projectId;
  }
}

/**
 * Thrown by the projects repository when a disconnect call targets a
 * project whose `connected_to_project_id` is already NULL.
 */
export class ProjectNotConnectedError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`Project ${projectId} is not connected to any host.`);
    this.name = "ProjectNotConnectedError";
    this.projectId = projectId;
  }
}

interface SalesforceCommunicationDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly channel: "email" | "sms";
  readonly messageKind: "one_to_one" | "auto" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
}

interface SimpleTextingMessageDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly direction: "inbound" | "outbound";
  readonly messageKind: "one_to_one" | "campaign";
  readonly messageTextPreview: string;
  readonly normalizedPhone: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly providerThreadId: string | null;
  readonly threadKey: string | null;
}

const PROJECT_KNOWLEDGE_KINDS = [
  "canonical_reply",
  "snippet",
  "pattern",
] as const;

function normalizeKnowledgeSearchText(value: string): string {
  return value.toLowerCase();
}

function scoreProjectKnowledgeEntry(input: {
  readonly row: ReturnType<typeof mapProjectKnowledgeEntryRow>;
  readonly issueTypeHint: string | null;
  readonly keywordsLower: readonly string[];
}): number {
  let score = 0;

  if (
    input.issueTypeHint !== null &&
    input.row.issueType?.toLowerCase() === input.issueTypeHint.toLowerCase()
  ) {
    score += 100;
  }

  const haystack = normalizeKnowledgeSearchText(
    [
      input.row.questionSummary,
      input.row.replyStrategy ?? "",
      input.row.maskedExample ?? "",
    ].join(" "),
  );

  for (const keyword of new Set(input.keywordsLower)) {
    if (keyword.length > 0 && haystack.includes(keyword)) {
      score += 1;
    }
  }

  return score;
}

interface MailchimpCampaignActivityDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly activityType:
    | "sent"
    | "delivered"
    | "bounced"
    | "complained"
    | "opened"
    | "clicked"
    | "unsubscribed";
  readonly campaignId: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly campaignName: string | null;
  readonly snippet: string;
}

type MailchimpCampaignTailStateRow =
  typeof mailchimpCampaignTailState.$inferSelect;
interface MailchimpAggregateRowDb {
  readonly activityType: string;
  readonly total: number | string;
}
interface MailchimpRecipientRowDb {
  readonly memberId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly contactId: string | null;
  readonly latestState:
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "bounced"
    | "unsubscribed";
  readonly latestEventAt: Date;
}

interface ManualNoteDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly body: string;
  readonly authorDisplayName: string | null;
  readonly authorId: string | null;
}

type SalesforceCommunicationDetailRow = SalesforceCommunicationDetailRecord;
type SimpleTextingMessageDetailRow = SimpleTextingMessageDetailRecord;
type MailchimpCampaignActivityDetailRow = MailchimpCampaignActivityDetailRecord;
type ManualNoteDetailRow = ManualNoteDetailRecord;
type InternalNoteRow = typeof internalNotes.$inferSelect;
interface InternalNoteWithAuthorRow {
  readonly internal_notes: InternalNoteRow;
  readonly users: {
    readonly name: string | null;
  } | null;
}
type PendingComposerOutboundRow = typeof pendingComposerOutbounds.$inferSelect;
interface SourceEvidenceCollisionGroupRow {
  readonly provider: SourceEvidenceCollisionEntry["provider"];
  readonly idempotencyKey: string;
  readonly latestReceivedAt: Date;
}
interface SourceEvidenceCollisionJoinedRow {
  readonly provider: SourceEvidenceCollisionEntry["provider"];
  readonly idempotencyKey: string;
  readonly latestReceivedAt: Date;
  readonly winningSourceEvidenceId: string;
  readonly winningChecksum: string;
  readonly winningReceivedAt: Date;
  readonly losingQuarantineId: string;
  readonly losingChecksum: string;
  readonly losingAttemptedAt: Date;
}

function mapSalesforceCommunicationDetailRowLocal(
  row: SalesforceCommunicationDetailRow,
): SalesforceCommunicationDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    channel: row.channel,
    messageKind: row.messageKind,
    subject: row.subject,
    snippet: row.snippet,
    sourceLabel: row.sourceLabel,
  };
}

function mapSalesforceCommunicationDetailToInsertLocal(
  record: SalesforceCommunicationDetailRecord,
) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    channel: record.channel,
    messageKind: record.messageKind,
    subject: record.subject,
    snippet: record.snippet,
    sourceLabel: record.sourceLabel,
  };
}

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

function clampSourceEvidenceCollisionLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 100));
}

function buildSourceEvidenceCollisionKey(
  provider: SourceEvidenceCollisionEntry["provider"],
  idempotencyKey: string,
): string {
  return `${provider}\u0000${idempotencyKey}`;
}

function mapSourceEvidenceCollisionEntries(input: {
  readonly groups: readonly SourceEvidenceCollisionGroupRow[];
  readonly rows: readonly SourceEvidenceCollisionJoinedRow[];
}): readonly SourceEvidenceCollisionEntry[] {
  const rowsByCollisionKey = new Map<
    string,
    SourceEvidenceCollisionJoinedRow[]
  >();

  for (const row of input.rows) {
    const collisionKey = buildSourceEvidenceCollisionKey(
      row.provider,
      row.idempotencyKey,
    );
    const existingRows = rowsByCollisionKey.get(collisionKey) ?? [];
    existingRows.push(row);
    rowsByCollisionKey.set(collisionKey, existingRows);
  }

  return input.groups.flatMap((group) => {
    const collisionKey = buildSourceEvidenceCollisionKey(
      group.provider,
      group.idempotencyKey,
    );
    const rows = rowsByCollisionKey.get(collisionKey) ?? [];
    const [winning] = rows;

    if (winning === undefined) {
      return [];
    }

    return [
      {
        provider: group.provider,
        idempotencyKey: group.idempotencyKey,
        latestReceivedAt: group.latestReceivedAt,
        winning: {
          sourceEvidenceId: winning.winningSourceEvidenceId,
          checksum: winning.winningChecksum,
          receivedAt: winning.winningReceivedAt,
        },
        losing: rows.map((row) => ({
          quarantineId: row.losingQuarantineId,
          checksum: row.losingChecksum,
          attemptedAt: row.losingAttemptedAt,
        })),
      },
    ];
  });
}

function coerceSourceEvidenceCollisionGroups(
  rows: readonly SourceEvidenceCollisionGroupRow[],
): readonly SourceEvidenceCollisionGroupRow[] {
  return rows.map((row) => ({
    provider: row.provider,
    idempotencyKey: row.idempotencyKey,
    latestReceivedAt: new Date(row.latestReceivedAt),
  }));
}

function coerceSourceEvidenceCollisionJoinedRows(
  rows: readonly SourceEvidenceCollisionJoinedRow[],
): readonly SourceEvidenceCollisionJoinedRow[] {
  return rows.map((row) => ({
    provider: row.provider,
    idempotencyKey: row.idempotencyKey,
    latestReceivedAt: new Date(row.latestReceivedAt),
    winningSourceEvidenceId: row.winningSourceEvidenceId,
    winningChecksum: row.winningChecksum,
    winningReceivedAt: new Date(row.winningReceivedAt),
    losingQuarantineId: row.losingQuarantineId,
    losingChecksum: row.losingChecksum,
    losingAttemptedAt: new Date(row.losingAttemptedAt),
  }));
}

function mapSimpleTextingMessageDetailRowLocal(
  row: SimpleTextingMessageDetailRow,
): SimpleTextingMessageDetailRecord {
  return {
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
  };
}

function mapSimpleTextingMessageDetailToInsertLocal(
  record: SimpleTextingMessageDetailRecord,
) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    direction: record.direction,
    messageKind: record.messageKind,
    messageTextPreview: record.messageTextPreview,
    normalizedPhone: record.normalizedPhone,
    campaignId: record.campaignId,
    campaignName: record.campaignName,
    providerThreadId: record.providerThreadId,
    threadKey: record.threadKey,
  };
}

function mapMailchimpCampaignActivityDetailRowLocal(
  row: MailchimpCampaignActivityDetailRow,
): MailchimpCampaignActivityDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType: normalizeMailchimpActivityType(
      row.activityType,
    ) as MailchimpCampaignActivityDetailRecord["activityType"],
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    memberId: row.memberId,
    campaignName: row.campaignName,
    snippet: row.snippet,
  };
}

function mapMailchimpCampaignActivityDetailToInsertLocal(
  record: MailchimpCampaignActivityDetailRecord,
) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    activityType: record.activityType,
    campaignId: record.campaignId,
    audienceId: record.audienceId,
    memberId: record.memberId,
    campaignName: record.campaignName,
    snippet: record.snippet,
  };
}

function toIsoTimestampLocal(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function normalizeMailchimpActivityType(value: string): string {
  switch (value) {
    case "open":
      return "opened";
    case "click":
      return "clicked";
    case "bounce":
      return "bounced";
    case "unsubscribe":
      return "unsubscribed";
    default:
      return value;
  }
}

function mapMailchimpRecipientRow(
  row: MailchimpRecipientRowDb,
): MailchimpRecipientRow {
  const eventAt = row.latestEventAt;
  const isoLatestEventAt =
    eventAt instanceof Date
      ? eventAt.toISOString()
      : new Date(String(eventAt)).toISOString();
  return {
    memberId: row.memberId,
    email: row.email,
    displayName: row.displayName,
    contactId: row.contactId,
    latestState: row.latestState,
    latestEventAt: isoLatestEventAt,
  };
}

function mapMailchimpCampaignTailStateRow(
  row: MailchimpCampaignTailStateRow,
): MailchimpCampaignTailStateRecord {
  return {
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    firstSeenSendTime: row.firstSeenSendTime.toISOString(),
    lastActivitySeenAt: toIsoTimestampLocal(row.lastActivitySeenAt),
    lastPolledAt: toIsoTimestampLocal(row.lastPolledAt),
    droppedAt: toIsoTimestampLocal(row.droppedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapManualNoteDetailRowLocal(
  row: ManualNoteDetailRow,
): ManualNoteDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    body: row.body,
    authorDisplayName: row.authorDisplayName,
    authorId: row.authorId,
  };
}

function mapManualNoteDetailToInsertLocal(record: ManualNoteDetailRecord) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    body: record.body,
    authorDisplayName: record.authorDisplayName,
    authorId: record.authorId,
  };
}

function mapInternalNoteRowLocal(row: InternalNoteRow): InternalNoteRecord {
  return {
    id: row.id,
    contactId: row.contactId,
    body: row.body,
    authorDisplayName: null,
    authorId: row.authorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInternalNoteWithAuthorRow(
  row: InternalNoteWithAuthorRow,
): InternalNoteRecord {
  return {
    ...mapInternalNoteRowLocal(row.internal_notes),
    authorDisplayName: row.users?.name ?? null,
  };
}

const salesforceCommunicationDetailsTable =
  salesforceCommunicationDetails as typeof salesforceCommunicationDetails & {
    readonly sourceEvidenceId: typeof salesforceCommunicationDetails.sourceEvidenceId;
  };
const simpleTextingMessageDetailsTable =
  simpleTextingMessageDetails as typeof simpleTextingMessageDetails & {
    readonly sourceEvidenceId: typeof simpleTextingMessageDetails.sourceEvidenceId;
  };
const mailchimpCampaignActivityDetailsTable =
  mailchimpCampaignActivityDetails as typeof mailchimpCampaignActivityDetails & {
    readonly sourceEvidenceId: typeof mailchimpCampaignActivityDetails.sourceEvidenceId;
  };
const mailchimpCampaignTailStateTable =
  mailchimpCampaignTailState as typeof mailchimpCampaignTailState & {
    readonly campaignId: typeof mailchimpCampaignTailState.campaignId;
  };
const manualNoteDetailsTable = manualNoteDetails as typeof manualNoteDetails & {
  readonly sourceEvidenceId: typeof manualNoteDetails.sourceEvidenceId;
};
const pendingComposerOutboundsTable =
  pendingComposerOutbounds as typeof pendingComposerOutbounds & {
    readonly id: typeof pendingComposerOutbounds.id;
  };
const integrationBackfillJobsTable =
  integrationBackfillJobs as typeof integrationBackfillJobs & {
    readonly id: typeof integrationBackfillJobs.id;
    readonly idempotencyKey: typeof integrationBackfillJobs.idempotencyKey;
  };

function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }

  return row;
}

export function createMailchimpCampaignTailStateRepository(
  db: Stage1Database,
): MailchimpCampaignTailStateRepository {
  return {
    async findByCampaignId(campaignId) {
      const [row] = await db
        .select()
        .from(mailchimpCampaignTailState)
        .where(eq(mailchimpCampaignTailState.campaignId, campaignId))
        .limit(1);

      return row === undefined ? null : mapMailchimpCampaignTailStateRow(row);
    },

    async listActive() {
      const rows = await db
        .select()
        .from(mailchimpCampaignTailState)
        .where(isNull(mailchimpCampaignTailState.droppedAt))
        .orderBy(
          asc(mailchimpCampaignTailState.firstSeenSendTime),
          asc(mailchimpCampaignTailState.campaignId),
        );

      return rows.map(mapMailchimpCampaignTailStateRow);
    },

    async upsert(record) {
      const values = {
        campaignId: record.campaignId,
        audienceId: record.audienceId,
        firstSeenSendTime: new Date(record.firstSeenSendTime),
      };
      // Inside a raw sql`` template, Drizzle does not apply the column's
      // type-mapping. A Date object falls through to Date.prototype.toString()
      // ("Sun Apr 05 2026 15:00:00 GMT+0000 ..."), which Postgres rejects
      // as a timestamptz. Pre-stringify to ISO and cast explicitly.
      const firstSeenIso = values.firstSeenSendTime.toISOString();
      const [row] = await db
        .insert(mailchimpCampaignTailState)
        .values(values)
        .onConflictDoUpdate({
          target: mailchimpCampaignTailStateTable.campaignId,
          set: {
            audienceId: values.audienceId,
            firstSeenSendTime: sql`least(${mailchimpCampaignTailState.firstSeenSendTime}, ${firstSeenIso}::timestamptz)`,
            updatedAt: new Date(),
          },
        })
        .returning();

      return mapMailchimpCampaignTailStateRow(
        requireRow(
          row,
          "Expected Mailchimp campaign tail-state row to be returned.",
        ),
      );
    },

    async markPolled(input) {
      const [row] = await db
        .update(mailchimpCampaignTailState)
        .set({
          lastPolledAt: new Date(input.polledAt),
          updatedAt: new Date(),
        })
        .where(eq(mailchimpCampaignTailState.campaignId, input.campaignId))
        .returning();

      return row === undefined ? null : mapMailchimpCampaignTailStateRow(row);
    },

    async updateLastActivitySeenAt(input) {
      // Same trap as the upsert path: Date interpolated in raw sql`` doesn't
      // get column type-mapped → Postgres rejects Date.toString() as
      // timestamptz. Pre-stringify + cast.
      const lastActivitySeenIso = new Date(
        input.lastActivitySeenAt,
      ).toISOString();
      const [row] = await db
        .update(mailchimpCampaignTailState)
        .set({
          lastActivitySeenAt: sql`greatest(coalesce(${mailchimpCampaignTailState.lastActivitySeenAt}, ${lastActivitySeenIso}::timestamptz), ${lastActivitySeenIso}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(mailchimpCampaignTailState.campaignId, input.campaignId))
        .returning();

      return row === undefined ? null : mapMailchimpCampaignTailStateRow(row);
    },

    async markDropped(input) {
      const [row] = await db
        .update(mailchimpCampaignTailState)
        .set({
          droppedAt: new Date(input.droppedAt),
          updatedAt: new Date(),
        })
        .where(eq(mailchimpCampaignTailState.campaignId, input.campaignId))
        .returning();

      return row === undefined ? null : mapMailchimpCampaignTailStateRow(row);
    },
  };
}

function clampSmsListLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 50, 200));
}

function createSmsRepositorySlices(db: Stage1Database) {
  return {
    smsMessages: {
      async insert(record) {
        const values = mapSmsMessageToInsert(record);
        const [row] = await db.insert(smsMessages).values(values).returning();

        return mapSmsMessageRow(
          requireRow(row, "Expected SMS message row to be returned."),
        );
      },

      async findByTwilioSid(sid) {
        const [row] = await db
          .select()
          .from(smsMessages)
          .where(eq(smsMessages.twilioMessageSid, sid))
          .limit(1);

        return row === undefined ? null : mapSmsMessageRow(row);
      },

      async findLatestByStatuses(statuses) {
        if (statuses.length === 0) {
          return null;
        }

        const [row] = await db
          .select()
          .from(smsMessages)
          .where(inArray(smsMessages.sendStatus, [...statuses]))
          .orderBy(desc(smsMessages.updatedAt), desc(smsMessages.id))
          .limit(1);

        return row === undefined ? null : mapSmsMessageRow(row);
      },

      async hasInboundForPhone(phoneE164) {
        const [row] = await db
          .select({ id: smsMessages.id })
          .from(smsMessages)
          .where(
            and(
              eq(smsMessages.phoneE164, phoneE164),
              eq(smsMessages.direction, "inbound"),
            ),
          )
          .limit(1);

        return row !== undefined;
      },

      async listByContact(contactId, limit) {
        const rows = await db
          .select()
          .from(smsMessages)
          .where(eq(smsMessages.contactId, contactId))
          .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
          .limit(clampSmsListLimit(limit));

        return rows.map(mapSmsMessageRow);
      },

      async updateDelivery(input) {
        const [row] = await db
          .update(smsMessages)
          .set({
            ...(input.twilioMessageSid === undefined
              ? {}
              : { twilioMessageSid: input.twilioMessageSid }),
            sendStatus: input.status,
            failedReason: input.failedReason ?? null,
            failedDetail: input.failedDetail ?? null,
            sentAt: input.sentAt ?? null,
            updatedAt: new Date(),
          })
          .where(eq(smsMessages.id, input.messageId))
          .returning();

        return row === undefined ? null : mapSmsMessageRow(row);
      },

      async updateSendStatus(
        messageId,
        status,
        failedReason = null,
        failedDetail = null,
        sentAt = null,
      ) {
        const [row] = await db
          .update(smsMessages)
          .set({
            sendStatus: status,
            failedReason,
            failedDetail,
            sentAt,
            updatedAt: new Date(),
          })
          .where(eq(smsMessages.id, messageId))
          .returning();

        return row === undefined ? null : mapSmsMessageRow(row);
      },
    },

    consentRecords: {
      async findLatestByPhone(phoneE164) {
        const [row] = await db
          .select()
          .from(consentRecords)
          .where(eq(consentRecords.phoneE164, phoneE164))
          .orderBy(desc(consentRecords.createdAt), desc(consentRecords.id))
          .limit(1);

        return row === undefined ? null : mapConsentRecordRow(row);
      },

      async findLatestByContact(contactId) {
        const [row] = await db
          .select()
          .from(consentRecords)
          .where(eq(consentRecords.contactId, contactId))
          .orderBy(desc(consentRecords.createdAt), desc(consentRecords.id))
          .limit(1);

        return row === undefined ? null : mapConsentRecordRow(row);
      },

      async insert(record) {
        const values = mapConsentRecordToInsert(record);
        const [row] = await db
          .insert(consentRecords)
          .values(values)
          .returning();

        return mapConsentRecordRow(
          requireRow(row, "Expected consent record row to be returned."),
        );
      },
    },

    smsSenders: {
      async listActive() {
        const rows = await db
          .select()
          .from(smsSenders)
          .where(eq(smsSenders.isActive, true))
          .orderBy(asc(smsSenders.displayName), asc(smsSenders.phoneE164));

        return rows.map(mapSmsSenderRow);
      },

      async findById(id) {
        const [row] = await db
          .select()
          .from(smsSenders)
          .where(eq(smsSenders.id, id))
          .limit(1);

        return row === undefined ? null : mapSmsSenderRow(row);
      },

      async findByPhone(phoneE164) {
        const [row] = await db
          .select()
          .from(smsSenders)
          .where(eq(smsSenders.phoneE164, phoneE164))
          .limit(1);

        return row === undefined ? null : mapSmsSenderRow(row);
      },

      async getActiveUsageSnapshot(input) {
        const monthStartIso = input.monthStart.toISOString();
        const [row] = await db
          .select({
            monthlyCap: smsSenders.monthlyCap,
            monthToDateSegments:
              sql<number>`coalesce(sum(${smsMessages.segments}), 0)`.mapWith(
                Number,
              ),
          })
          .from(smsSenders)
          .leftJoin(
            smsMessages,
            and(
              eq(smsMessages.senderId, smsSenders.id),
              eq(smsMessages.direction, "outbound"),
              sql`${smsMessages.createdAt} >= ${monthStartIso}::timestamptz`,
            ),
          )
          .where(eq(smsSenders.isActive, true))
          .groupBy(smsSenders.id)
          .orderBy(asc(smsSenders.createdAt), asc(smsSenders.id))
          .limit(1);

        if (row === undefined) {
          return null;
        }

        return {
          monthlyCap: row.monthlyCap,
          monthToDateSegments: row.monthToDateSegments,
        };
      },
    },
  } satisfies Pick<
    Stage1RepositoryBundle,
    "smsMessages" | "consentRecords" | "smsSenders"
  >;
}

const DEFAULT_INTEGRATION_HEALTH_SEED = [
  {
    id: "salesforce",
    serviceName: "salesforce",
    category: "crm",
    status: "not_checked",
  },
  {
    id: "gmail",
    serviceName: "gmail",
    category: "messaging",
    status: "not_checked",
  },
  {
    id: "simpletexting",
    serviceName: "simpletexting",
    category: "messaging",
    status: "not_configured",
  },
  {
    id: "mailchimp",
    serviceName: "mailchimp",
    category: "messaging",
    status: "not_configured",
  },
  {
    id: "postmark",
    serviceName: "postmark",
    category: "messaging",
    status: "not_configured",
  },
  {
    id: "notion",
    serviceName: "notion",
    category: "knowledge",
    status: "not_configured",
  },
  {
    id: "openai",
    serviceName: "openai",
    category: "ai",
    status: "not_configured",
  },
] as const;

type InboxProjectionFilter =
  | "visible"
  | "inbox"
  | "unread"
  | "follow-up"
  | "sent"
  | "archived";
type InboxProjectionOrder = "last-inbound" | "last-outbound";

interface InboxRecencyCursor {
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
}

function buildInboxRecencyOrderBy(
  order: InboxProjectionOrder,
): [SQL, SQL, SQL] {
  return order === "last-outbound"
    ? [
        sql`${contactInboxProjection.lastOutboundAt} desc nulls last`,
        desc(contactInboxProjection.lastActivityAt),
        asc(contactInboxProjection.contactId),
      ]
    : [
        sql`${contactInboxProjection.lastInboundAt} desc nulls last`,
        desc(contactInboxProjection.lastActivityAt),
        asc(contactInboxProjection.contactId),
      ];
}

function buildInboxFilterPredicate(
  filter: InboxProjectionFilter,
): SQL | undefined {
  const excludeArchived = isNull(contactInboxProjection.archivedAt);
  const inboxOnly = isNotNull(contactInboxProjection.lastInboundAt);

  if (filter === "archived") {
    return isNotNull(contactInboxProjection.archivedAt);
  }

  const filterPredicate =
    filter === "visible"
      ? undefined
      : filter === "inbox"
        ? inboxOnly
        : filter === "unread"
          ? eq(contactInboxProjection.bucket, "New")
          : filter === "follow-up"
            ? eq(contactInboxProjection.isStarred, true)
            : isNotNull(contactInboxProjection.lastOutboundAt);

  return filterPredicate === undefined
    ? excludeArchived
    : and(excludeArchived, filterPredicate);
}

function buildInboxProjectPredicate(
  projectId: string | null | undefined,
): SQL | undefined {
  if (projectId === null || projectId === undefined || projectId.length === 0) {
    return undefined;
  }

  // Three-way OR predicate (membership + alias + connected sub-project),
  // expressed as a single EXISTS over a UNION ALL so the planner can stop at
  // the first match. Branches:
  //   1. The contact has an active membership in the requested project.
  //   2. The contact has an inbound Gmail event captured at the requested
  //      project's alias (covers volunteers who haven't been backfilled to a
  //      membership yet — see PR #333).
  //   3. The contact has an active membership in a project that is connected
  //      to the requested project (host rollup — see migration 0056). The
  //      target project must itself be active; connected sub-projects are
  //      defined as is_active=true with connected_to_project_id set.
  return sql`exists (
    select 1
    from (
      select 1
      from ${contactMemberships}
      inner join ${projectDimensions}
        on ${contactMemberships.projectId} = ${projectDimensions.projectId}
      where ${contactMemberships.contactId} = ${contactInboxProjection.contactId}
        and ${contactMemberships.projectId} = ${projectId}
        and ${projectDimensions.isActive} = true

      union all

      select 1
      from ${canonicalEventLedger}
      inner join ${gmailMessageDetails}
        on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
      inner join ${projectAliases}
        on ${gmailMessageDetails.projectInboxAlias} = ${projectAliases.alias}
      inner join ${projectDimensions}
        on ${projectAliases.projectId} = ${projectDimensions.projectId}
      where ${canonicalEventLedger.contactId} = ${contactInboxProjection.contactId}
        and ${gmailMessageDetails.direction} = 'inbound'
        and ${projectAliases.projectId} = ${projectId}
        and ${projectDimensions.isActive} = true

      union all

      select 1
      from ${contactMemberships}
      inner join ${projectDimensions}
        on ${contactMemberships.projectId} = ${projectDimensions.projectId}
      where ${contactMemberships.contactId} = ${contactInboxProjection.contactId}
        and ${projectDimensions.connectedToProjectId} = ${projectId}
        and ${projectDimensions.isActive} = true
    ) inbox_project_match
  )`;
}

function buildInboxCursorPredicate(input: {
  readonly cursor: InboxRecencyCursor | null;
  readonly order: InboxProjectionOrder;
}): SQL | undefined {
  if (input.cursor === null) {
    return undefined;
  }

  const lastActivityAtIso = new Date(input.cursor.lastActivityAt).toISOString();

  if (input.order === "last-outbound") {
    if (input.cursor.lastOutboundAt === null) {
      return undefined;
    }

    const lastOutboundAtIso = new Date(
      input.cursor.lastOutboundAt,
    ).toISOString();

    return sql`(
      ${contactInboxProjection.lastOutboundAt} < ${lastOutboundAtIso}::timestamptz
      or (
        ${contactInboxProjection.lastOutboundAt} = ${lastOutboundAtIso}::timestamptz
        and ${contactInboxProjection.lastActivityAt} < ${lastActivityAtIso}::timestamptz
      )
      or (
        ${contactInboxProjection.lastOutboundAt} = ${lastOutboundAtIso}::timestamptz
        and ${contactInboxProjection.lastActivityAt} = ${lastActivityAtIso}::timestamptz
        and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
      )
    )`;
  }

  if (input.cursor.lastInboundAt === null) {
    return sql`(
      ${contactInboxProjection.lastInboundAt} is null
      and (
        ${contactInboxProjection.lastActivityAt} < ${lastActivityAtIso}::timestamptz
        or (
          ${contactInboxProjection.lastActivityAt} = ${lastActivityAtIso}::timestamptz
          and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
        )
      )
    )`;
  }

  const lastInboundAtIso = new Date(input.cursor.lastInboundAt).toISOString();

  return sql`(
    ${contactInboxProjection.lastInboundAt} is null
    or ${contactInboxProjection.lastInboundAt} < ${lastInboundAtIso}::timestamptz
    or (
      ${contactInboxProjection.lastInboundAt} = ${lastInboundAtIso}::timestamptz
      and ${contactInboxProjection.lastActivityAt} < ${lastActivityAtIso}::timestamptz
    )
    or (
      ${contactInboxProjection.lastInboundAt} = ${lastInboundAtIso}::timestamptz
      and ${contactInboxProjection.lastActivityAt} = ${lastActivityAtIso}::timestamptz
      and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
    )
  )`;
}

function combinePredicates(
  ...predicates: readonly (SQL | undefined)[]
): SQL | undefined {
  const definedPredicates = predicates.filter(
    (predicate): predicate is SQL => predicate !== undefined,
  );

  if (definedPredicates.length === 0) {
    return undefined;
  }

  if (definedPredicates.length === 1) {
    return definedPredicates[0];
  }

  return and(...definedPredicates);
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildInboxPrimaryProjectLabelExpression() {
  return sql<string>`coalesce((
    select coalesce(${projectDimensions.projectName}, ${expeditionDimensions.expeditionName})
    from ${contactMemberships}
    left join ${projectDimensions}
      on ${contactMemberships.projectId} = ${projectDimensions.projectId}
    left join ${expeditionDimensions}
      on ${contactMemberships.expeditionId} = ${expeditionDimensions.expeditionId}
    where ${contactMemberships.contactId} = ${contactInboxProjection.contactId}
    order by
      case
        when lower(coalesce(${contactMemberships.status}, '')) = 'lead' then 0
        when lower(coalesce(${contactMemberships.status}, '')) in ('applied', 'applicant') then 1
        when lower(coalesce(${contactMemberships.status}, '')) in ('in-training', 'training') then 2
        when lower(coalesce(${contactMemberships.status}, '')) = 'trip-planning' then 3
        when lower(coalesce(${contactMemberships.status}, '')) in ('in-field', 'active') then 4
        when lower(coalesce(${contactMemberships.status}, '')) in ('successful', 'completed') then 5
        else 6
      end asc,
      coalesce(${contactMemberships.projectId}, '') asc,
      ${contactMemberships.id} asc
    limit 1
  ), '')`;
}

function buildInboxLatestSubjectExpression() {
  return sql<string>`coalesce((
    select coalesce(${gmailMessageDetails.subject}, ${salesforceCommunicationDetails.subject})
    from ${canonicalEventLedger}
    left join ${gmailMessageDetails}
      on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
    left join ${salesforceCommunicationDetails}
      on ${salesforceCommunicationDetailsTable.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
    where ${canonicalEventLedger.id} = ${contactInboxProjection.lastCanonicalEventId}
    limit 1
  ), '')`;
}

function buildInboxSearchPredicate(query: string): SQL {
  const pattern = `%${escapeIlikePattern(query)}%`;
  const contactDisplayNameExpression = sql<string>`coalesce((
    select ${contacts.displayName}
    from ${contacts}
    where ${contacts.id} = ${contactInboxProjection.contactId}
    limit 1
  ), '')`;
  const contactPrimaryEmailExpression = sql<string>`coalesce((
    select ${contacts.primaryEmail}
    from ${contacts}
    where ${contacts.id} = ${contactInboxProjection.contactId}
    limit 1
  ), '')`;
  const primaryProjectLabelExpression =
    buildInboxPrimaryProjectLabelExpression();
  const latestSubjectExpression = buildInboxLatestSubjectExpression();

  return sql`(
    ${contactDisplayNameExpression} ilike ${pattern} escape '\\'
    or ${contactPrimaryEmailExpression} ilike ${pattern} escape '\\'
    or ${primaryProjectLabelExpression} ilike ${pattern} escape '\\'
    or ${latestSubjectExpression} ilike ${pattern} escape '\\'
    or ${contactInboxProjection.snippet} ilike ${pattern} escape '\\'
  )`;
}

function createStage1RepositoriesInternal(
  db: Stage1Database,
): Stage1RepositoryBundle {
  const smsRepositories = createSmsRepositorySlices(db);

  return defineStage1RepositoryBundle({
    sourceEvidence: {
      async append(record) {
        const values = mapSourceEvidenceToInsert(record);
        const [inserted] = await db
          .insert(sourceEvidenceLog)
          .values(values)
          .onConflictDoNothing({
            target: [
              sourceEvidenceLog.provider,
              sourceEvidenceLog.idempotencyKey,
            ],
          })
          .returning();

        if (inserted !== undefined) {
          return mapSourceEvidenceRow(inserted);
        }

        const [existing] = await db
          .select()
          .from(sourceEvidenceLog)
          .where(
            and(
              eq(sourceEvidenceLog.provider, values.provider),
              eq(sourceEvidenceLog.idempotencyKey, values.idempotencyKey),
            ),
          )
          .limit(1);

        return mapSourceEvidenceRow(
          requireRow(
            existing,
            "Expected an existing source evidence row after duplicate append.",
          ),
        );
      },

      async replaceByIdempotencyKey(record) {
        const values = mapSourceEvidenceToInsert(record);
        const [updated] = await db
          .update(sourceEvidenceLog)
          .set({
            providerRecordType: values.providerRecordType,
            providerRecordId: values.providerRecordId,
            receivedAt: values.receivedAt,
            occurredAt: values.occurredAt,
            payloadRef: values.payloadRef,
            checksum: values.checksum,
          })
          .where(
            and(
              eq(sourceEvidenceLog.provider, values.provider),
              eq(sourceEvidenceLog.idempotencyKey, values.idempotencyKey),
            ),
          )
          .returning();

        return mapSourceEvidenceRow(
          requireRow(
            updated,
            "Expected an existing source evidence row to replace by idempotency key.",
          ),
        );
      },

      async findById(id) {
        const [row] = await db
          .select()
          .from(sourceEvidenceLog)
          .where(eq(sourceEvidenceLog.id, id))
          .limit(1);

        return row === undefined ? null : mapSourceEvidenceRow(row);
      },

      async listByIds(ids) {
        if (ids.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(sourceEvidenceLog)
          .where(inArray(sourceEvidenceLog.id, [...ids]))
          .orderBy(asc(sourceEvidenceLog.id));

        return rows.map(mapSourceEvidenceRow);
      },

      async findByIdempotencyKey(idempotencyKey) {
        const [row] = await db
          .select()
          .from(sourceEvidenceLog)
          .where(eq(sourceEvidenceLog.idempotencyKey, idempotencyKey))
          .orderBy(desc(sourceEvidenceLog.createdAt))
          .limit(1);

        return row === undefined ? null : mapSourceEvidenceRow(row);
      },

      async listIdempotencyChecksumCollisions(input) {
        const limit = clampSourceEvidenceCollisionLimit(input.limit);
        const groupResult = await db.execute(
          sql`
            select
              ${sourceEvidenceQuarantine.provider} as "provider",
              ${sourceEvidenceQuarantine.idempotencyKey} as "idempotencyKey",
              max(
                greatest(
                  ${sourceEvidenceLog.receivedAt},
                  ${sourceEvidenceQuarantine.attemptedAt}
                )
              ) as "latestReceivedAt"
            from ${sourceEvidenceQuarantine}
            inner join ${sourceEvidenceLog}
              on ${sourceEvidenceLog.provider} = ${sourceEvidenceQuarantine.provider}
              and ${sourceEvidenceLog.idempotencyKey} = ${sourceEvidenceQuarantine.idempotencyKey}
            group by ${sourceEvidenceQuarantine.provider}, ${sourceEvidenceQuarantine.idempotencyKey}
            ${
              input.beforeTimestamp === undefined
                ? sql``
                : sql`
                    having max(
                      greatest(
                        ${sourceEvidenceLog.receivedAt},
                        ${sourceEvidenceQuarantine.attemptedAt}
                      )
                    ) < ${input.beforeTimestamp}
                  `
            }
            order by
              max(
                greatest(
                  ${sourceEvidenceLog.receivedAt},
                  ${sourceEvidenceQuarantine.attemptedAt}
                )
              ) desc,
              ${sourceEvidenceQuarantine.provider} asc,
              ${sourceEvidenceQuarantine.idempotencyKey} asc
            limit ${limit + 1}
          `,
        );
        const groups = coerceSourceEvidenceCollisionGroups(
          normalizeSqlResultRows<SourceEvidenceCollisionGroupRow>(
            groupResult as
              | readonly SourceEvidenceCollisionGroupRow[]
              | {
                  readonly rows?: readonly SourceEvidenceCollisionGroupRow[];
                },
          ),
        );
        const visibleGroups = groups.slice(0, limit);

        if (visibleGroups.length === 0) {
          return {
            entries: [],
            hasMore: false,
          };
        }

        const groupPredicates = visibleGroups.map((group) =>
          and(
            eq(sourceEvidenceQuarantine.provider, group.provider),
            eq(sourceEvidenceQuarantine.idempotencyKey, group.idempotencyKey),
          ),
        );
        const rows = coerceSourceEvidenceCollisionJoinedRows(
          await db
            .select({
              provider: sourceEvidenceQuarantine.provider,
              idempotencyKey: sourceEvidenceQuarantine.idempotencyKey,
              latestReceivedAt: sql<Date>`
                greatest(
                  ${sourceEvidenceLog.receivedAt},
                  ${sourceEvidenceQuarantine.attemptedAt}
                )
              `,
              winningSourceEvidenceId: sourceEvidenceLog.id,
              winningChecksum: sourceEvidenceLog.checksum,
              winningReceivedAt: sourceEvidenceLog.receivedAt,
              losingQuarantineId: sourceEvidenceQuarantine.id,
              losingChecksum: sourceEvidenceQuarantine.checksum,
              losingAttemptedAt: sourceEvidenceQuarantine.attemptedAt,
            })
            .from(sourceEvidenceQuarantine)
            .innerJoin(
              sourceEvidenceLog,
              and(
                eq(
                  sourceEvidenceLog.provider,
                  sourceEvidenceQuarantine.provider,
                ),
                eq(
                  sourceEvidenceLog.idempotencyKey,
                  sourceEvidenceQuarantine.idempotencyKey,
                ),
              ),
            )
            .where(
              groupPredicates.length === 1
                ? groupPredicates[0]
                : or(...groupPredicates),
            )
            .orderBy(
              asc(sourceEvidenceQuarantine.provider),
              asc(sourceEvidenceQuarantine.idempotencyKey),
              asc(sourceEvidenceQuarantine.attemptedAt),
              asc(sourceEvidenceQuarantine.createdAt),
              asc(sourceEvidenceQuarantine.id),
            ),
        );

        return {
          entries: mapSourceEvidenceCollisionEntries({
            groups: visibleGroups,
            rows,
          }),
          hasMore: groups.length > limit,
        };
      },

      async countByProvider(provider) {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(sourceEvidenceLog)
          .where(eq(sourceEvidenceLog.provider, provider));

        return row?.value ?? 0;
      },

      async listByProviderRecord(input) {
        const rows = await db
          .select()
          .from(sourceEvidenceLog)
          .where(
            and(
              eq(sourceEvidenceLog.provider, input.provider),
              eq(
                sourceEvidenceLog.providerRecordType,
                input.providerRecordType,
              ),
              eq(sourceEvidenceLog.providerRecordId, input.providerRecordId),
            ),
          )
          .orderBy(
            asc(sourceEvidenceLog.occurredAt),
            asc(sourceEvidenceLog.createdAt),
          );

        return rows.map(mapSourceEvidenceRow);
      },
    },

    sourceEvidenceQuarantine: {
      async record(input) {
        const [row] = await db
          .insert(sourceEvidenceQuarantine)
          .values(
            mapSourceEvidenceQuarantineToInsert({
              id: `source_evidence_quarantine:${crypto.randomUUID()}`,
              record: input,
            }),
          )
          .returning();

        return mapSourceEvidenceQuarantineRow(
          requireRow(
            row,
            "Expected source evidence quarantine row after insert.",
          ),
        );
      },

      async listRecent(input) {
        const limit = clampSourceEvidenceCollisionLimit(input.limit);
        const rows = await db
          .select()
          .from(sourceEvidenceQuarantine)
          .where(
            input.beforeTimestamp === undefined
              ? undefined
              : lt(sourceEvidenceQuarantine.attemptedAt, input.beforeTimestamp),
          )
          .orderBy(
            desc(sourceEvidenceQuarantine.attemptedAt),
            desc(sourceEvidenceQuarantine.createdAt),
            desc(sourceEvidenceQuarantine.id),
          )
          .limit(limit + 1);

        const visibleRows = rows
          .slice(0, limit)
          .map(mapSourceEvidenceQuarantineRow);

        return {
          entries: visibleRows,
          hasMore: rows.length > limit,
        };
      },
    },

    canonicalEvents: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(canonicalEventLedger)
          .where(eq(canonicalEventLedger.id, id))
          .limit(1);

        return row === undefined ? null : mapCanonicalEventRow(row);
      },

      async findByIdempotencyKey(idempotencyKey) {
        const [row] = await db
          .select()
          .from(canonicalEventLedger)
          .where(eq(canonicalEventLedger.idempotencyKey, idempotencyKey))
          .limit(1);

        return row === undefined ? null : mapCanonicalEventRow(row);
      },

      async findBySourceEvidenceId(sourceEvidenceId, eventType) {
        const [row] = await db
          .select()
          .from(canonicalEventLedger)
          .where(
            and(
              eq(canonicalEventLedger.sourceEvidenceId, sourceEvidenceId),
              eq(canonicalEventLedger.eventType, eventType),
            ),
          )
          .limit(1);

        return row === undefined ? null : mapCanonicalEventRow(row);
      },

      async listByContentFingerprintWindow(input) {
        const occurredAt = new Date(input.occurredAt);

        if (Number.isNaN(occurredAt.getTime())) {
          return [];
        }

        const occurredAtIso = occurredAt.toISOString();

        const rows = await db
          .select()
          .from(canonicalEventLedger)
          .where(
            and(
              eq(canonicalEventLedger.contactId, input.contactId),
              eq(canonicalEventLedger.channel, input.channel),
              eq(
                canonicalEventLedger.contentFingerprint,
                input.contentFingerprint,
              ),
              sql`abs(extract(epoch from (${canonicalEventLedger.occurredAt} - cast(${occurredAtIso} as timestamptz)))) <= ${input.windowMinutes * 60}`,
            ),
          )
          .orderBy(
            asc(canonicalEventLedger.occurredAt),
            asc(canonicalEventLedger.createdAt),
          );

        return rows.map(mapCanonicalEventRow);
      },

      async countAll() {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(canonicalEventLedger);

        return row?.value ?? 0;
      },

      async countByPrimaryProvider(provider) {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(canonicalEventLedger)
          .innerJoin(
            sourceEvidenceLog,
            eq(canonicalEventLedger.sourceEvidenceId, sourceEvidenceLog.id),
          )
          .where(eq(sourceEvidenceLog.provider, provider));

        return row?.value ?? 0;
      },

      async countDistinctInboxContacts() {
        const [row] = await db
          .select({
            value: countDistinct(canonicalEventLedger.contactId),
          })
          .from(canonicalEventLedger)
          .where(
            inArray(canonicalEventLedger.eventType, [
              "communication.email.inbound",
              "communication.email.outbound",
              "communication.sms.inbound",
              "communication.sms.outbound",
            ]),
          );

        return row?.value ?? 0;
      },

      async listByIds(ids) {
        if (ids.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(canonicalEventLedger)
          .where(inArray(canonicalEventLedger.id, [...ids]))
          .orderBy(asc(canonicalEventLedger.id));

        return rows.map(mapCanonicalEventRow);
      },

      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(canonicalEventLedger)
          .leftJoin(
            canonicalEventAudience,
            and(
              eq(
                canonicalEventAudience.canonicalEventId,
                canonicalEventLedger.id,
              ),
              eq(canonicalEventAudience.contactId, contactId),
            ),
          )
          .where(
            or(
              eq(canonicalEventLedger.contactId, contactId),
              eq(canonicalEventAudience.contactId, contactId),
            ),
          )
          .orderBy(
            asc(canonicalEventLedger.occurredAt),
            asc(canonicalEventLedger.id),
          );

        return rows.map((row) =>
          mapCanonicalEventRow(row.canonical_event_ledger),
        );
      },

      async listByContactIds(contactIds) {
        if (contactIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(canonicalEventLedger)
          .where(inArray(canonicalEventLedger.contactId, [...contactIds]))
          .orderBy(
            asc(canonicalEventLedger.contactId),
            asc(canonicalEventLedger.occurredAt),
            asc(canonicalEventLedger.createdAt),
          );

        return rows.map(mapCanonicalEventRow);
      },

      async upsert(record) {
        const values = mapCanonicalEventToInsert(record);
        const [row] = await db
          .insert(canonicalEventLedger)
          .values(values)
          .onConflictDoUpdate({
            target: canonicalEventLedger.id,
            set: {
              contactId: values.contactId,
              eventType: values.eventType,
              channel: values.channel,
              occurredAt: values.occurredAt,
              contentFingerprint: values.contentFingerprint,
              sourceEvidenceId: values.sourceEvidenceId,
              idempotencyKey: values.idempotencyKey,
              provenance: values.provenance,
              reviewState: values.reviewState,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapCanonicalEventRow(
          requireRow(row, "Expected canonical event row to be returned."),
        );
      },
    },

    aiKnowledge: {
      async findByScope(input) {
        const scopeKeyPredicate =
          input.scopeKey === null
            ? isNull(aiKnowledgeEntries.scopeKey)
            : eq(aiKnowledgeEntries.scopeKey, input.scopeKey);

        const [row] = await db
          .select()
          .from(aiKnowledgeEntries)
          .where(
            and(eq(aiKnowledgeEntries.scope, input.scope), scopeKeyPredicate),
          )
          .orderBy(
            desc(aiKnowledgeEntries.syncedAt),
            asc(aiKnowledgeEntries.id),
          )
          .limit(1);

        return row === undefined ? null : mapAiKnowledgeEntryRow(row);
      },

      async findProjectNotionContent(projectId) {
        const [row] = await db
          .select()
          .from(aiKnowledgeEntries)
          .where(
            and(
              eq(aiKnowledgeEntries.scope, "project"),
              eq(aiKnowledgeEntries.scopeKey, projectId),
              eq(aiKnowledgeEntries.sourceProvider, "notion"),
            ),
          )
          .orderBy(
            desc(aiKnowledgeEntries.syncedAt),
            asc(aiKnowledgeEntries.id),
          )
          .limit(1);

        return row === undefined ? null : mapAiKnowledgeEntryRow(row);
      },

      async findEffectiveProjectNotionContent(projectId) {
        // Hop sub→host transparently so the AI Draft retriever picks up the
        // host's curated grounding when a thread is tagged with a connected
        // sub-project's id (sub.ai_knowledge_url is null by Settings invariant
        // — see PR #388).
        const [projectRow] = await db
          .select({
            connectedToProjectId: projectDimensions.connectedToProjectId,
          })
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);
        const hostProjectId = projectRow?.connectedToProjectId ?? null;
        const effectiveScopeKey = hostProjectId ?? projectId;

        if (hostProjectId !== null) {
          // Logging at debug-level only — avoid noise on hot paths but make
          // the fallback observable when troubleshooting an AI Draft. The
          // synthesis worker emits stringified JSON for log scraping; mirror
          // that style here.
          console.debug(
            JSON.stringify({
              event: "ai_knowledge.fallback",
              subProjectId: projectId,
              hostProjectId,
            }),
          );
        }

        const [row] = await db
          .select()
          .from(aiKnowledgeEntries)
          .where(
            and(
              eq(aiKnowledgeEntries.scope, "project"),
              eq(aiKnowledgeEntries.scopeKey, effectiveScopeKey),
              eq(aiKnowledgeEntries.sourceProvider, "notion"),
            ),
          )
          .orderBy(
            desc(aiKnowledgeEntries.syncedAt),
            asc(aiKnowledgeEntries.id),
          )
          .limit(1);

        return row === undefined ? null : mapAiKnowledgeEntryRow(row);
      },

      async hasProjectNotionContent(projectId) {
        const [row] = await db
          .select({
            id: aiKnowledgeEntries.id,
          })
          .from(aiKnowledgeEntries)
          .where(
            and(
              eq(aiKnowledgeEntries.scope, "project"),
              eq(aiKnowledgeEntries.scopeKey, projectId),
              eq(aiKnowledgeEntries.sourceProvider, "notion"),
              sql`length(btrim(${aiKnowledgeEntries.content})) > 0`,
            ),
          )
          .limit(1);

        return row !== undefined;
      },

      async findProjectIdsWithAiKnowledgeConfigured(projectIds) {
        if (projectIds.length === 0) {
          return [];
        }

        const projectRows = await db
          .select({
            projectId: projectDimensions.projectId,
            connectedToProjectId: projectDimensions.connectedToProjectId,
            aiOptimizedSynthesizedAt:
              projectDimensions.aiOptimizedSynthesizedAt,
          })
          .from(projectDimensions)
          .where(inArray(projectDimensions.projectId, projectIds as string[]));

        const knownProjectsById = new Map(
          projectRows.map((row) => [row.projectId, row]),
        );
        const effectiveProjectIdByInput = new Map(
          projectIds.map((projectId) => [projectId, projectId]),
        );
        for (const row of projectRows) {
          effectiveProjectIdByInput.set(
            row.projectId,
            row.connectedToProjectId ?? row.projectId,
          );
        }

        const hostIdsToFetch = Array.from(
          new Set(
            Array.from(effectiveProjectIdByInput.values()).filter(
              (projectId) => !knownProjectsById.has(projectId),
            ),
          ),
        );

        if (hostIdsToFetch.length > 0) {
          const hostRows = await db
            .select({
              projectId: projectDimensions.projectId,
              aiOptimizedSynthesizedAt:
                projectDimensions.aiOptimizedSynthesizedAt,
            })
            .from(projectDimensions)
            .where(inArray(projectDimensions.projectId, hostIdsToFetch));

          for (const row of hostRows) {
            knownProjectsById.set(row.projectId, {
              projectId: row.projectId,
              connectedToProjectId: null,
              aiOptimizedSynthesizedAt: row.aiOptimizedSynthesizedAt,
            });
          }
        }

        const configuredEffectiveIds = new Set(
          Array.from(knownProjectsById.values())
            .filter((row) => row.aiOptimizedSynthesizedAt !== null)
            .map((row) => row.projectId),
        );

        return projectIds.filter((projectId) =>
          configuredEffectiveIds.has(
            effectiveProjectIdByInput.get(projectId) ?? projectId,
          ),
        );
      },

      async upsert(record) {
        const values = mapAiKnowledgeEntryToInsert(record);
        const [row] = await db
          .insert(aiKnowledgeEntries)
          .values(values)
          .onConflictDoUpdate({
            target: aiKnowledgeEntries.id,
            set: {
              scope: values.scope,
              scopeKey: values.scopeKey,
              sourceProvider: values.sourceProvider,
              sourceId: values.sourceId,
              sourceUrl: values.sourceUrl,
              title: values.title,
              content: values.content,
              contentHash: values.contentHash,
              metadataJson: values.metadataJson,
              sourceLastEditedAt: values.sourceLastEditedAt,
              syncedAt: values.syncedAt,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapAiKnowledgeEntryRow(
          requireRow(row, "Expected AI knowledge row to be returned."),
        );
      },
    },

    projectKnowledge: {
      async list(input) {
        const predicates = [
          eq(projectKnowledgeEntries.projectId, input.projectId),
        ];

        if (input.approvedOnly === true) {
          predicates.push(eq(projectKnowledgeEntries.approvedForAi, true));
        }

        const rows = await db
          .select()
          .from(projectKnowledgeEntries)
          .where(and(...predicates))
          .orderBy(
            desc(projectKnowledgeEntries.updatedAt),
            asc(projectKnowledgeEntries.kind),
            asc(projectKnowledgeEntries.questionSummary),
          );

        return rows.map(mapProjectKnowledgeEntryRow);
      },

      async upsert(record) {
        const values = mapProjectKnowledgeEntryToInsert(record);
        const [row] = await db
          .insert(projectKnowledgeEntries)
          .values(values)
          .onConflictDoUpdate({
            target: projectKnowledgeEntries.id,
            set: {
              projectId: values.projectId,
              kind: values.kind,
              issueType: values.issueType,
              volunteerStage: values.volunteerStage,
              questionSummary: values.questionSummary,
              replyStrategy: values.replyStrategy,
              maskedExample: values.maskedExample,
              sourceKind: values.sourceKind,
              approvedForAi: values.approvedForAi,
              sourceEventId: values.sourceEventId,
              metadataJson: values.metadataJson,
              lastReviewedAt: values.lastReviewedAt,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapProjectKnowledgeEntryRow(
          requireRow(row, "Expected project knowledge row to be returned."),
        );
      },

      async setApproved(input) {
        await db
          .update(projectKnowledgeEntries)
          .set({
            approvedForAi: input.approved,
            lastReviewedAt: input.reviewedAt,
            updatedAt: new Date(),
          })
          .where(eq(projectKnowledgeEntries.id, input.id));
      },

      async deleteById(id) {
        await db
          .delete(projectKnowledgeEntries)
          .where(eq(projectKnowledgeEntries.id, id));
      },

      async getForRetrieval(input) {
        const rows = await db
          .select()
          .from(projectKnowledgeEntries)
          .where(
            and(
              eq(projectKnowledgeEntries.projectId, input.projectId),
              eq(projectKnowledgeEntries.approvedForAi, true),
            ),
          )
          .orderBy(desc(projectKnowledgeEntries.updatedAt));

        const records = rows.map(mapProjectKnowledgeEntryRow);
        const rankedByKind = new Map<
          (typeof PROJECT_KNOWLEDGE_KINDS)[number],
          readonly (typeof records)[number][]
        >();

        for (const kind of PROJECT_KNOWLEDGE_KINDS) {
          rankedByKind.set(
            kind,
            records
              .filter((record) => record.kind === kind)
              .map((record) => ({
                record,
                score: scoreProjectKnowledgeEntry({
                  row: record,
                  issueTypeHint: input.issueTypeHint,
                  keywordsLower: input.keywordsLower,
                }),
              }))
              .sort(
                (left, right) =>
                  right.score - left.score ||
                  right.record.updatedAt.localeCompare(left.record.updatedAt) ||
                  left.record.questionSummary.localeCompare(
                    right.record.questionSummary,
                  ),
              )
              .slice(0, input.limitPerKind)
              .map((entry) => entry.record),
          );
        }

        return PROJECT_KNOWLEDGE_KINDS.flatMap(
          (kind) => rankedByKind.get(kind) ?? [],
        );
      },

      async countCapturedSinceTimestamp(input) {
        const predicates: SQL[] = [
          eq(projectKnowledgeEntries.projectId, input.projectId),
          eq(projectKnowledgeEntries.approvedForAi, true),
        ];

        if (input.since !== null) {
          predicates.push(gt(projectKnowledgeEntries.createdAt, input.since));
        }

        const [row] = await db
          .select({ value: count() })
          .from(projectKnowledgeEntries)
          .where(and(...predicates));

        return row?.value ?? 0;
      },
    },

    contacts: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, id))
          .limit(1);

        return row === undefined ? null : mapContactRow(row);
      },

      async findBySalesforceContactId(salesforceContactId) {
        const [row] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.salesforceContactId, salesforceContactId))
          .limit(1);

        return row === undefined ? null : mapContactRow(row);
      },

      async findByPrimaryPhone(phoneE164) {
        const [row] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.primaryPhone, phoneE164))
          .limit(1);

        return row === undefined ? null : mapContactRow(row);
      },

      async listAll() {
        const rows = await db.select().from(contacts).orderBy(asc(contacts.id));

        return rows.map(mapContactRow);
      },

      async listByIds(ids) {
        if (ids.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(contacts)
          .where(inArray(contacts.id, [...ids]))
          .orderBy(asc(contacts.id));

        return rows.map(mapContactRow);
      },

      async listSalesforceAnchoredIds() {
        const rows = await db
          .select({ id: contacts.salesforceContactId })
          .from(contacts)
          .where(
            and(
              isNotNull(contacts.salesforceContactId),
              isNull(contacts.salesforceDeletedAt),
            ),
          )
          .orderBy(asc(contacts.salesforceContactId));

        return rows
          .map((row) => row.id)
          .filter((id): id is string => id !== null);
      },

      async markSalesforceDeleted(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(contacts)
          .set({ salesforceDeletedAt: new Date(input.deletedAt) })
          .where(
            and(
              inArray(contacts.salesforceContactId, [...input.salesforceIds]),
              isNull(contacts.salesforceDeletedAt),
            ),
          )
          .returning({ id: contacts.id });

        return result.length;
      },

      async markSalesforceReconciled(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(contacts)
          .set({ salesforceReconciledAt: new Date(input.reconciledAt) })
          .where(
            inArray(contacts.salesforceContactId, [...input.salesforceIds]),
          )
          .returning({ id: contacts.id });

        return result.length;
      },

      async searchByQuery(input) {
        const normalizedQuery = input.query.trim().toLowerCase();

        if (normalizedQuery.length < 2) {
          return [];
        }

        const limit = Math.max(1, Math.min(input.limit, 50));
        const pattern = `%${normalizedQuery}%`;
        const baseWhere = or(
          sql`lower(${contacts.displayName}) like ${pattern}`,
          sql`lower(coalesce(${contacts.primaryEmail}, '')) like ${pattern}`,
        );
        const projectIdList = (input.projectIds ?? []).filter(
          (projectId) => projectId.trim().length > 0,
        );
        const whereClause =
          projectIdList.length === 0
            ? baseWhere
            : and(
                baseWhere,
                sql`exists (
                  select 1
                  from ${contactMemberships}
                  where ${contactMemberships.contactId} = ${contacts.id}
                    and ${inArray(contactMemberships.projectId, projectIdList)}
                )`,
              );
        const rows = await db
          .select()
          .from(contacts)
          .where(whereClause)
          .orderBy(
            sql`case when lower(${contacts.displayName}) like ${pattern} then 0 else 1 end`,
            asc(contacts.displayName),
            asc(contacts.id),
          )
          .limit(limit);

        return rows.map(mapContactRow);
      },

      async searchInboxUnified(input) {
        // Unified search backing the inbox search bar. Returns the same
        // contact-attribute query partitioned by membership-existence:
        //
        //   - volunteers: matched contacts with at least one row in
        //     `contact_memberships` (active OR past).
        //   - contacts:   matched contacts with zero membership rows.
        //
        // Sort key is `lastActivityAt` desc — restricted to
        // volunteer-initiated events (lifecycle.* + inbound 1:1 comm +
        // sms.opt_*) so an operator's outbound reply or a campaign send
        // doesn't bump a contact to the top. NULL `lastActivityAt` sorts
        // last with `contacts.created_at` desc as the tiebreaker. Each
        // section is independently capped at `limit`. `totals` reports the
        // pre-truncation count per section.
        const trimmedQuery = input.query.trim();

        if (trimmedQuery.length === 0) {
          // Don't enumerate the entire DB. Below the API-level min query
          // length the route should short-circuit before reaching this; this
          // is a defence-in-depth empty-result shortcut.
          return {
            volunteers: [],
            contacts: [],
            totals: { volunteers: 0, contacts: 0 },
          };
        }

        const limit = Math.max(1, Math.min(input.limit, 200));
        const pattern = `%${escapeIlikePattern(trimmedQuery)}%`;

        // Volunteer-initiated event types that count toward `lastActivityAt`.
        // Excludes outbound sends, all campaign events, and internal notes
        // so an operator's reply or a Mailchimp blast doesn't move a contact
        // up the search-result list. See
        // packages/contracts/src/stage1-taxonomy.ts:36-51 for the canonical
        // event-type list.
        const VOLUNTEER_SIDE_EVENT_TYPES = [
          "lifecycle.signed_up",
          "lifecycle.received_training",
          "lifecycle.completed_training",
          "lifecycle.submitted_first_data",
          "communication.email.inbound",
          "communication.sms.inbound",
          "communication.sms.opt_in",
          "communication.sms.opt_out",
        ] as const;

        // Per-contact lastActivityAt CTE filtered to volunteer-side events.
        const lastActivityCte = sql`(
          select
            ${canonicalEventLedger.contactId} as contact_id,
            max(${canonicalEventLedger.occurredAt}) as last_activity_at
          from ${canonicalEventLedger}
          where ${canonicalEventLedger.eventType} in ${VOLUNTEER_SIDE_EVENT_TYPES}
          group by ${canonicalEventLedger.contactId}
        )`;

        // Per-contact membership-existence CTE. Either an active OR past
        // membership qualifies — any row in `contact_memberships` for the
        // contact flips them into the Volunteers section.
        const membershipFlagCte = sql`(
          select distinct ${contactMemberships.contactId} as contact_id
          from ${contactMemberships}
        )`;

        // Single contact-attribute query, partitioned in TS after we read
        // the `has_membership` flag. We LEFT JOIN inbox projection so
        // projection-backed contacts return their thread metadata for the
        // hybrid row format; non-projection contacts get nulls and render
        // as contact-only rows on the client.
        const contactMatchesResult = await db.execute(sql`
          with last_activity as ${lastActivityCte},
          memberships_flag as ${membershipFlagCte}
          select
            ${contacts.id} as id,
            ${contacts.salesforceContactId} as salesforce_contact_id,
            ${contacts.displayName} as display_name,
            ${contacts.primaryEmail} as primary_email,
            ${contacts.primaryPhone} as primary_phone,
            ${contacts.createdAt} as created_at,
            ${contacts.updatedAt} as updated_at,
            la.last_activity_at as last_activity_at,
            (mf.contact_id is not null) as has_membership,
            ${contactInboxProjection.snippet} as snippet,
            ${contactInboxProjection.lastEventType} as last_event_type,
            ${contactInboxProjection.lastCanonicalEventId} as last_canonical_event_id,
            coalesce(${gmailMessageDetails.subject}, ${salesforceCommunicationDetailsTable.subject}) as latest_subject,
            (${contactInboxProjection.contactId} is not null) as has_projection
          from ${contacts}
          left join last_activity la
            on la.contact_id = ${contacts.id}
          left join memberships_flag mf
            on mf.contact_id = ${contacts.id}
          left join ${contactInboxProjection}
            on ${contactInboxProjection.contactId} = ${contacts.id}
          left join ${canonicalEventLedger}
            on ${canonicalEventLedger.id} = ${contactInboxProjection.lastCanonicalEventId}
          left join ${gmailMessageDetails}
            on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
          left join ${salesforceCommunicationDetailsTable}
            on ${salesforceCommunicationDetailsTable.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
          where (
            ${contacts.displayName} ilike ${pattern} escape '\\'
            or coalesce(${contacts.primaryEmail}, '') ilike ${pattern} escape '\\'
            or coalesce(${contacts.primaryPhone}, '') ilike ${pattern} escape '\\'
            or ${contacts.id} in (
              select distinct header_subject.subject_contact_id
              from (
                select
                  ${canonicalEventLedger.contactId} as subject_contact_id,
                  ${gmailMessageDetails.fromHeader} as from_header,
                  ${gmailMessageDetails.toHeader} as to_header,
                  ${gmailMessageDetails.ccHeader} as cc_header
                from ${canonicalEventLedger}
                inner join ${gmailMessageDetails}
                  on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
                union
                select
                  ${canonicalEventAudience.contactId} as subject_contact_id,
                  ${gmailMessageDetails.fromHeader} as from_header,
                  ${gmailMessageDetails.toHeader} as to_header,
                  ${gmailMessageDetails.ccHeader} as cc_header
                from ${canonicalEventAudience}
                inner join ${canonicalEventLedger}
                  on ${canonicalEventLedger.id} = ${canonicalEventAudience.canonicalEventId}
                inner join ${gmailMessageDetails}
                  on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
              ) as header_subject
              where
                coalesce(header_subject.from_header, '') ilike ${pattern} escape '\\'
                or coalesce(header_subject.to_header, '') ilike ${pattern} escape '\\'
                or coalesce(header_subject.cc_header, '') ilike ${pattern} escape '\\'
            )
            or coalesce(${contactInboxProjection.snippet}, '') ilike ${pattern} escape '\\'
            or exists (
              select 1
              from ${canonicalEventLedger}
              left join ${gmailMessageDetails}
                on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
              left join ${salesforceCommunicationDetailsTable}
                on ${salesforceCommunicationDetailsTable.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
              where ${canonicalEventLedger.contactId} = ${contacts.id}
                and (
                  coalesce(${gmailMessageDetails.subject}, '') ilike ${pattern} escape '\\'
                  or coalesce(${salesforceCommunicationDetailsTable.subject}, '') ilike ${pattern} escape '\\'
                )
            )
          )
          order by la.last_activity_at desc nulls last, ${contacts.createdAt} desc, ${contacts.id} asc
        `);

        interface SearchRowResult {
          readonly id: string;
          readonly salesforce_contact_id: string | null;
          readonly display_name: string;
          readonly primary_email: string | null;
          readonly primary_phone: string | null;
          readonly created_at: Date | string;
          readonly updated_at: Date | string;
          readonly last_activity_at: Date | string | null;
          readonly has_membership: boolean | string | number | null;
          readonly snippet: string | null;
          readonly last_event_type: string | null;
          readonly last_canonical_event_id: string | null;
          readonly latest_subject: string | null;
          readonly has_projection: boolean | string | number | null;
        }

        const allRowsRaw =
          (contactMatchesResult as { rows?: readonly SearchRowResult[] })
            .rows ?? (contactMatchesResult as readonly SearchRowResult[]);

        // Postgres can return booleans as boolean | "t"/"f" | 1/0 depending
        // on the driver layer; normalise once.
        const isTruthyBool = (
          value: boolean | string | number | null | undefined,
        ): boolean =>
          value === true || value === "t" || value === 1 || value === "1";

        const matchedContactIds = allRowsRaw.map((row) => row.id);

        // Active project memberships for chip rendering. Same join as before:
        // `contact_memberships` filtered by active project. (Membership-flag
        // CTE above considers any membership row; this query is for the chip
        // payload, which only renders active projects.)
        const membershipRows =
          matchedContactIds.length === 0
            ? []
            : await db
                .select({
                  contactId: contactMemberships.contactId,
                  projectId: projectDimensions.projectId,
                  projectName: projectDimensions.projectName,
                  projectAlias: projectDimensions.projectAlias,
                })
                .from(contactMemberships)
                .innerJoin(
                  projectDimensions,
                  and(
                    eq(
                      contactMemberships.projectId,
                      projectDimensions.projectId,
                    ),
                    eq(projectDimensions.isActive, true),
                  ),
                )
                .where(inArray(contactMemberships.contactId, matchedContactIds))
                .orderBy(
                  asc(contactMemberships.contactId),
                  asc(projectDimensions.projectName),
                  asc(projectDimensions.projectId),
                );

        const membershipsByContactId = new Map<
          string,
          InboxUnifiedSearchMembership[]
        >();
        for (const row of membershipRows) {
          const existing = membershipsByContactId.get(row.contactId);
          const entry: InboxUnifiedSearchMembership = {
            projectId: row.projectId,
            projectName: row.projectName,
            projectAlias: row.projectAlias,
          };
          if (existing === undefined) {
            membershipsByContactId.set(row.contactId, [entry]);
          } else if (!existing.some((m) => m.projectId === entry.projectId)) {
            existing.push(entry);
          }
        }

        const toIso = (value: Date | string | null): string | null => {
          if (value === null) return null;
          if (value instanceof Date) return value.toISOString();
          return new Date(value).toISOString();
        };

        const toDate = (value: Date | string): Date =>
          value instanceof Date ? value : new Date(value);

        const toRow = (raw: SearchRowResult): InboxUnifiedSearchRow => ({
          contact: mapContactRow({
            id: raw.id,
            salesforceContactId: raw.salesforce_contact_id,
            displayName: raw.display_name,
            primaryEmail: raw.primary_email,
            primaryPhone: raw.primary_phone,
            createdAt: toDate(raw.created_at),
            updatedAt: toDate(raw.updated_at),
          }),
          memberships: membershipsByContactId.get(raw.id) ?? [],
          hasMembership: isTruthyBool(raw.has_membership),
          lastActivityAt: toIso(raw.last_activity_at),
          hasProjection: isTruthyBool(raw.has_projection),
          snippet: raw.snippet,
          latestMessageSubject:
            raw.latest_subject !== null && raw.latest_subject.length > 0
              ? raw.latest_subject
              : null,
          lastEventType:
            raw.last_event_type === null
              ? null
              : (raw.last_event_type as InboxUnifiedSearchRow["lastEventType"]),
        });

        const volunteerRowsAll: InboxUnifiedSearchRow[] = [];
        const contactRowsAll: InboxUnifiedSearchRow[] = [];
        for (const raw of allRowsRaw) {
          const mapped = toRow(raw);
          if (mapped.hasMembership) {
            volunteerRowsAll.push(mapped);
          } else {
            contactRowsAll.push(mapped);
          }
        }

        return {
          volunteers: volunteerRowsAll.slice(0, limit),
          contacts: contactRowsAll.slice(0, limit),
          totals: {
            volunteers: volunteerRowsAll.length,
            contacts: contactRowsAll.length,
          },
        };
      },

      async upsert(record) {
        const values = mapContactToInsert(record);
        const [row] = await db
          .insert(contacts)
          .values(values)
          .onConflictDoUpdate({
            target: contacts.id,
            set: {
              salesforceContactId: values.salesforceContactId,
              displayName: values.displayName,
              primaryEmail: values.primaryEmail,
              primaryPhone: values.primaryPhone,
              createdAt: values.createdAt,
              updatedAt: values.updatedAt,
            },
          })
          .returning();

        return mapContactRow(
          requireRow(row, "Expected contact row to be returned."),
        );
      },
    },

    async mergeEmailOnlyContactIntoAnchored(input: {
      readonly emailOnlyContactId: string;
      readonly anchoredContactId: string;
    }) {
      return db.transaction(async (tx: Stage1Database) => {
        // Note: UPDATE SET clauses use bare column names (e.g., `contact_id`,
        // not `${table.column}`) because PostgreSQL treats `"table"."column"`
        // in a SET target as a composite-type subfield reference, not a table
        // qualification, and rejects it.
        const canonicalEventsResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          update ${canonicalEventLedger}
          set
            contact_id = ${input.anchoredContactId},
            updated_at = timezone('utc', now())
          where ${canonicalEventLedger.contactId} = ${input.emailOnlyContactId}
          returning ${canonicalEventLedger.id} as id
        `);
        const timelineRowsResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          update ${contactTimelineProjection}
          set
            contact_id = ${input.anchoredContactId},
            updated_at = timezone('utc', now())
          where ${contactTimelineProjection.contactId} = ${input.emailOnlyContactId}
          returning ${contactTimelineProjection.id} as id
        `);
        const noteRowsResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          update ${internalNotes}
          set
            contact_id = ${input.anchoredContactId},
            updated_at = timezone('utc', now())
          where ${internalNotes.contactId} = ${input.emailOnlyContactId}
          returning ${internalNotes.id} as id
        `);
        const routingRowsResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          update ${routingReviewQueue}
          set
            contact_id = ${input.anchoredContactId},
            updated_at = timezone('utc', now())
          where ${routingReviewQueue.contactId} = ${input.emailOnlyContactId}
          returning ${routingReviewQueue.id} as id
        `);
        const identityCasesResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          update ${identityResolutionQueue}
          set
            anchored_contact_id = case
              when ${identityResolutionQueue.anchoredContactId} = ${input.emailOnlyContactId}
                then ${input.anchoredContactId}
              else ${identityResolutionQueue.anchoredContactId}
            end,
            candidate_contact_ids = (
              select coalesce(
                array_agg(candidate_id order by candidate_id),
                array[]::text[]
              )
              from (
                select distinct candidate_id
                from unnest(
                  case
                    when ${identityResolutionQueue.candidateContactIds} && array[${input.emailOnlyContactId}]::text[]
                      then array_replace(
                        ${identityResolutionQueue.candidateContactIds},
                        ${input.emailOnlyContactId},
                        ${input.anchoredContactId}
                      )
                    else ${identityResolutionQueue.candidateContactIds}
                  end
                ) as candidate_id
                where candidate_id <> ${input.emailOnlyContactId}
              ) deduped_candidates
            ),
            updated_at = timezone('utc', now())
          where ${identityResolutionQueue.anchoredContactId} = ${input.emailOnlyContactId}
             or ${identityResolutionQueue.candidateContactIds} && array[${input.emailOnlyContactId}]::text[]
          returning ${identityResolutionQueue.id} as id
        `);
        // Drop email-only audience rows that would collide with an existing
        // anchored row on the same canonical event before repointing the rest.
        // canonical_event_audience cascades on contact deletion, so this must
        // happen before the contact DELETE below.
        await tx.execute(sql`
          delete from ${canonicalEventAudience}
          where ${canonicalEventAudience.contactId} = ${input.emailOnlyContactId}
            and ${canonicalEventAudience.canonicalEventId} in (
              select ${canonicalEventAudience.canonicalEventId}
              from ${canonicalEventAudience}
              where ${canonicalEventAudience.contactId} = ${input.anchoredContactId}
            )
        `);
        const audienceRowsResult = await tx.execute(sql<{
          readonly canonical_event_id: string;
        }>`
          update ${canonicalEventAudience}
          set
            contact_id = ${input.anchoredContactId},
            updated_at = timezone('utc', now())
          where ${canonicalEventAudience.contactId} = ${input.emailOnlyContactId}
          returning ${canonicalEventAudience.canonicalEventId} as canonical_event_id
        `);
        const deletedContactsResult = await tx.execute(sql<{
          readonly id: string;
        }>`
          delete from ${contacts}
          where ${contacts.id} = ${input.emailOnlyContactId}
          returning ${contacts.id} as id
        `);
        const deletedContactRows = normalizeSqlResultRows<{
          readonly id: string;
        }>(
          deletedContactsResult as {
            readonly rows?: readonly { readonly id: string }[];
          },
        );

        if (deletedContactRows.length !== 1) {
          throw new Error(
            `Expected to delete exactly one email-only contact for ${input.emailOnlyContactId}; deleted ${deletedContactRows.length.toString()}.`,
          );
        }

        return {
          canonicalEventsRepointed: normalizeSqlResultRows<{
            readonly id: string;
          }>(
            canonicalEventsResult as {
              readonly rows?: readonly { readonly id: string }[];
            },
          ).length,
          timelineRowsRepointed: normalizeSqlResultRows<{
            readonly id: string;
          }>(
            timelineRowsResult as {
              readonly rows?: readonly { readonly id: string }[];
            },
          ).length,
          notesRepointed: normalizeSqlResultRows<{ readonly id: string }>(
            noteRowsResult as {
              readonly rows?: readonly { readonly id: string }[];
            },
          ).length,
          routingRowsRepointed: normalizeSqlResultRows<{ readonly id: string }>(
            routingRowsResult as {
              readonly rows?: readonly { readonly id: string }[];
            },
          ).length,
          identityCasesRepointed: normalizeSqlResultRows<{
            readonly id: string;
          }>(
            identityCasesResult as {
              readonly rows?: readonly { readonly id: string }[];
            },
          ).length,
          audienceRowsRepointed: normalizeSqlResultRows<{
            readonly canonical_event_id: string;
          }>(
            audienceRowsResult as {
              readonly rows?: readonly {
                readonly canonical_event_id: string;
              }[];
            },
          ).length,
          contactDeleted: true,
        };
      });
    },

    contactIdentities: {
      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.contactId, contactId))
          .orderBy(
            desc(contactIdentities.isPrimary),
            asc(contactIdentities.normalizedValue),
          );

        return rows.map(mapContactIdentityRow);
      },

      async listByNormalizedValue(input) {
        const rows = await db
          .select()
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.kind, input.kind),
              eq(contactIdentities.normalizedValue, input.normalizedValue),
            ),
          )
          .orderBy(
            desc(contactIdentities.isPrimary),
            asc(contactIdentities.id),
          );

        return rows.map(mapContactIdentityRow);
      },

      async upsert(record) {
        const values = mapContactIdentityToInsert(record);
        const [row] = await db
          .insert(contactIdentities)
          .values(values)
          .onConflictDoUpdate({
            target: [
              contactIdentities.contactId,
              contactIdentities.kind,
              contactIdentities.normalizedValue,
            ],
            set: {
              isPrimary: values.isPrimary,
              source: values.source,
              verifiedAt: values.verifiedAt,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapContactIdentityRow(
          requireRow(row, "Expected contact identity row to be returned."),
        );
      },
    },

    contactMemberships: {
      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(contactMemberships)
          .where(eq(contactMemberships.contactId, contactId))
          .orderBy(
            asc(contactMemberships.projectId),
            asc(contactMemberships.id),
          );

        return rows.map(mapContactMembershipRow);
      },

      async listByContactIds(contactIds) {
        if (contactIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(contactMemberships)
          .where(inArray(contactMemberships.contactId, [...contactIds]))
          .orderBy(
            asc(contactMemberships.contactId),
            asc(contactMemberships.projectId),
            asc(contactMemberships.id),
          );

        return rows.map(mapContactMembershipRow);
      },

      async listSalesforceAnchoredIds() {
        const rows = await db
          .select({ id: contactMemberships.salesforceMembershipId })
          .from(contactMemberships)
          .where(
            and(
              eq(contactMemberships.source, "salesforce"),
              isNotNull(contactMemberships.salesforceMembershipId),
              isNull(contactMemberships.salesforceDeletedAt),
            ),
          )
          .orderBy(asc(contactMemberships.salesforceMembershipId));

        return rows
          .map((row) => row.id)
          .filter((id): id is string => id !== null);
      },

      async markSalesforceDeleted(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(contactMemberships)
          .set({ salesforceDeletedAt: new Date(input.deletedAt) })
          .where(
            and(
              inArray(contactMemberships.salesforceMembershipId, [
                ...input.salesforceIds,
              ]),
              isNull(contactMemberships.salesforceDeletedAt),
            ),
          )
          .returning({ id: contactMemberships.id });

        return result.length;
      },

      async markSalesforceReconciled(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(contactMemberships)
          .set({ salesforceReconciledAt: new Date(input.reconciledAt) })
          .where(
            inArray(contactMemberships.salesforceMembershipId, [
              ...input.salesforceIds,
            ]),
          )
          .returning({ id: contactMemberships.id });

        return result.length;
      },

      async upsert(record) {
        const values = mapContactMembershipToInsert(record);
        const [row] = await db
          .insert(contactMemberships)
          .values(values)
          .onConflictDoUpdate({
            target: contactMemberships.id,
            set: {
              contactId: values.contactId,
              projectId: values.projectId,
              expeditionId: values.expeditionId,
              salesforceMembershipId: values.salesforceMembershipId,
              role: values.role,
              status: values.status,
              source: values.source,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapContactMembershipRow(
          requireRow(row, "Expected contact membership row to be returned."),
        );
      },
    },

    ...smsRepositories,

    projectDimensions: {
      async findById(projectId) {
        const [row] = await db
          .select()
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);

        return row === undefined ? null : mapProjectDimensionRow(row);
      },

      async listAll() {
        const rows = await db
          .select()
          .from(projectDimensions)
          .orderBy(asc(projectDimensions.projectName));

        return rows.map(mapProjectDimensionRow);
      },

      async listActive() {
        const rows = await db
          .select()
          .from(projectDimensions)
          .where(eq(projectDimensions.isActive, true))
          .orderBy(asc(projectDimensions.projectName));

        return rows.map(mapProjectDimensionRow);
      },

      async listAllProjectAliases() {
        // Returns every project inbox email alias the platform considers
        // "ours" for the email bubble-side renderer (D-049). The source of
        // truth is the `project_aliases.alias` column — the admin-managed
        // table of project inbox email addresses (e.g.
        // `pnwbio@adventurescientists.org`). NOT `project_dimensions.project_alias`,
        // which is a separate "short internal project name" / display label
        // (e.g. `PNW Biodiversity`) and does NOT contain email addresses.
        //
        // The initial D-049 cut queried the wrong column and consequently
        // every right-side bubble rendered as left-side because no real
        // email matched a project-name label. Switched to project_aliases.
        //
        // Aliases are lowercased + trimmed + deduplicated. Empty values
        // are filtered out for safety.
        //
        // Note: rename-preservation across alias changes (the original
        // `previous_aliases` array column on project_dimensions, also
        // shipped under the wrong-table bug) is parked as a future
        // follow-up — would belong on `project_aliases`, either as a
        // sibling history table or a soft-delete column.
        const result = await db.execute(sql<{
          readonly alias: string;
        }>`
          select lower(trim(${projectAliases.alias})) as alias
          from ${projectAliases}
          where coalesce(trim(${projectAliases.alias}), '') <> ''
          group by lower(trim(${projectAliases.alias}))
          order by lower(trim(${projectAliases.alias}))
        `);

        return normalizeSqlResultRows<{ readonly alias: string }>(
          result as { readonly rows?: readonly { readonly alias: string }[] },
        ).map((row) => row.alias);
      },

      async listByIds(projectIds) {
        if (projectIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(projectDimensions)
          .where(inArray(projectDimensions.projectId, [...projectIds]))
          .orderBy(asc(projectDimensions.projectId));

        return rows.map(mapProjectDimensionRow);
      },

      async listSalesforceAnchoredIds() {
        const rows = await db
          .select({ id: projectDimensions.projectId })
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.source, "salesforce"),
              isNull(projectDimensions.salesforceDeletedAt),
            ),
          )
          .orderBy(asc(projectDimensions.projectId));

        return rows.map((row) => row.id);
      },

      async markSalesforceDeleted(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(projectDimensions)
          .set({ salesforceDeletedAt: new Date(input.deletedAt) })
          .where(
            and(
              inArray(projectDimensions.projectId, [...input.salesforceIds]),
              eq(projectDimensions.source, "salesforce"),
              isNull(projectDimensions.salesforceDeletedAt),
            ),
          )
          .returning({ id: projectDimensions.projectId });

        return result.length;
      },

      async markSalesforceReconciled(input) {
        if (input.salesforceIds.length === 0) {
          return 0;
        }

        const result = await db
          .update(projectDimensions)
          .set({ salesforceReconciledAt: new Date(input.reconciledAt) })
          .where(
            and(
              inArray(projectDimensions.projectId, [...input.salesforceIds]),
              eq(projectDimensions.source, "salesforce"),
            ),
          )
          .returning({ id: projectDimensions.projectId });

        return result.length;
      },

      async listConnectedProjects(hostProjectId) {
        const rows = await db
          .select()
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.connectedToProjectId, hostProjectId),
              eq(projectDimensions.isActive, true),
            ),
          )
          .orderBy(asc(projectDimensions.projectName));

        return rows.map(mapProjectDimensionRow);
      },

      async listAvailableConnectionCandidates() {
        const rows = await db
          .select()
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.isActive, false),
              isNull(projectDimensions.connectedToProjectId),
            ),
          )
          .orderBy(asc(projectDimensions.projectName));

        return rows.map(mapProjectDimensionRow);
      },

      async findEffectiveAiKnowledge(
        projectId,
      ): Promise<EffectiveAiKnowledge | null> {
        // Resolve sub→host transparently. The AI Draft pipeline (and any
        // future consolidated grounding loader) calls through here so a
        // connected sub-project inherits the host's curated AI Knowledge
        // bundle without each call site re-implementing the lookup.
        //
        // Settings code paths must NOT call this — they edit the raw stored
        // value via setAiKnowledgeUrl / setAiKnowledgeSources etc.
        const [ownRow] = await db
          .select()
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);

        if (ownRow === undefined) {
          return null;
        }

        const ownRecord = mapProjectDimensionRow(ownRow);
        const hostProjectId = ownRecord.connectedToProjectId ?? null;
        let resolved = ownRecord;

        if (hostProjectId !== null) {
          const [hostRow] = await db
            .select()
            .from(projectDimensions)
            .where(eq(projectDimensions.projectId, hostProjectId))
            .limit(1);

          if (hostRow !== undefined) {
            resolved = mapProjectDimensionRow(hostRow);
            console.debug(
              JSON.stringify({
                event: "ai_knowledge.fallback",
                subProjectId: projectId,
                hostProjectId,
              }),
            );
          }
          // If the host row is missing (orphaned connection — shouldn't
          // happen in practice because connected_to_project_id has
          // ON DELETE SET NULL, but defensive), fall through to the sub's
          // own (likely null) values rather than throwing.
        }

        return {
          projectId,
          resolvedFromProjectId: resolved.projectId,
          aiKnowledgeUrl: resolved.aiKnowledgeUrl ?? null,
          aiKnowledgeSources: aiKnowledgeSourcesSchema.parse(
            resolved.aiKnowledgeSources ?? [],
          ),
          aiOperatingContext: resolved.aiOperatingContext ?? "",
          aiAutoSyncSchedule: resolved.aiAutoSyncSchedule ?? "never",
          aiOptimizedSynthesizedAt: resolved.aiOptimizedSynthesizedAt ?? null,
          aiOptimizedInputHash: resolved.aiOptimizedInputHash ?? null,
        };
      },

      async getAiKnowledgeSources(projectId) {
        const [row] = await db
          .select({
            aiKnowledgeSources: projectDimensions.aiKnowledgeSources,
          })
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);

        return aiKnowledgeSourcesSchema.parse(row?.aiKnowledgeSources ?? []);
      },

      async setAiKnowledgeSources(projectId, sources) {
        const parsedSources = aiKnowledgeSourcesSchema.parse(sources);

        await db
          .update(projectDimensions)
          .set({
            aiKnowledgeSources: parsedSources,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId));
      },

      async updateOperatingContext(projectId, context) {
        await db
          .update(projectDimensions)
          .set({
            aiOperatingContext: context,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId));
      },

      async setAiAutoSyncSchedule(projectId, schedule) {
        await db
          .update(projectDimensions)
          .set({
            aiAutoSyncSchedule: schedule,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId));
      },

      async setSynthesisMetadata(projectId, input) {
        // Build the SET clause selectively: undefined means "leave the
        // existing value alone" (e.g. the skip-if-unchanged path passes
        // lastCheckedAt + inputHash but not synthesizedAt). Explicit null is
        // still passed through to clear a field.
        const updates: Partial<typeof projectDimensions.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.synthesizedAt !== undefined) {
          updates.aiOptimizedSynthesizedAt =
            input.synthesizedAt === null ? null : new Date(input.synthesizedAt);
        }
        if (input.lastCheckedAt !== undefined) {
          updates.aiOptimizedLastCheckedAt =
            input.lastCheckedAt === null ? null : new Date(input.lastCheckedAt);
        }
        if (input.inputHash !== undefined) {
          updates.aiOptimizedInputHash = input.inputHash;
        }
        await db
          .update(projectDimensions)
          .set(updates)
          .where(eq(projectDimensions.projectId, projectId));
      },

      async upsert(record) {
        const values = mapProjectDimensionToInsert(record);
        const [row] = await db
          .insert(projectDimensions)
          .values(values)
          .onConflictDoUpdate({
            target: projectDimensions.projectId,
            set: {
              projectName: values.projectName,
              // projectAlias preserves existing value when caller passes null
              // (Salesforce capture has no alias concept and must not clobber
              // admin-managed state from Settings). Non-null callers can still
              // overwrite intentionally.
              projectAlias: sql`COALESCE(EXCLUDED.${sql.identifier(
                "project_alias",
              )}, ${projectDimensions.projectAlias})`,
              // connectedToProjectId follows the same rule as projectAlias:
              // operator-managed, must not be clobbered by Salesforce capture.
              connectedToProjectId: sql`COALESCE(EXCLUDED.${sql.identifier(
                "connected_to_project_id",
              )}, ${projectDimensions.connectedToProjectId})`,
              // isActive intentionally NOT updated: admins manage it in Settings,
              // and Salesforce capture must not overwrite that app-owned state.
              // aiKnowledgeUrl / aiKnowledgeSyncedAt follow the same
              // operator-managed rule as alias/connected host metadata:
              // Salesforce capture has no opinion here and must not wipe
              // Settings-managed or synthesis-managed state with nulls.
              aiKnowledgeUrl: sql`COALESCE(EXCLUDED.${sql.identifier(
                "ai_knowledge_url",
              )}, ${projectDimensions.aiKnowledgeUrl})`,
              aiKnowledgeSyncedAt: sql`COALESCE(EXCLUDED.${sql.identifier(
                "ai_knowledge_synced_at",
              )}, ${projectDimensions.aiKnowledgeSyncedAt})`,
              aiKnowledgeSources:
                values.aiKnowledgeSources ??
                projectDimensions.aiKnowledgeSources,
              aiOperatingContext:
                values.aiOperatingContext ??
                projectDimensions.aiOperatingContext,
              aiOptimizedSynthesizedAt:
                values.aiOptimizedSynthesizedAt === undefined
                  ? projectDimensions.aiOptimizedSynthesizedAt
                  : values.aiOptimizedSynthesizedAt,
              aiOptimizedInputHash:
                values.aiOptimizedInputHash === undefined
                  ? projectDimensions.aiOptimizedInputHash
                  : values.aiOptimizedInputHash,
              aiAutoSyncSchedule: projectDimensions.aiAutoSyncSchedule,
              source: values.source,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapProjectDimensionRow(
          requireRow(row, "Expected project dimension row to be returned."),
        );
      },
    },

    expeditionDimensions: {
      async listByIds(expeditionIds) {
        if (expeditionIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(expeditionDimensions)
          .where(inArray(expeditionDimensions.expeditionId, [...expeditionIds]))
          .orderBy(asc(expeditionDimensions.expeditionId));

        return rows.map(mapExpeditionDimensionRow);
      },

      async upsert(record) {
        const values = mapExpeditionDimensionToInsert(record);
        const [row] = await db
          .insert(expeditionDimensions)
          .values(values)
          .onConflictDoUpdate({
            target: expeditionDimensions.expeditionId,
            set: {
              projectId: values.projectId,
              expeditionName: values.expeditionName,
              source: values.source,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapExpeditionDimensionRow(
          requireRow(row, "Expected expedition dimension row to be returned."),
        );
      },
    },

    gmailMessageDetails: {
      async findByRfc822MessageId(rfc822MessageId) {
        const [row] = await db
          .select()
          .from(gmailMessageDetails)
          .where(eq(gmailMessageDetails.rfc822MessageId, rfc822MessageId))
          .orderBy(desc(gmailMessageDetails.createdAt))
          .limit(1);

        return row === undefined ? null : mapGmailMessageDetailRow(row);
      },

      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(gmailMessageDetails)
          .where(
            inArray(gmailMessageDetails.sourceEvidenceId, [
              ...sourceEvidenceIds,
            ]),
          )
          .orderBy(asc(gmailMessageDetails.sourceEvidenceId));

        return rows.map(mapGmailMessageDetailRow);
      },

      async listLastInboundAliasByContactIds(contactIds) {
        if (contactIds.length === 0) {
          return new Map();
        }

        // Date-bound the scan to avoid an open-ended walk back through history
        // when a contact's most recent activity is non-Gmail (e.g. SF Tasks).
        // 180 days is well past any realistic window in which an inbound
        // project-alias could be assumed stable for membership resolution.
        const result = await db.execute(
          sql`
            select distinct on (${canonicalEventLedger.contactId})
              ${canonicalEventLedger.contactId} as "contactId",
              ${gmailMessageDetails.projectInboxAlias} as "projectInboxAlias"
            from ${canonicalEventLedger}
            inner join ${gmailMessageDetails}
              on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
            where ${inArray(canonicalEventLedger.contactId, [...contactIds])}
              and ${gmailMessageDetails.direction} = 'inbound'
              and ${gmailMessageDetails.projectInboxAlias} is not null
              and ${canonicalEventLedger.occurredAt} > now() - interval '180 days'
            order by
              ${canonicalEventLedger.contactId},
              ${canonicalEventLedger.occurredAt} desc
          `,
        );

        // drizzle-orm/postgres-js returns rows as a top-level iterable;
        // drizzle-orm/pglite (used in tests) returns { rows: [...] }.
        // Normalize to a plain array of rows.
        const rows: readonly {
          readonly contactId: string;
          readonly projectInboxAlias: string;
        }[] = Array.isArray(result)
          ? (result as readonly {
              readonly contactId: string;
              readonly projectInboxAlias: string;
            }[])
          : ((
              result as {
                readonly rows?: readonly {
                  readonly contactId: string;
                  readonly projectInboxAlias: string;
                }[];
              }
            ).rows ?? []);

        return new Map(
          rows.map((row) => [row.contactId, row.projectInboxAlias]),
        );
      },

      async upsert(record) {
        const values = mapGmailMessageDetailToInsert(record);
        const [row] = await db
          .insert(gmailMessageDetails)
          .values(values)
          .onConflictDoUpdate({
            target: gmailMessageDetails.sourceEvidenceId,
            set: {
              providerRecordId: values.providerRecordId,
              gmailThreadId: values.gmailThreadId,
              rfc822MessageId: values.rfc822MessageId,
              direction: values.direction,
              subject: values.subject,
              fromHeader: values.fromHeader,
              toHeader: values.toHeader,
              ccHeader: values.ccHeader,
              labelIds: values.labelIds,
              snippetClean: values.snippetClean,
              bodyTextPreview: values.bodyTextPreview,
              bodyKind: values.bodyKind,
              capturedMailbox: values.capturedMailbox,
              projectInboxAlias: values.projectInboxAlias,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapGmailMessageDetailRow(
          requireRow(row, "Expected Gmail message detail row to be returned."),
        );
      },
    },

    messageAttachments: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(messageAttachments)
          .where(eq(messageAttachments.id, id))
          .limit(1);

        return row === undefined ? null : mapMessageAttachmentRow(row);
      },

      async findByMessageIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(messageAttachments)
          .where(
            inArray(messageAttachments.sourceEvidenceId, [
              ...sourceEvidenceIds,
            ]),
          )
          .orderBy(
            asc(messageAttachments.sourceEvidenceId),
            asc(messageAttachments.id),
          );

        return rows.map(mapMessageAttachmentRow);
      },

      async upsertManyForMessage(sourceEvidenceId, rows) {
        if (rows.length === 0) {
          return;
        }

        await db
          .insert(messageAttachments)
          .values(
            rows.map((row) =>
              mapMessageAttachmentToInsert({
                ...row,
                sourceEvidenceId,
                createdAt: new Date().toISOString(),
              }),
            ),
          )
          .onConflictDoNothing({
            target: messageAttachments.id,
          });
      },
    },

    salesforceEventContext: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(salesforceEventContext)
          .where(
            inArray(salesforceEventContext.sourceEvidenceId, [
              ...sourceEvidenceIds,
            ]),
          )
          .orderBy(asc(salesforceEventContext.sourceEvidenceId));

        return rows.map(mapSalesforceEventContextRow);
      },

      async upsert(record) {
        const values = mapSalesforceEventContextToInsert(record);
        const [row] = await db
          .insert(salesforceEventContext)
          .values(values)
          .onConflictDoUpdate({
            target: salesforceEventContext.sourceEvidenceId,
            set: {
              salesforceContactId: values.salesforceContactId,
              projectId: values.projectId,
              expeditionId: values.expeditionId,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapSalesforceEventContextRow(
          requireRow(
            row,
            "Expected Salesforce event context row to be returned.",
          ),
        );
      },
    },

    salesforceCommunicationDetails: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const sourceEvidenceIdColumn =
          salesforceCommunicationDetailsTable.sourceEvidenceId;
        const rows = (await db
          .select()
          .from(salesforceCommunicationDetails)
          .where(inArray(sourceEvidenceIdColumn, [...sourceEvidenceIds]))
          .orderBy(
            asc(sourceEvidenceIdColumn),
          )) as SalesforceCommunicationDetailRow[];

        return rows.map(mapSalesforceCommunicationDetailRowLocal);
      },

      async upsert(record) {
        const sourceEvidenceIdColumn =
          salesforceCommunicationDetailsTable.sourceEvidenceId;
        const values = mapSalesforceCommunicationDetailToInsertLocal(
          record as SalesforceCommunicationDetailRecord,
        );
        const [row] = (await db
          .insert(salesforceCommunicationDetails)
          .values(values)
          .onConflictDoUpdate({
            target: sourceEvidenceIdColumn,
            set: {
              providerRecordId: values.providerRecordId,
              channel: values.channel,
              messageKind: values.messageKind,
              subject: values.subject,
              snippet: values.snippet,
              sourceLabel: values.sourceLabel,
              updatedAt: new Date(),
            },
          })
          .returning()) as SalesforceCommunicationDetailRow[];

        return mapSalesforceCommunicationDetailRowLocal(
          requireRow(
            row,
            "Expected Salesforce communication detail row to be returned.",
          ),
        );
      },
    },

    salesforceReconciliationRuns: {
      async insert(record) {
        await db
          .insert(salesforceReconciliationRuns)
          .values(mapSalesforceReconciliationRunToInsert(record));
      },
    },

    simpleTextingMessageDetails: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const sourceEvidenceIdColumn =
          simpleTextingMessageDetailsTable.sourceEvidenceId;
        const rows = (await db
          .select()
          .from(simpleTextingMessageDetails)
          .where(inArray(sourceEvidenceIdColumn, [...sourceEvidenceIds]))
          .orderBy(
            asc(sourceEvidenceIdColumn),
          )) as SimpleTextingMessageDetailRow[];

        return rows.map(mapSimpleTextingMessageDetailRowLocal);
      },

      async upsert(record) {
        const sourceEvidenceIdColumn =
          simpleTextingMessageDetailsTable.sourceEvidenceId;
        const values = mapSimpleTextingMessageDetailToInsertLocal(
          record as SimpleTextingMessageDetailRecord,
        );
        const [row] = (await db
          .insert(simpleTextingMessageDetails)
          .values(values)
          .onConflictDoUpdate({
            target: sourceEvidenceIdColumn,
            set: {
              providerRecordId: values.providerRecordId,
              direction: values.direction,
              messageKind: values.messageKind,
              messageTextPreview: values.messageTextPreview,
              normalizedPhone: values.normalizedPhone,
              campaignId: values.campaignId,
              campaignName: values.campaignName,
              providerThreadId: values.providerThreadId,
              threadKey: values.threadKey,
              updatedAt: new Date(),
            },
          })
          .returning()) as SimpleTextingMessageDetailRow[];

        return mapSimpleTextingMessageDetailRowLocal(
          requireRow(
            row,
            "Expected SimpleTexting message detail row to be returned.",
          ),
        );
      },
    },

    mailchimpCampaignActivityDetails: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const sourceEvidenceIdColumn =
          mailchimpCampaignActivityDetailsTable.sourceEvidenceId;
        const rows = (await db
          .select()
          .from(mailchimpCampaignActivityDetails)
          .where(inArray(sourceEvidenceIdColumn, [...sourceEvidenceIds]))
          .orderBy(
            asc(sourceEvidenceIdColumn),
          )) as MailchimpCampaignActivityDetailRow[];

        return rows.map(mapMailchimpCampaignActivityDetailRowLocal);
      },

      async listByCampaignIds(campaignIds) {
        const normalizedCampaignIds = [
          ...new Set(
            campaignIds.map((campaignId) => campaignId.trim()).filter(Boolean),
          ),
        ];

        if (normalizedCampaignIds.length === 0) {
          return [];
        }

        const campaignIdColumn =
          mailchimpCampaignActivityDetailsTable.campaignId;
        const rows = (await db
          .select()
          .from(mailchimpCampaignActivityDetails)
          .where(inArray(campaignIdColumn, normalizedCampaignIds))
          .orderBy(
            asc(campaignIdColumn),
            asc(mailchimpCampaignActivityDetailsTable.createdAt),
          )) as MailchimpCampaignActivityDetailRow[];

        return rows.map(mapMailchimpCampaignActivityDetailRowLocal);
      },

      async aggregateForCampaign(campaignId) {
        const normalizedCampaignId = campaignId.trim();
        if (normalizedCampaignId.length === 0) {
          return {
            sent: 0,
            opened: 0,
            clicked: 0,
            bounced: 0,
            unsubscribed: 0,
            distinctMembers: 0,
          } satisfies MailchimpCampaignAggregates;
        }

        const [aggregateResult, membersResult] = await Promise.all([
          db.execute(sql<MailchimpAggregateRowDb>`
            select
              activity_type as "activityType",
              count(*)::int as "total"
            from mailchimp_campaign_activity_details
            where campaign_id = ${normalizedCampaignId}
            group by activity_type
          `),
          db.execute(sql<{ readonly count: number | string }>`
            select count(distinct member_id)::int as "count"
            from mailchimp_campaign_activity_details
            where campaign_id = ${normalizedCampaignId}
              and member_id is not null
          `),
        ]);

        let sent = 0;
        let opened = 0;
        let clicked = 0;
        let bounced = 0;
        let unsubscribed = 0;
        const distinctMembers = Number(
          normalizeSqlResultRows<{ readonly count: number | string }>(
            membersResult as {
              readonly rows?: readonly { readonly count: number | string }[];
            },
          )[0]?.count ?? 0,
        );

        for (const row of normalizeSqlResultRows<MailchimpAggregateRowDb>(
          aggregateResult as {
            readonly rows?: readonly MailchimpAggregateRowDb[];
          },
        )) {
          switch (normalizeMailchimpActivityType(row.activityType)) {
            case "sent":
              sent = Number(row.total);
              break;
            case "opened":
              opened = Number(row.total);
              break;
            case "clicked":
              clicked = Number(row.total);
              break;
            case "bounced":
              bounced = Number(row.total);
              break;
            case "unsubscribed":
              unsubscribed = Number(row.total);
              break;
          }
        }

        return {
          sent,
          opened,
          clicked,
          bounced,
          unsubscribed,
          distinctMembers,
        };
      },

      async listRecipientsForCampaign(campaignId, opts) {
        const normalizedCampaignId = campaignId.trim();
        if (normalizedCampaignId.length === 0) {
          return {
            rows: [],
            total: 0,
          } satisfies {
            readonly rows: readonly MailchimpRecipientRow[];
            readonly total: number;
          };
        }

        const limit = Math.min(200, Math.max(1, Math.floor(opts.limit)));
        const offset = Math.max(0, Math.floor(opts.offset));
        const filter = opts.filter ?? "all";
        const filterPredicate = (() => {
          switch (filter) {
            case "sent":
              return sql`"hasSent" = true`;
            case "delivered":
              return sql`"hasSent" = true and "hasBounced" = false`;
            case "opened":
              return sql`"hasOpened" = true`;
            case "clicked":
              return sql`"hasClicked" = true`;
            case "bounced":
              return sql`"hasBounced" = true`;
            case "unsubscribed":
              return sql`"hasUnsubscribed" = true`;
            case "all":
              return sql`true`;
          }
        })();
        const recipientsCte = sql`
          with member_activity as (
            select
              member_id as "memberId",
              max(created_at) as "latestEventAt",
              bool_or(activity_type = 'sent') as "hasSent",
              bool_or(activity_type in ('open', 'opened')) as "hasOpened",
              bool_or(activity_type in ('click', 'clicked')) as "hasClicked",
              bool_or(activity_type = 'bounce') as "hasBounced",
              bool_or(activity_type in ('unsubscribe', 'unsubscribed')) as "hasUnsubscribed"
            from mailchimp_campaign_activity_details
            where campaign_id = ${normalizedCampaignId}
              and member_id is not null
            group by member_id
          ),
          filtered as (
            select
              "memberId",
              null::text as "email",
              null::text as "displayName",
              null::text as "contactId",
              case
                when "hasClicked" then 'clicked'
                when "hasOpened" then 'opened'
                when "hasUnsubscribed" then 'unsubscribed'
                when "hasBounced" then 'bounced'
                when "hasSent" then 'delivered'
                else 'sent'
              end as "latestState",
              "latestEventAt",
              "hasSent",
              "hasOpened",
              "hasClicked",
              "hasBounced",
              "hasUnsubscribed"
            from member_activity
          )
        `;

        const [rowsResult, countResult] = await Promise.all([
          db.execute(sql<MailchimpRecipientRowDb>`
            ${recipientsCte}
            select
              "memberId",
              "email",
              "displayName",
              "contactId",
              "latestState",
              "latestEventAt"
            from filtered
            where ${filterPredicate}
            order by "latestEventAt" desc, "memberId" asc
            limit ${limit}
            offset ${offset}
          `),
          db.execute(sql<{ readonly count: number | string }>`
            ${recipientsCte}
            select count(*)::int as "count"
            from filtered
            where ${filterPredicate}
          `),
        ]);

        return {
          rows: normalizeSqlResultRows<MailchimpRecipientRowDb>(
            rowsResult as {
              readonly rows?: readonly MailchimpRecipientRowDb[];
            },
          ).map(mapMailchimpRecipientRow),
          total: Number(
            normalizeSqlResultRows<{ readonly count: number | string }>(
              countResult as {
                readonly rows?: readonly { readonly count: number | string }[];
              },
            )[0]?.count ?? 0,
          ),
        };
      },

      async upsert(record) {
        const sourceEvidenceIdColumn =
          mailchimpCampaignActivityDetailsTable.sourceEvidenceId;
        const values = mapMailchimpCampaignActivityDetailToInsertLocal(
          record as MailchimpCampaignActivityDetailRecord,
        );
        const [row] = (await db
          .insert(mailchimpCampaignActivityDetails)
          .values(values)
          .onConflictDoUpdate({
            target: sourceEvidenceIdColumn,
            set: {
              providerRecordId: values.providerRecordId,
              activityType: values.activityType,
              campaignId: values.campaignId,
              audienceId: values.audienceId,
              memberId: values.memberId,
              campaignName: values.campaignName,
              snippet: values.snippet,
              updatedAt: new Date(),
            },
          })
          .returning()) as MailchimpCampaignActivityDetailRow[];

        return mapMailchimpCampaignActivityDetailRowLocal(
          requireRow(
            row,
            "Expected Mailchimp campaign activity detail row to be returned.",
          ),
        );
      },
    },

    manualNoteDetails: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const sourceEvidenceIdColumn = manualNoteDetailsTable.sourceEvidenceId;
        const rows = (await db
          .select()
          .from(manualNoteDetails)
          .where(inArray(sourceEvidenceIdColumn, [...sourceEvidenceIds]))
          .orderBy(asc(sourceEvidenceIdColumn))) as ManualNoteDetailRow[];

        return rows.map(mapManualNoteDetailRowLocal);
      },

      async findLatestForContact(contactId) {
        const [row] = await db
          .select({
            body: manualNoteDetails.body,
            authorDisplayName: manualNoteDetails.authorDisplayName,
            authorId: manualNoteDetails.authorId,
            createdAt: manualNoteDetails.createdAt,
          })
          .from(manualNoteDetails)
          .innerJoin(
            canonicalEventLedger,
            eq(
              canonicalEventLedger.sourceEvidenceId,
              manualNoteDetails.sourceEvidenceId,
            ),
          )
          .where(eq(canonicalEventLedger.contactId, contactId))
          .orderBy(
            desc(manualNoteDetails.createdAt),
            desc(canonicalEventLedger.occurredAt),
            desc(manualNoteDetails.sourceEvidenceId),
          )
          .limit(1);

        return row === undefined
          ? null
          : {
              body: row.body,
              authorDisplayName: row.authorDisplayName,
              authorId: row.authorId,
              createdAt: row.createdAt.toISOString(),
            };
      },

      async upsert(record) {
        const sourceEvidenceIdColumn = manualNoteDetailsTable.sourceEvidenceId;
        const values = mapManualNoteDetailToInsertLocal(
          record as ManualNoteDetailRecord,
        );
        const [row] = (await db
          .insert(manualNoteDetails)
          .values(values)
          .onConflictDoUpdate({
            target: sourceEvidenceIdColumn,
            set: {
              providerRecordId: values.providerRecordId,
              body: values.body,
              authorDisplayName: values.authorDisplayName,
              authorId: values.authorId,
              updatedAt: new Date(),
            },
          })
          .returning()) as ManualNoteDetailRow[];

        return mapManualNoteDetailRowLocal(
          requireRow(row, "Expected manual note detail row to be returned."),
        );
      },

      async updateBody(input) {
        const [row] = (await db
          .update(manualNoteDetails)
          .set({
            body: input.body,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(manualNoteDetails.sourceEvidenceId, input.sourceEvidenceId),
              eq(manualNoteDetails.authorId, input.authorId),
            ),
          )
          .returning()) as ManualNoteDetailRow[];

        return row === undefined ? null : mapManualNoteDetailRowLocal(row);
      },

      async deleteByAuthor(input) {
        return db.transaction(async (tx: Stage1Database) => {
          const [matchingNote] = await tx
            .select({
              sourceEvidenceId: manualNoteDetails.sourceEvidenceId,
            })
            .from(manualNoteDetails)
            .where(
              and(
                eq(manualNoteDetails.sourceEvidenceId, input.sourceEvidenceId),
                eq(manualNoteDetails.authorId, input.authorId),
              ),
            )
            .limit(1);

          if (matchingNote === undefined) {
            return 0;
          }

          await tx
            .delete(canonicalEventLedger)
            .where(
              eq(canonicalEventLedger.sourceEvidenceId, input.sourceEvidenceId),
            );

          const deletedRows = await tx
            .delete(sourceEvidenceLog)
            .where(eq(sourceEvidenceLog.id, input.sourceEvidenceId))
            .returning({
              id: sourceEvidenceLog.id,
            });

          return deletedRows.length;
        });
      },
    },

    internalNotes: {
      async create(input) {
        const createdAt = input.createdAt ?? new Date();
        const updatedAt = input.updatedAt ?? createdAt;
        await db
          .insert(internalNotes)
          .values({
            id: input.id,
            contactId: input.contactId,
            body: input.body,
            authorId: input.authorId,
            createdAt,
            updatedAt,
          })
          .returning({
            id: internalNotes.id,
          });

        const [row] = await db
          .select({
            internal_notes: internalNotes,
            users: {
              name: users.name,
            },
          })
          .from(internalNotes)
          .leftJoin(users, eq(internalNotes.authorId, users.id))
          .where(eq(internalNotes.id, input.id))
          .limit(1);

        return mapInternalNoteWithAuthorRow(
          requireRow(
            row,
            `Expected internal_notes row ${input.id} to be returned.`,
          ),
        );
      },

      async findById(id) {
        const [row] = await db
          .select({
            internal_notes: internalNotes,
            users: {
              name: users.name,
            },
          })
          .from(internalNotes)
          .leftJoin(users, eq(internalNotes.authorId, users.id))
          .where(eq(internalNotes.id, id))
          .limit(1);

        return row === undefined
          ? undefined
          : mapInternalNoteWithAuthorRow(row);
      },

      async findByContactId(contactId, limit) {
        if (limit === undefined) {
          const rows = await db
            .select({
              internal_notes: internalNotes,
              users: {
                name: users.name,
              },
            })
            .from(internalNotes)
            .leftJoin(users, eq(internalNotes.authorId, users.id))
            .where(eq(internalNotes.contactId, contactId))
            .orderBy(desc(internalNotes.createdAt), desc(internalNotes.id));

          return rows.map(mapInternalNoteWithAuthorRow);
        }

        const rows = await db
          .select({
            internal_notes: internalNotes,
            users: {
              name: users.name,
            },
          })
          .from(internalNotes)
          .leftJoin(users, eq(internalNotes.authorId, users.id))
          .where(eq(internalNotes.contactId, contactId))
          .orderBy(desc(internalNotes.createdAt), desc(internalNotes.id))
          .limit(limit);

        return rows.map(mapInternalNoteWithAuthorRow);
      },

      async update(input) {
        await db
          .update(internalNotes)
          .set({
            body: input.body,
            updatedAt: input.updatedAt ?? new Date(),
          })
          .where(eq(internalNotes.id, input.id))
          .returning({
            id: internalNotes.id,
          });

        const [row] = await db
          .select({
            internal_notes: internalNotes,
            users: {
              name: users.name,
            },
          })
          .from(internalNotes)
          .leftJoin(users, eq(internalNotes.authorId, users.id))
          .where(eq(internalNotes.id, input.id))
          .limit(1);

        return mapInternalNoteWithAuthorRow(
          requireRow(row, `Expected internal_notes row ${input.id} to update.`),
        );
      },

      async delete(id) {
        await db.delete(internalNotes).where(eq(internalNotes.id, id));
      },
    },

    pendingOutbounds: {
      async insert(input) {
        const now = new Date();
        const values = mapPendingComposerOutboundToInsert({
          id: input.id,
          fingerprint: input.fingerprint,
          status: "pending",
          actorId: input.actorId,
          canonicalContactId: input.canonicalContactId,
          projectId: input.projectId,
          fromAlias: input.fromAlias,
          toEmailNormalized: input.toEmailNormalized,
          subject: input.subject,
          bodyPlaintext: input.bodyPlaintext,
          bodyHtml: input.bodyHtml ?? null,
          bodySha256: input.bodySha256,
          attachmentMetadata: input.attachmentMetadata,
          gmailThreadId: input.gmailThreadId,
          inReplyToRfc822: input.inReplyToRfc822,
          attemptedAt: input.attemptedAt,
          reconciledEventId: null,
          reconciledAt: null,
          failedReason: null,
          sentRfc822MessageId: null,
          failedDetail: null,
          orphanedAt: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        } satisfies PendingComposerOutboundRecord);
        const [row] = await db
          .insert(pendingComposerOutbounds)
          .values(values)
          .returning({ id: pendingComposerOutboundsTable.id });

        return requireRow(
          row,
          "Expected pending composer outbound id to be returned.",
        ).id;
      },

      async findByFingerprint(fingerprint) {
        const [row] = (await db
          .select()
          .from(pendingComposerOutbounds)
          .where(eq(pendingComposerOutbounds.fingerprint, fingerprint))
          .orderBy(
            sql`case when ${pendingComposerOutbounds.status} = 'pending' then 0 else 1 end`,
            desc(pendingComposerOutbounds.attemptedAt),
            desc(pendingComposerOutbounds.createdAt),
          )
          .limit(1)) as PendingComposerOutboundRow[];

        return row === undefined ? null : mapPendingComposerOutboundRow(row);
      },

      async markSentRfc822(id, sentRfc822MessageId) {
        await db
          .update(pendingComposerOutbounds)
          .set({ sentRfc822MessageId, updatedAt: new Date() })
          .where(eq(pendingComposerOutbounds.id, id));
      },

      async findBySentRfc822MessageId(messageId) {
        const [row] = (await db
          .select()
          .from(pendingComposerOutbounds)
          .where(eq(pendingComposerOutbounds.sentRfc822MessageId, messageId))
          .orderBy(desc(pendingComposerOutbounds.attemptedAt))
          .limit(1)) as PendingComposerOutboundRow[];
        return row === undefined ? null : mapPendingComposerOutboundRow(row);
      },

      async listUnreconciledWithRfc822() {
        const rows = (await db
          .select()
          .from(pendingComposerOutbounds)
          .where(
            and(
              isNotNull(pendingComposerOutbounds.sentRfc822MessageId),
              isNull(pendingComposerOutbounds.reconciledEventId),
              inArray(pendingComposerOutbounds.status, [
                "pending",
                "confirmed",
                "orphaned",
              ]),
            ),
          )
          .orderBy(
            desc(pendingComposerOutbounds.attemptedAt),
            desc(pendingComposerOutbounds.createdAt),
          )) as PendingComposerOutboundRow[];

        return rows.map(mapPendingComposerOutboundRow);
      },

      async markConfirmed(id, input) {
        await db
          .update(pendingComposerOutbounds)
          .set({
            status: "confirmed",
            reconciledEventId: input.reconciledEventId,
            reconciledAt: new Date(),
            failedReason: null,
            failedDetail: null,
            orphanedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pendingComposerOutbounds.id, id),
              or(
                eq(pendingComposerOutbounds.status, "pending"),
                eq(pendingComposerOutbounds.status, "orphaned"),
                and(
                  eq(pendingComposerOutbounds.status, "confirmed"),
                  isNull(pendingComposerOutbounds.reconciledEventId),
                ),
              ),
            ),
          );
      },

      async markFailed(id, input) {
        await db
          .update(pendingComposerOutbounds)
          .set({
            status: "failed",
            failedReason: input.reason,
            failedDetail: input.detail ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pendingComposerOutbounds.id, id),
              eq(pendingComposerOutbounds.status, "pending"),
            ),
          );
      },

      async markSuperseded(id) {
        await db
          .update(pendingComposerOutbounds)
          .set({
            status: "superseded",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pendingComposerOutbounds.id, id),
              inArray(pendingComposerOutbounds.status, [
                "pending",
                "failed",
                "orphaned",
              ]),
            ),
          );
      },

      async sweepOrphans(input) {
        const rows = await db
          .update(pendingComposerOutbounds)
          .set({
            status: "orphaned",
            orphanedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pendingComposerOutbounds.status, "pending"),
              lt(pendingComposerOutbounds.attemptedAt, input.olderThan),
            ),
          )
          .returning({ id: pendingComposerOutbounds.id });

        return rows.length;
      },

      async findForContact(contactId, input) {
        // Includes "confirmed" because PR #143 (immediate-confirm on Gmail send)
        // transitions rows to confirmed immediately, and the UI still needs to
        // surface them as recent outbound activity. "superseded" is excluded by
        // design (replaced rows are not user-visible).
        const rows = (await db
          .select()
          .from(pendingComposerOutbounds)
          .where(
            and(
              eq(pendingComposerOutbounds.canonicalContactId, contactId),
              inArray(pendingComposerOutbounds.status, [
                "pending",
                "confirmed",
                "failed",
                "orphaned",
              ]),
            ),
          )
          .orderBy(
            desc(pendingComposerOutbounds.attemptedAt),
            desc(pendingComposerOutbounds.createdAt),
          )
          .limit(input.limit)) as PendingComposerOutboundRow[];

        return rows.map(mapPendingComposerOutboundRow);
      },
    },

    integrationBackfillJobs: {
      async insert(input) {
        const now = new Date();
        const [row] = await db
          .insert(integrationBackfillJobs)
          .values(
            mapIntegrationBackfillJobToInsert({
              id: input.id,
              service: input.service,
              idempotencyKey: input.idempotencyKey,
              triggeredBy: input.triggeredBy,
              windowStart: input.windowStart,
              windowEnd: input.windowEnd,
              mailbox: input.mailbox,
              status: "pending",
              enqueuedAt: now.toISOString(),
              startedAt: null,
              completedAt: null,
              resultJson: null,
              failureReason: null,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            }),
          )
          .onConflictDoNothing({
            target: integrationBackfillJobsTable.idempotencyKey,
          })
          .returning({ id: integrationBackfillJobsTable.id });

        return row?.id ?? null;
      },

      async countAll() {
        const [row] = await db
          .select({ total: count() })
          .from(integrationBackfillJobs);

        return row?.total ?? 0;
      },

      async findById(id) {
        const [row] = await db
          .select()
          .from(integrationBackfillJobs)
          .where(eq(integrationBackfillJobs.id, id))
          .limit(1);

        return row === undefined ? null : mapIntegrationBackfillJobRow(row);
      },

      async findByIdempotencyKey(idempotencyKey) {
        const [row] = await db
          .select()
          .from(integrationBackfillJobs)
          .where(eq(integrationBackfillJobs.idempotencyKey, idempotencyKey))
          .limit(1);

        return row === undefined ? null : mapIntegrationBackfillJobRow(row);
      },

      async markRunning(input) {
        const [row] = await db
          .update(integrationBackfillJobs)
          .set({
            status: "running",
            startedAt: new Date(input.startedAt),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationBackfillJobs.id, input.id),
              eq(integrationBackfillJobs.status, "pending"),
            ),
          )
          .returning();

        return row === undefined ? null : mapIntegrationBackfillJobRow(row);
      },

      async markCompleted(input) {
        const [row] = await db
          .update(integrationBackfillJobs)
          .set({
            status: "completed",
            completedAt: new Date(input.completedAt),
            resultJson: input.resultJson,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(eq(integrationBackfillJobs.id, input.id))
          .returning();

        return row === undefined ? null : mapIntegrationBackfillJobRow(row);
      },

      async markFailed(input) {
        const [row] = await db
          .update(integrationBackfillJobs)
          .set({
            status: "failed",
            completedAt: new Date(input.completedAt),
            failureReason: input.failureReason,
            updatedAt: new Date(),
          })
          .where(eq(integrationBackfillJobs.id, input.id))
          .returning();

        return row === undefined ? null : mapIntegrationBackfillJobRow(row);
      },
    },

    identityResolutionQueue: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(identityResolutionQueue)
          .where(eq(identityResolutionQueue.id, id))
          .limit(1);

        return row === undefined ? null : mapIdentityResolutionRow(row);
      },

      async listOpenByReasonCode(reasonCode) {
        const rows = await db
          .select()
          .from(identityResolutionQueue)
          .where(
            and(
              eq(identityResolutionQueue.reasonCode, reasonCode),
              eq(identityResolutionQueue.status, "open"),
            ),
          )
          .orderBy(
            sql`${identityResolutionQueue.lastAttemptedAt} nulls first`,
            asc(identityResolutionQueue.openedAt),
            asc(identityResolutionQueue.id),
          );

        return rows.map(mapIdentityResolutionRow);
      },

      async listOpenByContactId(contactId) {
        const rows = await db
          .select()
          .from(identityResolutionQueue)
          .where(
            and(
              eq(identityResolutionQueue.status, "open"),
              or(
                eq(identityResolutionQueue.anchoredContactId, contactId),
                sql`${contactId} = any(${identityResolutionQueue.candidateContactIds})`,
              ),
            ),
          )
          .orderBy(
            desc(identityResolutionQueue.openedAt),
            asc(identityResolutionQueue.id),
          );

        return rows.map(mapIdentityResolutionRow);
      },

      async upsert(record) {
        const values = mapIdentityResolutionToInsert(record);
        const [row] = await db
          .insert(identityResolutionQueue)
          .values(values)
          .onConflictDoUpdate({
            target: identityResolutionQueue.id,
            set: {
              sourceEvidenceId: values.sourceEvidenceId,
              candidateContactIds: values.candidateContactIds,
              reasonCode: values.reasonCode,
              status: values.status,
              openedAt: values.openedAt,
              resolvedAt: values.resolvedAt,
              lastAttemptedAt: values.lastAttemptedAt,
              normalizedIdentityValues: values.normalizedIdentityValues,
              anchoredContactId: values.anchoredContactId,
              explanation: values.explanation,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapIdentityResolutionRow(
          requireRow(row, "Expected identity resolution row to be returned."),
        );
      },
    },

    routingReviewQueue: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(routingReviewQueue)
          .where(eq(routingReviewQueue.id, id))
          .limit(1);

        return row === undefined ? null : mapRoutingReviewRow(row);
      },

      async listOpenByReasonCode(reasonCode) {
        const rows = await db
          .select()
          .from(routingReviewQueue)
          .where(
            and(
              eq(routingReviewQueue.reasonCode, reasonCode),
              eq(routingReviewQueue.status, "open"),
            ),
          )
          .orderBy(asc(routingReviewQueue.openedAt));

        return rows.map(mapRoutingReviewRow);
      },

      async listOpenByContactId(contactId) {
        const rows = await db
          .select()
          .from(routingReviewQueue)
          .where(
            and(
              eq(routingReviewQueue.contactId, contactId),
              eq(routingReviewQueue.status, "open"),
            ),
          )
          .orderBy(
            desc(routingReviewQueue.openedAt),
            asc(routingReviewQueue.id),
          );

        return rows.map(mapRoutingReviewRow);
      },

      async upsert(record) {
        const values = mapRoutingReviewToInsert(record);
        const [row] = await db
          .insert(routingReviewQueue)
          .values(values)
          .onConflictDoUpdate({
            target: routingReviewQueue.id,
            set: {
              contactId: values.contactId,
              sourceEvidenceId: values.sourceEvidenceId,
              reasonCode: values.reasonCode,
              status: values.status,
              openedAt: values.openedAt,
              resolvedAt: values.resolvedAt,
              candidateMembershipIds: values.candidateMembershipIds,
              explanation: values.explanation,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapRoutingReviewRow(
          requireRow(row, "Expected routing review row to be returned."),
        );
      },
    },

    inboxProjection: {
      async countAll() {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(contactInboxProjection);

        return row?.value ?? 0;
      },

      async countInvalidRecencyRows() {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(contactInboxProjection)
          .where(
            sql`${contactInboxProjection.lastActivityAt} is distinct from greatest(
              coalesce(${contactInboxProjection.lastInboundAt}, '-infinity'::timestamptz),
              coalesce(${contactInboxProjection.lastOutboundAt}, '-infinity'::timestamptz)
            )`,
          );

        return row?.value ?? 0;
      },

      async findByContactId(contactId) {
        const [row] = await db
          .select()
          .from(contactInboxProjection)
          .where(eq(contactInboxProjection.contactId, contactId))
          .limit(1);

        return row === undefined ? null : mapInboxProjectionRow(row);
      },

      async listInvalidRecencyContactIds() {
        const rows = await db
          .select({
            contactId: contactInboxProjection.contactId,
          })
          .from(contactInboxProjection)
          .where(
            sql`${contactInboxProjection.lastActivityAt} is distinct from greatest(
              coalesce(${contactInboxProjection.lastInboundAt}, '-infinity'::timestamptz),
              coalesce(${contactInboxProjection.lastOutboundAt}, '-infinity'::timestamptz)
            )`,
          )
          .orderBy(asc(contactInboxProjection.contactId));

        return rows.map((row) => row.contactId);
      },

      async listAllOrderedByRecency() {
        const rows = await db
          .select()
          .from(contactInboxProjection)
          .orderBy(...buildInboxRecencyOrderBy("last-inbound"));

        return rows.map(mapInboxProjectionRow);
      },

      async listPageOrderedByRecency(input) {
        const whereClause = combinePredicates(
          buildInboxFilterPredicate(input.filter),
          buildInboxProjectPredicate(input.projectId),
          buildInboxCursorPredicate({
            cursor: input.cursor,
            order: input.order,
          }),
        );
        const baseQuery = db.select().from(contactInboxProjection);
        const filteredQuery =
          whereClause === undefined ? baseQuery : baseQuery.where(whereClause);
        const rows = await filteredQuery
          .orderBy(...buildInboxRecencyOrderBy(input.order))
          .limit(input.limit);

        return rows.map(mapInboxProjectionRow);
      },

      async searchPageOrderedByRecency(input) {
        const whereClause = combinePredicates(
          buildInboxFilterPredicate(input.filter),
          buildInboxProjectPredicate(input.projectId),
          buildInboxCursorPredicate({
            cursor: input.cursor,
            order: input.order,
          }),
          buildInboxSearchPredicate(input.query),
        );
        const filteredQuery = db
          .select()
          .from(contactInboxProjection)
          .where(whereClause);
        const [rows, totalRow] = await Promise.all([
          filteredQuery
            .orderBy(...buildInboxRecencyOrderBy(input.order))
            .limit(input.limit),
          db
            .select({
              value: count(),
            })
            .from(contactInboxProjection)
            .where(
              combinePredicates(
                buildInboxFilterPredicate(input.filter),
                buildInboxProjectPredicate(input.projectId),
                buildInboxSearchPredicate(input.query),
              ),
            )
            .then((result) => result[0]),
        ]);

        return {
          rows: rows.map(mapInboxProjectionRow),
          total: totalRow?.value ?? 0,
        };
      },

      async countByFilters(input) {
        const projectPredicate = buildInboxProjectPredicate(input?.projectId);
        const baseQuery = db
          .select({
            all: sql<number>`coalesce(sum(case when ${contactInboxProjection.archivedAt} is null then 1 else 0 end), 0)`,
            unread: sql<number>`coalesce(sum(case when ${contactInboxProjection.bucket} = 'New' and ${contactInboxProjection.archivedAt} is null then 1 else 0 end), 0)`,
            followUp: sql<number>`coalesce(sum(case when ${contactInboxProjection.isStarred} and ${contactInboxProjection.archivedAt} is null then 1 else 0 end), 0)`,
            unresolved: sql<number>`coalesce(sum(case when ${contactInboxProjection.hasUnresolved} and ${contactInboxProjection.archivedAt} is null then 1 else 0 end), 0)`,
            sent: sql<number>`coalesce(sum(case when ${contactInboxProjection.lastOutboundAt} is not null and ${contactInboxProjection.archivedAt} is null then 1 else 0 end), 0)`,
            archived: sql<number>`coalesce(sum(case when ${contactInboxProjection.archivedAt} is not null then 1 else 0 end), 0)`,
          })
          .from(contactInboxProjection);
        const [row] = await (projectPredicate === undefined
          ? baseQuery
          : baseQuery.where(projectPredicate));

        return {
          all: row?.all ?? 0,
          unread: row?.unread ?? 0,
          followUp: row?.followUp ?? 0,
          unresolved: row?.unresolved ?? 0,
          sent: row?.sent ?? 0,
          archived: row?.archived ?? 0,
        };
      },

      async getFreshness() {
        const [row] = await db
          .select({
            total: count(),
            latestUpdatedAt: sql<Date | null>`max(${contactInboxProjection.updatedAt})`,
          })
          .from(contactInboxProjection);

        return {
          total: row?.total ?? 0,
          latestUpdatedAt:
            row?.latestUpdatedAt instanceof Date
              ? row.latestUpdatedAt.toISOString()
              : null,
        };
      },

      async getFreshnessByContactId(contactId) {
        const [row] = await db
          .select({
            updatedAt: contactInboxProjection.updatedAt,
          })
          .from(contactInboxProjection)
          .where(eq(contactInboxProjection.contactId, contactId))
          .limit(1);

        if (row === undefined) {
          return null;
        }

        return {
          contactId,
          updatedAt:
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
        };
      },

      async deleteByContactId(contactId) {
        await db
          .delete(contactInboxProjection)
          .where(eq(contactInboxProjection.contactId, contactId));
      },

      async setNeedsFollowUp(input) {
        const [row] = await db
          .update(contactInboxProjection)
          .set({
            isStarred: input.needsFollowUp,
            updatedAt: new Date(),
          })
          .where(eq(contactInboxProjection.contactId, input.contactId))
          .returning();

        return row === undefined ? null : mapInboxProjectionRow(row);
      },

      async setArchived(input) {
        const [row] = await db
          .update(contactInboxProjection)
          .set({
            archivedAt: input.archived ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(contactInboxProjection.contactId, input.contactId))
          .returning();

        return row === undefined ? null : mapInboxProjectionRow(row);
      },

      async setBucket(input) {
        const [row] = await db
          .update(contactInboxProjection)
          .set({
            bucket: input.bucket,
            updatedAt: new Date(),
          })
          .where(eq(contactInboxProjection.contactId, input.contactId))
          .returning();

        return row === undefined ? null : mapInboxProjectionRow(row);
      },

      async upsert(record) {
        const values = mapInboxProjectionToInsert(record);
        const [row] = await db
          .insert(contactInboxProjection)
          .values(values)
          .onConflictDoUpdate({
            target: contactInboxProjection.contactId,
            // archivedAt is intentionally omitted from the set clause:
            // ordinary event-driven projection rebuilds shouldn't clobber
            // the archived state; archive / unarchive happens through a
            // separate setArchived path. INSERT path persists archivedAt
            // via mapInboxProjectionToInsert.
            set: {
              bucket: values.bucket,
              isStarred: values.isStarred,
              hasUnresolved: values.hasUnresolved,
              lastInboundAt: values.lastInboundAt,
              lastOutboundAt: values.lastOutboundAt,
              lastActivityAt: values.lastActivityAt,
              snippet: values.snippet,
              lastCanonicalEventId: values.lastCanonicalEventId,
              lastEventType: values.lastEventType,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapInboxProjectionRow(
          requireRow(row, "Expected inbox projection row to be returned."),
        );
      },
    },

    timelineProjection: {
      async countAll() {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(contactTimelineProjection);

        return row?.value ?? 0;
      },

      async findByCanonicalEventId(canonicalEventId) {
        const [row] = await db
          .select()
          .from(contactTimelineProjection)
          .where(
            eq(contactTimelineProjection.canonicalEventId, canonicalEventId),
          )
          .limit(1);

        return row === undefined ? null : mapTimelineProjectionRow(row);
      },

      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(contactTimelineProjection)
          .leftJoin(
            canonicalEventAudience,
            and(
              eq(
                canonicalEventAudience.canonicalEventId,
                contactTimelineProjection.canonicalEventId,
              ),
              eq(canonicalEventAudience.contactId, contactId),
            ),
          )
          .where(
            or(
              eq(contactTimelineProjection.contactId, contactId),
              eq(canonicalEventAudience.contactId, contactId),
            ),
          )
          .orderBy(asc(contactTimelineProjection.sortKey));

        return rows.map((row) =>
          mapTimelineProjectionRow(row.contact_timeline_projection),
        );
      },

      async listRecentByContactId(input) {
        const predicate =
          input.beforeSortKey === null
            ? eq(contactTimelineProjection.contactId, input.contactId)
            : and(
                eq(contactTimelineProjection.contactId, input.contactId),
                lt(contactTimelineProjection.sortKey, input.beforeSortKey),
              );
        const rows = await db
          .select()
          .from(contactTimelineProjection)
          .where(predicate)
          .orderBy(desc(contactTimelineProjection.sortKey))
          .limit(input.limit);

        return rows.map(mapTimelineProjectionRow);
      },

      async countByContactId(contactId) {
        const [row] = await db
          .select({
            value: count(),
          })
          .from(contactTimelineProjection)
          .where(eq(contactTimelineProjection.contactId, contactId));

        return row?.value ?? 0;
      },

      async getFreshnessByContactId(contactId) {
        const [row] = await db
          .select({
            total: count(),
            latestUpdatedAt: sql<Date | null>`max(${contactTimelineProjection.updatedAt})`,
            latestSortKey: sql<
              string | null
            >`max(${contactTimelineProjection.sortKey})`,
          })
          .from(contactTimelineProjection)
          .where(eq(contactTimelineProjection.contactId, contactId));

        return {
          contactId,
          total: row?.total ?? 0,
          latestUpdatedAt:
            row?.latestUpdatedAt instanceof Date
              ? row.latestUpdatedAt.toISOString()
              : null,
          latestSortKey: row?.latestSortKey ?? null,
        };
      },

      async upsert(record) {
        const values = mapTimelineProjectionToInsert(record);
        const [row] = await db
          .insert(contactTimelineProjection)
          .values(values)
          .onConflictDoUpdate({
            target: contactTimelineProjection.canonicalEventId,
            set: {
              contactId: values.contactId,
              occurredAt: values.occurredAt,
              sortKey: values.sortKey,
              eventType: values.eventType,
              summary: values.summary,
              channel: values.channel,
              primaryProvider: values.primaryProvider,
              reviewState: values.reviewState,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapTimelineProjectionRow(
          requireRow(row, "Expected timeline projection row to be returned."),
        );
      },
    },

    canonicalEventAudience: {
      async upsert(record) {
        const values = mapCanonicalEventAudienceToInsert(record);
        const [row] = await db
          .insert(canonicalEventAudience)
          .values(values)
          .onConflictDoUpdate({
            target: [
              canonicalEventAudience.canonicalEventId,
              canonicalEventAudience.contactId,
            ],
            set: {
              participantRole: values.participantRole,
              normalizedEmail: values.normalizedEmail,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapCanonicalEventAudienceRow(
          requireRow(
            row,
            "Expected canonical event audience row to be returned.",
          ),
        );
      },
    },

    syncState: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(syncState)
          .where(eq(syncState.id, id))
          .limit(1);

        return row === undefined ? null : mapSyncStateRow(row);
      },

      async findLatest(input) {
        const providerPredicate =
          input.provider === null
            ? isNull(syncState.provider)
            : eq(syncState.provider, input.provider);
        const [row] = await db
          .select()
          .from(syncState)
          .where(
            and(
              eq(syncState.scope, input.scope),
              providerPredicate,
              eq(syncState.jobType, input.jobType),
            ),
          )
          .orderBy(desc(syncState.updatedAt), desc(syncState.createdAt))
          .limit(1);

        return row === undefined ? null : mapSyncStateRow(row);
      },

      async listAll() {
        const rows = await db
          .select()
          .from(syncState)
          .orderBy(asc(syncState.provider), asc(syncState.jobType));

        return rows.map(mapSyncStateRow);
      },

      async upsert(record) {
        const values = mapSyncStateToInsert(record);
        const [row] = await db
          .insert(syncState)
          .values(values)
          .onConflictDoUpdate({
            target: syncState.id,
            set: {
              scope: values.scope,
              provider: values.provider,
              jobType: values.jobType,
              cursor: values.cursor,
              windowStart: values.windowStart,
              windowEnd: values.windowEnd,
              status: values.status,
              parityPercent: values.parityPercent,
              freshnessP95Seconds: values.freshnessP95Seconds,
              freshnessP99Seconds: values.freshnessP99Seconds,
              lastSuccessfulAt: values.lastSuccessfulAt,
              consecutiveFailureCount: values.consecutiveFailureCount,
              leaseOwner: values.leaseOwner,
              heartbeatAt: values.heartbeatAt,
              deadLetterCount: values.deadLetterCount,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapSyncStateRow(
          requireRow(row, "Expected sync state row to be returned."),
        );
      },
    },

    auditEvidence: {
      async append(record) {
        const values = mapAuditEvidenceToInsert(record);
        const [row] = await db
          .insert(auditPolicyEvidence)
          .values(values)
          .returning();

        return mapAuditEvidenceRow(
          requireRow(row, "Expected audit evidence row to be returned."),
        );
      },

      async listByEntity(input) {
        const rows = await db
          .select()
          .from(auditPolicyEvidence)
          .where(
            and(
              eq(auditPolicyEvidence.entityType, input.entityType),
              eq(auditPolicyEvidence.entityId, input.entityId),
            ),
          )
          .orderBy(
            asc(auditPolicyEvidence.occurredAt),
            asc(auditPolicyEvidence.createdAt),
          );

        return rows.map(mapAuditEvidenceRow);
      },

      async listByEntities(input) {
        if (input.entityIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(auditPolicyEvidence)
          .where(
            and(
              eq(auditPolicyEvidence.entityType, input.entityType),
              inArray(auditPolicyEvidence.entityId, [...input.entityIds]),
            ),
          )
          .orderBy(
            asc(auditPolicyEvidence.entityId),
            asc(auditPolicyEvidence.occurredAt),
            asc(auditPolicyEvidence.createdAt),
          );

        return rows.map(mapAuditEvidenceRow);
      },
    },
  });
}

export function createStage1RepositoryBundle(
  db: Stage1Database,
): Stage1RepositoryBundle {
  return createStage1RepositoriesInternal(db);
}

export function createStage1RepositoryBundleFromConnection(
  connection: Pick<DatabaseConnection, "db">,
): Stage1RepositoryBundle {
  return createStage1RepositoriesInternal(connection.db);
}

function createStage2RepositoriesInternal(
  db: Stage1Database,
): Stage2RepositoryBundle {
  const smsRepositories = createSmsRepositorySlices(db);

  async function loadSettingsProjects(projectIds?: readonly string[]) {
    const normalizedProjectIds =
      projectIds === undefined
        ? null
        : [
            ...new Set(
              projectIds.filter((projectId) => projectId.trim().length > 0),
            ),
          ];

    if (normalizedProjectIds !== null && normalizedProjectIds.length === 0) {
      return [];
    }

    const projectRows =
      normalizedProjectIds === null
        ? await db
            .select()
            .from(projectDimensions)
            .orderBy(asc(projectDimensions.projectId))
        : await db
            .select()
            .from(projectDimensions)
            .where(inArray(projectDimensions.projectId, normalizedProjectIds))
            .orderBy(asc(projectDimensions.projectId));

    if (projectRows.length === 0) {
      return [];
    }

    const validProjectRows = projectRows.filter(
      (row) =>
        typeof row.projectId === "string" && row.projectId.trim().length > 0,
    );
    const resolvedProjectIds = [
      ...new Set(validProjectRows.map((row) => row.projectId)),
    ];

    if (resolvedProjectIds.length === 0) {
      return [];
    }

    const aliasRows = await db
      .select()
      .from(projectAliases)
      .where(inArray(projectAliases.projectId, resolvedProjectIds))
      .orderBy(
        asc(projectAliases.projectId),
        asc(projectAliases.createdAt),
        asc(projectAliases.alias),
      );
    const memberCountRows = await db
      .select({
        projectId: contactMemberships.projectId,
        memberCount: count(),
      })
      .from(contactMemberships)
      .where(inArray(contactMemberships.projectId, resolvedProjectIds))
      .groupBy(contactMemberships.projectId);
    const cachedKnowledgeRows = await db
      .select({
        projectId: aiKnowledgeEntries.scopeKey,
        cachedCount: count(),
      })
      .from(aiKnowledgeEntries)
      .where(
        and(
          eq(aiKnowledgeEntries.scope, "project"),
          eq(aiKnowledgeEntries.sourceProvider, "notion"),
          inArray(aiKnowledgeEntries.scopeKey, resolvedProjectIds),
          sql`length(btrim(${aiKnowledgeEntries.content})) > 0`,
        ),
      )
      .groupBy(aiKnowledgeEntries.scopeKey);

    const emailsByProjectId = new Map<
      string,
      {
        readonly id: string;
        readonly address: string;
        readonly createdAt: Date;
        readonly signature: string;
      }[]
    >();
    for (const aliasRow of aliasRows) {
      if (aliasRow.projectId === null) {
        continue;
      }

      const projectEmails = emailsByProjectId.get(aliasRow.projectId) ?? [];
      projectEmails.push({
        id: aliasRow.id,
        address: aliasRow.alias,
        createdAt: aliasRow.createdAt,
        signature: aliasRow.signature,
      });
      emailsByProjectId.set(aliasRow.projectId, projectEmails);
    }

    const memberCountByProjectId = new Map(
      memberCountRows.flatMap((row) =>
        row.projectId === null
          ? []
          : [[row.projectId, row.memberCount] as const],
      ),
    );
    const hasCachedAiKnowledgeByProjectId = new Map(
      cachedKnowledgeRows.flatMap((row) =>
        row.projectId === null
          ? []
          : [[row.projectId, row.cachedCount > 0] as const],
      ),
    );

    return validProjectRows.map((row) => {
      const orderedEmails = (emailsByProjectId.get(row.projectId) ?? [])
        .slice()
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.address.localeCompare(right.address),
        )
        .map((email, index) => ({
          id: email.id,
          address: email.address,
          isPrimary: index === 0,
          signature: email.signature,
        }));

      return {
        projectId: row.projectId,
        salesforceProjectId: row.projectId,
        projectName: row.projectName,
        projectAlias: row.projectAlias,
        postmarkSenderStatus: row.postmarkSenderStatus,
        connectedToProjectId: row.connectedToProjectId,
        isActive: row.isActive,
        aiKnowledgeUrl: row.aiKnowledgeUrl,
        aiKnowledgeSyncedAt: row.aiKnowledgeSyncedAt,
        hasCachedAiKnowledge:
          hasCachedAiKnowledgeByProjectId.get(row.projectId) === true,
        createdAt: row.createdAt,
        emails: orderedEmails,
        memberCount: memberCountByProjectId.get(row.projectId) ?? 0,
        updatedAt: row.updatedAt,
      };
    });
  }

  return defineStage2RepositoryBundle({
    ...smsRepositories,

    integrationHealth: {
      async findById(id) {
        const [row] = await db
          .select()
          .from(integrationHealth)
          .where(eq(integrationHealth.id, id))
          .limit(1);

        return row === undefined ? null : mapIntegrationHealthRow(row);
      },

      async listAll() {
        const rows = await db
          .select()
          .from(integrationHealth)
          .orderBy(asc(integrationHealth.serviceName));

        return rows.map(mapIntegrationHealthRow);
      },

      async seedDefaults() {
        await db
          .insert(integrationHealth)
          .values(
            DEFAULT_INTEGRATION_HEALTH_SEED.map((row) => ({
              ...row,
              detail: null,
              metadataJson: {},
            })),
          )
          .onConflictDoNothing({
            target: integrationHealth.id,
          });
      },

      async upsert(record) {
        const values = mapIntegrationHealthToInsert(record);
        const [row] = await db
          .insert(integrationHealth)
          .values(values)
          .onConflictDoUpdate({
            target: integrationHealth.id,
            set: {
              serviceName: values.serviceName,
              category: values.category,
              status: values.status,
              lastCheckedAt: values.lastCheckedAt,
              degradedSinceAt: values.degradedSinceAt,
              lastAlertSentAt: values.lastAlertSentAt,
              detail: values.detail,
              metadataJson: values.metadataJson,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapIntegrationHealthRow(
          requireRow(
            row,
            "Expected integration health row to be returned from upsert.",
          ),
        );
      },
    },

    opsAlertState: {
      async getLastSentAt(category, dedupKey) {
        const [row] = await db
          .select({
            lastSentAt: opsAlertState.lastSentAt,
            lastStatus: opsAlertState.lastStatus,
          })
          .from(opsAlertState)
          .where(
            and(
              eq(opsAlertState.category, category),
              eq(opsAlertState.dedupKey, dedupKey),
            ),
          )
          .limit(1);

        if (row === undefined) {
          return null;
        }

        return {
          lastSentAt: row.lastSentAt.toISOString(),
          lastStatus: row.lastStatus,
        };
      },

      async recordSent(input) {
        const sentAt = new Date(input.sentAt);

        await db
          .insert(opsAlertState)
          .values({
            category: input.category,
            dedupKey: input.dedupKey,
            lastSentAt: sentAt,
            lastStatus: input.status,
          })
          .onConflictDoUpdate({
            target: [opsAlertState.category, opsAlertState.dedupKey],
            set: {
              lastSentAt: sentAt,
              lastStatus: input.status,
              updatedAt: new Date(),
            },
          });
      },
    },

    projects: {
      async findById(projectId: string) {
        const [row] = await loadSettingsProjects([projectId]);
        return row ?? null;
      },

      async listAll() {
        return loadSettingsProjects();
      },

      async setActive(projectId: string, isActive: boolean) {
        if (isActive) {
          // Defense-in-depth: action-layer callers already validate alias
          // before this point (apps/web/app/settings/actions.ts:711, :1290).
          // The DB CHECK constraint (migration 0045) is the ultimate
          // backstop. This pre-flight check turns the constraint violation
          // into a typed error any future caller can handle.
          const [aliasRow] = await db
            .select({ projectAlias: projectDimensions.projectAlias })
            .from(projectDimensions)
            .where(eq(projectDimensions.projectId, projectId))
            .limit(1);

          if (aliasRow !== undefined) {
            const trimmed = aliasRow.projectAlias?.trim() ?? "";
            if (trimmed.length === 0) {
              throw new ProjectAliasRequiredError(projectId);
            }
          }
        }

        const [row] = await db
          .update(projectDimensions)
          .set({
            isActive,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId))
          .returning({
            projectId: projectDimensions.projectId,
          });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async setAiKnowledgeUrl(
        projectId: string,
        aiKnowledgeUrl: string | null,
      ) {
        const [row] = await db.transaction(async (tx) => {
          await tx
            .delete(aiKnowledgeEntries)
            .where(
              and(
                eq(aiKnowledgeEntries.scope, "project"),
                eq(aiKnowledgeEntries.scopeKey, projectId),
                eq(aiKnowledgeEntries.sourceProvider, "notion"),
              ),
            );

          return tx
            .update(projectDimensions)
            .set({
              aiKnowledgeUrl,
              aiKnowledgeSyncedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(projectDimensions.projectId, projectId))
            .returning({
              projectId: projectDimensions.projectId,
            });
        });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async unlinkAiKnowledge(projectId: string) {
        const [row] = await db.transaction(async (tx) => {
          await tx
            .delete(aiKnowledgeEntries)
            .where(
              and(
                eq(aiKnowledgeEntries.scope, "project"),
                eq(aiKnowledgeEntries.scopeKey, projectId),
                eq(aiKnowledgeEntries.sourceProvider, "notion"),
              ),
            );

          return tx
            .update(projectDimensions)
            .set({
              aiKnowledgeUrl: null,
              aiKnowledgeSyncedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(projectDimensions.projectId, projectId))
            .returning({
              projectId: projectDimensions.projectId,
            });
        });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async setProjectAlias(projectId: string, projectAlias: string | null) {
        // Two-step update so we can capture the prior project_alias into
        // previous_aliases when it's being replaced with a different
        // non-null value. Preserves the bubble-side rule (D-049) across
        // alias renames: messages from a prior alias keep rendering on
        // the right side even after the admin sets a new alias.
        //
        // Append rules:
        //   - The current alias must be non-empty (we don't track null→X
        //     as history; only X→Y where X was previously set).
        //   - The new alias must differ from the current alias after
        //     normalization (lowercased trim). Identical-after-normalize
        //     edits don't pollute history.
        //   - Skip the append if the current alias is already in
        //     previous_aliases (dedupe at write time).
        const [row] = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({
              projectAlias: projectDimensions.projectAlias,
              previousAliases: projectDimensions.previousAliases,
            })
            .from(projectDimensions)
            .where(eq(projectDimensions.projectId, projectId))
            .limit(1);

          if (existing === undefined) {
            return [];
          }

          const priorAlias = existing.projectAlias?.trim() ?? "";
          const priorAliasNormalized = priorAlias.toLowerCase();
          const nextAliasNormalized = (projectAlias ?? "").trim().toLowerCase();
          const previousAliases = existing.previousAliases;
          const previousAliasesNormalized = new Set(
            previousAliases.map((alias) => alias.trim().toLowerCase()),
          );

          const shouldAppendHistory =
            priorAlias.length > 0 &&
            priorAliasNormalized !== nextAliasNormalized &&
            !previousAliasesNormalized.has(priorAliasNormalized);

          return tx
            .update(projectDimensions)
            .set({
              projectAlias,
              previousAliases: shouldAppendHistory
                ? [...previousAliases, priorAlias]
                : previousAliases,
              updatedAt: new Date(),
            })
            .where(eq(projectDimensions.projectId, projectId))
            .returning({
              projectId: projectDimensions.projectId,
            });
        });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async setPostmarkSenderStatus(projectId: string, status) {
        const [row] = await db
          .update(projectDimensions)
          .set({
            postmarkSenderStatus: status,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId))
          .returning({
            projectId: projectDimensions.projectId,
          });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async listConnectedProjects(hostProjectId: string) {
        const rows = await db
          .select({ projectId: projectDimensions.projectId })
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.connectedToProjectId, hostProjectId),
              eq(projectDimensions.isActive, true),
            ),
          )
          .orderBy(asc(projectDimensions.projectName));

        if (rows.length === 0) {
          return [];
        }

        const projects = await loadSettingsProjects(
          rows.map((row) => row.projectId),
        );

        // loadSettingsProjects orders by projectId; re-sort by name to honour
        // the contract.
        return [...projects].sort((left, right) =>
          left.projectName.localeCompare(right.projectName),
        );
      },

      async listAvailableConnectionCandidates() {
        const rows = await db
          .select({ projectId: projectDimensions.projectId })
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.isActive, false),
              isNull(projectDimensions.connectedToProjectId),
            ),
          )
          .orderBy(asc(projectDimensions.projectName));

        if (rows.length === 0) {
          return [];
        }

        const projects = await loadSettingsProjects(
          rows.map((row) => row.projectId),
        );

        return [...projects].sort((left, right) =>
          left.projectName.localeCompare(right.projectName),
        );
      },

      async connectProjectsToHost(input: {
        readonly hostProjectId: string;
        readonly connectedProjectIds: readonly string[];
      }) {
        const candidateIds = [...new Set(input.connectedProjectIds)];

        if (candidateIds.includes(input.hostProjectId)) {
          throw new InvalidProjectConnectionError(
            "candidate_is_self",
            input.hostProjectId,
            "A project cannot connect to itself.",
          );
        }

        // Pre-flight: read host + candidates + any current sub-projects of
        // candidates. Do this BEFORE the transaction so we can throw typed
        // errors instead of running into a CHECK / trigger violation.
        const [hostRow] = await db
          .select({
            projectId: projectDimensions.projectId,
            projectAlias: projectDimensions.projectAlias,
            isActive: projectDimensions.isActive,
            connectedToProjectId: projectDimensions.connectedToProjectId,
          })
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, input.hostProjectId))
          .limit(1);

        if (hostRow === undefined) {
          throw new InvalidProjectConnectionError(
            "host_not_found",
            input.hostProjectId,
            `Host project ${input.hostProjectId} no longer exists.`,
          );
        }
        if (!hostRow.isActive) {
          throw new InvalidProjectConnectionError(
            "host_inactive",
            input.hostProjectId,
            "Host project must be active before connecting sub-projects.",
          );
        }
        // Check chain status before alias: an active connected sub-project
        // has no alias of its own (it inherits the host's). If we checked
        // alias first, the user would see "missing alias" instead of the
        // more accurate "already connected".
        if (hostRow.connectedToProjectId !== null) {
          throw new InvalidProjectConnectionError(
            "host_already_connected",
            input.hostProjectId,
            "Host project is itself connected to another project.",
          );
        }
        if ((hostRow.projectAlias?.trim().length ?? 0) === 0) {
          throw new InvalidProjectConnectionError(
            "host_missing_alias",
            input.hostProjectId,
            "Host project must have a non-empty alias before connecting sub-projects.",
          );
        }

        if (candidateIds.length === 0) {
          // No-op connect; return the host's view-model untouched.
          const [host] = await loadSettingsProjects([input.hostProjectId]);
          if (host === undefined) {
            throw new InvalidProjectConnectionError(
              "host_not_found",
              input.hostProjectId,
            );
          }
          return {
            host,
            connectedProjects: [],
          };
        }

        const candidateRows = await db
          .select({
            projectId: projectDimensions.projectId,
            isActive: projectDimensions.isActive,
            connectedToProjectId: projectDimensions.connectedToProjectId,
          })
          .from(projectDimensions)
          .where(inArray(projectDimensions.projectId, candidateIds));

        const candidateRowsById = new Map(
          candidateRows.map((row) => [row.projectId, row] as const),
        );

        for (const candidateId of candidateIds) {
          const row = candidateRowsById.get(candidateId);
          if (row === undefined) {
            throw new InvalidProjectConnectionError(
              "candidate_not_found",
              candidateId,
              `Candidate project ${candidateId} no longer exists.`,
            );
          }
          if (row.isActive) {
            throw new InvalidProjectConnectionError(
              "candidate_already_active",
              candidateId,
              `Candidate project ${candidateId} is already active.`,
            );
          }
          if (row.connectedToProjectId !== null) {
            throw new InvalidProjectConnectionError(
              "candidate_already_connected",
              candidateId,
              `Candidate project ${candidateId} is already connected to another host.`,
            );
          }
        }

        // Reject candidates that are themselves hosts of other connected
        // sub-projects — connecting them would leave their existing children
        // dangling. Inactive hosts CAN'T have active children (children
        // require an active host), so this check is mostly defensive against
        // schema drift. Cheap and explicit.
        const [firstSubRowOfCandidate] = await db
          .select({ projectId: projectDimensions.projectId })
          .from(projectDimensions)
          .where(inArray(projectDimensions.connectedToProjectId, candidateIds))
          .limit(1);
        if (firstSubRowOfCandidate !== undefined) {
          throw new InvalidProjectConnectionError(
            "candidate_is_host",
            firstSubRowOfCandidate.projectId,
            "A candidate is itself a host with connected sub-projects.",
          );
        }

        await db.transaction(async (tx) => {
          await tx
            .update(projectDimensions)
            .set({
              isActive: true,
              connectedToProjectId: input.hostProjectId,
              projectAlias: null,
              aiKnowledgeUrl: null,
              aiKnowledgeSyncedAt: null,
              updatedAt: new Date(),
            })
            .where(inArray(projectDimensions.projectId, candidateIds));
        });

        const [host] = await loadSettingsProjects([input.hostProjectId]);
        if (host === undefined) {
          throw new InvalidProjectConnectionError(
            "host_not_found",
            input.hostProjectId,
          );
        }

        const connectedProjects = await loadSettingsProjects(candidateIds);

        return {
          host,
          connectedProjects: [...connectedProjects].sort((left, right) =>
            left.projectName.localeCompare(right.projectName),
          ),
        };
      },

      async disconnectProject(projectId: string) {
        const [existingRow] = await db
          .select({
            projectId: projectDimensions.projectId,
            connectedToProjectId: projectDimensions.connectedToProjectId,
          })
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);

        if (existingRow === undefined) {
          return null;
        }
        if (existingRow.connectedToProjectId === null) {
          throw new ProjectNotConnectedError(projectId);
        }

        const [row] = await db
          .update(projectDimensions)
          .set({
            isActive: false,
            connectedToProjectId: null,
            updatedAt: new Date(),
          })
          .where(eq(projectDimensions.projectId, projectId))
          .returning({
            projectId: projectDimensions.projectId,
          });

        if (row === undefined) {
          return null;
        }

        const [project] = await loadSettingsProjects([row.projectId]);
        return project ?? null;
      },

      async deactivateWithCascade(projectId: string) {
        const [existingRow] = await db
          .select({
            projectId: projectDimensions.projectId,
            isActive: projectDimensions.isActive,
          })
          .from(projectDimensions)
          .where(eq(projectDimensions.projectId, projectId))
          .limit(1);

        if (existingRow === undefined) {
          return null;
        }

        const subRowsBefore = await db
          .select({ projectId: projectDimensions.projectId })
          .from(projectDimensions)
          .where(
            and(
              eq(projectDimensions.connectedToProjectId, projectId),
              eq(projectDimensions.isActive, true),
            ),
          );
        const cascadedIds = subRowsBefore.map((row) => row.projectId);

        await db.transaction(async (tx) => {
          if (cascadedIds.length > 0) {
            await tx
              .update(projectDimensions)
              .set({
                isActive: false,
                connectedToProjectId: null,
                updatedAt: new Date(),
              })
              .where(inArray(projectDimensions.projectId, cascadedIds));
          }

          await tx
            .update(projectDimensions)
            .set({
              isActive: false,
              updatedAt: new Date(),
            })
            .where(eq(projectDimensions.projectId, projectId));
        });

        const [project] = await loadSettingsProjects([projectId]);
        if (project === undefined) {
          return null;
        }

        const cascadedSubProjects =
          cascadedIds.length === 0
            ? []
            : [...(await loadSettingsProjects(cascadedIds))].sort(
                (left, right) =>
                  left.projectName.localeCompare(right.projectName),
              );

        return {
          project,
          cascadedSubProjects,
        };
      },
    },

    users: {
      async findByEmail(email) {
        const [row] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        return row === undefined ? null : mapUserRow(row);
      },

      async findById(id) {
        const [row] = await db
          .select()
          .from(users)
          .where(eq(users.id, id))
          .limit(1);

        return row === undefined ? null : mapUserRow(row);
      },

      async listAll() {
        const rows = await db.select().from(users).orderBy(asc(users.email));

        return rows.map(mapUserRow);
      },

      async updateRole(id, role: UserRole) {
        const [row] = await db
          .update(users)
          .set({
            role,
            updatedAt: new Date(),
          })
          .where(eq(users.id, id))
          .returning();

        return mapUserRow(
          requireRow(row, "Expected user row to be returned from updateRole."),
        );
      },

      async updateName(id, name: string) {
        const [row] = await db
          .update(users)
          .set({
            name,
            updatedAt: new Date(),
          })
          .where(eq(users.id, id))
          .returning();

        return mapUserRow(
          requireRow(row, "Expected user row to be returned from updateName."),
        );
      },

      async setDeactivated(id, deactivatedAt) {
        const [row] = await db
          .update(users)
          .set({
            deactivatedAt,
            updatedAt: new Date(),
          })
          .where(eq(users.id, id))
          .returning();

        return mapUserRow(
          requireRow(
            row,
            "Expected user row to be returned from setDeactivated.",
          ),
        );
      },

      async upsert(record: UserRecord) {
        const values = mapUserToInsert(record);
        const [row] = await db
          .insert(users)
          .values(values)
          .onConflictDoUpdate({
            target: users.id,
            set: {
              name: values.name,
              email: values.email,
              emailVerified: values.emailVerified,
              image: values.image,
              role: values.role,
              deactivatedAt: values.deactivatedAt,
              updatedAt: new Date(),
            },
          })
          .returning();

        return mapUserRow(
          requireRow(row, "Expected user row to be returned from upsert."),
        );
      },
    },

    aliases: {
      async listAll() {
        const rows = await db
          .select()
          .from(projectAliases)
          .orderBy(asc(projectAliases.alias));

        return rows.map(mapProjectAliasRow);
      },

      async findById(id) {
        const [row] = await db
          .select()
          .from(projectAliases)
          .where(eq(projectAliases.id, id))
          .limit(1);

        return row === undefined ? null : mapProjectAliasRow(row);
      },

      async findByAlias(alias) {
        const [row] = await db
          .select()
          .from(projectAliases)
          .where(eq(projectAliases.alias, alias))
          .limit(1);

        return row === undefined ? null : mapProjectAliasRow(row);
      },

      async listAssigned() {
        const rows = await db
          .select()
          .from(projectAliases)
          .where(sql`${projectAliases.projectId} is not null`)
          .orderBy(asc(projectAliases.alias));

        return rows.map(mapProjectAliasRow);
      },

      async replaceForProject(input: {
        readonly projectId: string;
        readonly aliases: readonly string[];
        readonly actorId: string;
      }) {
        return db.transaction(async (tx: Stage1Database) => {
          const existingRows = await tx
            .select()
            .from(projectAliases)
            .where(eq(projectAliases.projectId, input.projectId));
          const signatureByAlias = new Map(
            existingRows.map((row) => [row.alias, row.signature] as const),
          );

          await tx
            .delete(projectAliases)
            .where(eq(projectAliases.projectId, input.projectId));

          if (input.aliases.length === 0) {
            return [];
          }

          const createdAtBase = Date.now();
          const rows = await tx
            .insert(projectAliases)
            .values(
              input.aliases.map((alias: string, index: number) => {
                const occurredAt = new Date(createdAtBase + index);
                return {
                  id: crypto.randomUUID(),
                  alias,
                  signature: signatureByAlias.get(alias) ?? "",
                  projectId: input.projectId,
                  createdAt: occurredAt,
                  updatedAt: occurredAt,
                  createdBy: input.actorId,
                  updatedBy: input.actorId,
                };
              }),
            )
            .returning();

          return rows.map(mapProjectAliasRow);
        });
      },

      async updateSignature(input) {
        const [row] = await db
          .update(projectAliases)
          .set({
            signature: input.signature,
            updatedAt: new Date(),
            updatedBy: input.actorId,
          })
          .where(eq(projectAliases.id, input.aliasId))
          .returning();

        return row === undefined ? null : mapProjectAliasRow(row);
      },

      async create(record: ProjectAliasRecord) {
        const values = mapProjectAliasToInsert(record);
        const [row] = await db
          .insert(projectAliases)
          .values(values)
          .returning();

        return mapProjectAliasRow(
          requireRow(
            row,
            "Expected project alias row to be returned from create.",
          ),
        );
      },

      async update(record: ProjectAliasRecord) {
        const values = mapProjectAliasToInsert(record);
        const [row] = await db
          .update(projectAliases)
          .set({
            alias: values.alias,
            signature: values.signature,
            projectId: values.projectId,
            updatedAt: new Date(),
            updatedBy: values.updatedBy,
          })
          .where(eq(projectAliases.id, values.id))
          .returning();

        return mapProjectAliasRow(
          requireRow(
            row,
            "Expected project alias row to be returned from update.",
          ),
        );
      },

      async delete(id) {
        await db.delete(projectAliases).where(eq(projectAliases.id, id));
      },
    },
  });
}

export function createStage2RepositoryBundle(
  db: Stage1Database,
): Stage2RepositoryBundle {
  return createStage2RepositoriesInternal(db);
}

export function createStage2RepositoryBundleFromConnection(
  connection: Pick<DatabaseConnection, "db">,
): Stage2RepositoryBundle {
  return createStage2RepositoriesInternal(connection.db);
}

type CampaignRunRow = typeof campaignRuns.$inferSelect;
type AudienceSnapshotRow = typeof audienceSnapshots.$inferSelect;
type ContactConsentRow = typeof contactConsent.$inferSelect;
type SuppressionListRow = typeof suppressionList.$inferSelect;
type OrgSettingsRow = typeof orgSettings.$inferSelect;
type PostmarkWebhookDeadLetterRow =
  typeof postmarkWebhookDeadLetter.$inferSelect;

interface CampaignRunProjectionRowDb {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp";
  readonly kind: CampaignRunRecord["kind"];
  readonly launchType: CampaignRunRecord["launchType"];
  readonly state: CampaignRunRecord["state"];
  readonly projectId: string | null;
  readonly sender: string;
  readonly subject: string;
  readonly audienceSize: number | null;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const CAMPAIGN_RUN_ALLOWED_TRANSITIONS: Readonly<
  Record<RunState, readonly RunState[]>
> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["sending", "cancelled"],
  sending: ["complete", "cancelled"],
  complete: ["finalized"],
  finalized: [],
  cancelled: [],
};

function clampCampaignListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  return Math.max(1, Math.min(limit, 200));
}

function clampCampaignListOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }

  return Math.max(0, offset);
}

function normalizeProjectIdFilter(
  projectIds: readonly string[] | undefined,
): readonly string[] | null {
  if (projectIds === undefined) {
    return null;
  }

  const normalized = [
    ...new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean)),
  ];

  return normalized.length === 0 ? [] : normalized;
}

function normalizeRunStateFilter(
  states: readonly RunState[] | undefined,
): readonly RunState[] | null {
  if (states === undefined) {
    return null;
  }

  const normalized = [...new Set(states)];
  return normalized.length === 0 ? [] : normalized;
}

function normalizeCampaignSearchQuery(
  searchQuery: string | undefined,
): string | null {
  if (searchQuery === undefined) {
    return null;
  }

  const normalized = searchQuery.trim();
  return normalized.length === 0 ? null : normalized;
}

function resolveCampaignProjectionProjectFilter(input: {
  readonly projectIds?: readonly string[];
  readonly filterByProjectIds?: readonly string[];
}): readonly string[] | null {
  return normalizeProjectIdFilter(input.projectIds ?? input.filterByProjectIds);
}

function buildCampaignProjectionWhereClause(input: {
  readonly projectIds: readonly string[] | null;
  readonly states: readonly RunState[] | null;
  readonly searchQuery: string | null;
}) {
  const conditions = [];

  if (input.projectIds !== null) {
    conditions.push(
      input.projectIds.length === 0
        ? sql`1 = 0`
        : sql`"project_id" in (${sql.join(
            input.projectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`,
    );
  }

  if (input.states !== null) {
    conditions.push(
      input.states.length === 0
        ? sql`1 = 0`
        : sql`"state" in (${sql.join(
            input.states.map((state) => sql`${state}`),
            sql`, `,
          )})`,
    );
  }

  if (input.searchQuery !== null) {
    const pattern = `%${input.searchQuery.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`"subject" ilike ${pattern} escape '\\'`);
  }

  if (conditions.length === 0) {
    return sql``;
  }

  return sql`where ${sql.join(conditions, sql` and `)}`;
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toNullableIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toNullableDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  return new Date(value);
}

function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeConsentScope(input: {
  readonly type: ConsentScopeType;
  readonly id?: string;
}): {
  readonly scopeType: ConsentScopeType;
  readonly scopeId: string | null;
} {
  const scopeType = input.type;
  const trimmedId = input.id?.trim();
  const scopeId =
    trimmedId === undefined || trimmedId.length === 0 ? null : trimmedId;

  if (scopeType === "project" && scopeId === null) {
    throw new Error("scope.id is required when scope.type='project'.");
  }

  if ((scopeType === "newsletter" || scopeType === "all") && scopeId !== null) {
    throw new Error("scope.id must be omitted unless scope.type='project'.");
  }

  return {
    scopeType,
    scopeId,
  };
}

function mapCampaignRunRow(row: CampaignRunRow): CampaignRunRecord {
  return campaignRunRecordSchema.parse({
    id: row.id,
    kind: row.kind,
    launchType: row.launchType,
    state: row.state,
    projectId: row.projectId,
    name: row.name,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyToEmail: row.replyToEmail,
    subjectTemplate: row.subjectTemplate,
    bodyHtmlTemplate: row.bodyHtmlTemplate,
    bodyDesignJson: row.bodyDesignJson,
    bodyTextTemplate: row.bodyTextTemplate,
    preheader: row.preheader,
    audienceCriteria: audienceCriteriaSchema.parse(row.audienceCriteria),
    audienceSize: row.audienceSize,
    scheduledAt: toNullableIsoDate(row.scheduledAt),
    startedAt: toNullableIsoDate(row.startedAt),
    completedAt: toNullableIsoDate(row.completedAt),
    finalizedAt: toNullableIsoDate(row.finalizedAt),
    cancelledAt: toNullableIsoDate(row.cancelledAt),
    cancelledReason: row.cancelledReason,
    createdByUserId: row.createdByUserId,
    lastEditedByUserId: row.lastEditedByUserId,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  });
}

function mapAudienceSnapshotRow(
  row: AudienceSnapshotRow,
): AudienceSnapshotRecord {
  return audienceSnapshotRecordSchema.parse({
    id: row.id,
    campaignRunId: row.campaignRunId,
    contactId: row.contactId,
    frozenEmail: row.frozenEmail,
    frozenFirstName: row.frozenFirstName,
    frozenProjectName: row.frozenProjectName,
    frozenProjectId: row.frozenProjectId,
    frozenAliasEmail: row.frozenAliasEmail,
    unsubscribeToken: row.unsubscribeToken,
    deliveryStatus: row.deliveryStatus,
    providerMessageId: row.providerMessageId,
    sentAt: toNullableIsoDate(row.sentAt),
    deliveredAt: toNullableIsoDate(row.deliveredAt),
    bouncedAt: toNullableIsoDate(row.bouncedAt),
    openedAt: toNullableIsoDate(row.openedAt),
    clickedAt: toNullableIsoDate(row.clickedAt),
    complainedAt: toNullableIsoDate(row.complainedAt),
    unsubscribedAt: toNullableIsoDate(row.unsubscribedAt),
    lastEventAt: toNullableIsoDate(row.lastEventAt),
    createdAt: toIsoDate(row.createdAt),
  });
}

function mapContactConsentRow(row: ContactConsentRow): ContactConsentRecord {
  return contactConsentRecordSchema.parse({
    id: row.id,
    contactId: row.contactId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    source: row.source,
    sourceRunId: row.sourceRunId,
    optedOutAt: toIsoDate(row.optedOutAt),
    createdAt: toIsoDate(row.createdAt),
  });
}

function mapSuppressionListRow(row: SuppressionListRow): SuppressionListRecord {
  return suppressionListRecordSchema.parse({
    id: row.id,
    normalizedEmail: row.normalizedEmail,
    reason: row.reason,
    firstEventAt: toIsoDate(row.firstEventAt),
    lastEventAt: toIsoDate(row.lastEventAt),
    lastProviderEventId: row.lastProviderEventId,
    notes: row.notes,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  });
}

function mapOrgSettingsRow(row: OrgSettingsRow): OrgSettingsRecord {
  return orgSettingsRecordSchema.parse({
    id: row.id,
    physicalAddressLine1: row.physicalAddressLine1,
    physicalAddressLine2: row.physicalAddressLine2,
    physicalCity: row.physicalCity,
    physicalState: row.physicalState,
    physicalZip: row.physicalZip,
    physicalCountry: row.physicalCountry,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  });
}

function mapPostmarkWebhookDeadLetterRow(
  row: PostmarkWebhookDeadLetterRow,
): PostmarkWebhookDeadLetterRecord {
  return postmarkWebhookDeadLetterRecordSchema.parse({
    id: row.id,
    receivedAt: toIsoDate(row.receivedAt),
    recordType: row.recordType,
    messageId: row.messageId,
    sourceEvidenceId: row.sourceEvidenceId,
    payloadJson: row.payloadJson,
    failureKind: row.failureKind,
    failureMessage: row.failureMessage,
    retryCount: row.retryCount,
    lastRetryAt: toNullableIsoDate(row.lastRetryAt),
    status: row.status,
    terminalReason: row.terminalReason,
  });
}

function isTerminalWebhookDeadLetterFailureKind(
  failureKind: WebhookDeadLetterFailureKind,
): boolean {
  return failureKind === "schema_error" || failureKind === "unknown_event_type";
}

function clampWebhookDeadLetterListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }

  return Math.max(1, Math.min(limit, 500));
}

function coerceRequiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function coerceNullableDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  return coerceRequiredDate(value);
}

function mapCampaignRunProjectionRowDb(
  row: CampaignRunProjectionRowDb,
): CampaignRunProjectionRow {
  // Raw SQL queries against the VIEW can yield timestamp strings rather than
  // Date objects depending on the driver path. Coerce defensively so the iso
  // mappers always see a Date.
  return campaignRunProjectionRowSchema.parse({
    runId: row.runId,
    provider: row.provider,
    kind: row.kind,
    launchType: row.launchType,
    state: row.state,
    projectId: row.projectId,
    sender: row.sender,
    subject: row.subject,
    audienceSize: row.audienceSize,
    scheduledAt: toNullableIsoDate(coerceNullableDate(row.scheduledAt)),
    startedAt: toNullableIsoDate(coerceNullableDate(row.startedAt)),
    completedAt: toNullableIsoDate(coerceNullableDate(row.completedAt)),
    cancelledAt: toNullableIsoDate(coerceNullableDate(row.cancelledAt)),
    createdAt: toIsoDate(coerceRequiredDate(row.createdAt)),
    updatedAt: toIsoDate(coerceRequiredDate(row.updatedAt)),
  });
}

function mapCampaignRunMutationFields(
  input:
    | UpdateDraftInput
    | Partial<CampaignRunRecord>
    | Partial<CreateDraftInput>,
): Partial<typeof campaignRuns.$inferInsert> {
  const values: Partial<typeof campaignRuns.$inferInsert> = {};

  if ("kind" in input && input.kind !== undefined) {
    values.kind = input.kind;
  }
  if ("launchType" in input && input.launchType !== undefined) {
    values.launchType = input.launchType;
  }
  if ("projectId" in input && input.projectId !== undefined) {
    values.projectId = input.projectId;
  }
  if ("name" in input && input.name !== undefined) {
    values.name = input.name;
  }
  if ("fromEmail" in input && input.fromEmail !== undefined) {
    values.fromEmail = input.fromEmail;
  }
  if ("fromName" in input && input.fromName !== undefined) {
    values.fromName = input.fromName;
  }
  if ("replyToEmail" in input && input.replyToEmail !== undefined) {
    values.replyToEmail = input.replyToEmail;
  }
  if ("subjectTemplate" in input && input.subjectTemplate !== undefined) {
    values.subjectTemplate = input.subjectTemplate;
  }
  if ("bodyHtmlTemplate" in input && input.bodyHtmlTemplate !== undefined) {
    values.bodyHtmlTemplate = input.bodyHtmlTemplate;
  }
  if ("bodyDesignJson" in input && input.bodyDesignJson !== undefined) {
    values.bodyDesignJson = input.bodyDesignJson;
  }
  if ("bodyTextTemplate" in input && input.bodyTextTemplate !== undefined) {
    values.bodyTextTemplate = input.bodyTextTemplate;
  }
  if ("preheader" in input && input.preheader !== undefined) {
    values.preheader = input.preheader;
  }
  if ("audienceCriteria" in input && input.audienceCriteria !== undefined) {
    values.audienceCriteria = audienceCriteriaSchema.parse(
      input.audienceCriteria,
    );
  }
  if ("audienceSize" in input && input.audienceSize !== undefined) {
    values.audienceSize = input.audienceSize;
  }
  if ("scheduledAt" in input && input.scheduledAt !== undefined) {
    values.scheduledAt = toNullableDate(input.scheduledAt);
  }
  if ("startedAt" in input) {
    values.startedAt = toNullableDate(input.startedAt);
  }
  if ("completedAt" in input) {
    values.completedAt = toNullableDate(input.completedAt);
  }
  if ("finalizedAt" in input) {
    values.finalizedAt = toNullableDate(input.finalizedAt);
  }
  if ("cancelledAt" in input) {
    values.cancelledAt = toNullableDate(input.cancelledAt);
  }
  if ("cancelledReason" in input) {
    values.cancelledReason = input.cancelledReason;
  }
  if ("createdByUserId" in input) {
    values.createdByUserId = input.createdByUserId;
  }
  if ("lastEditedByUserId" in input && input.lastEditedByUserId !== undefined) {
    values.lastEditedByUserId = input.lastEditedByUserId;
  }

  return values;
}

function mapAudienceSnapshotInsert(
  runId: string,
  member: NewAudienceSnapshot,
): typeof audienceSnapshots.$inferInsert {
  const parsed = newAudienceSnapshotSchema.parse(member);

  return {
    id: parsed.id,
    campaignRunId: runId,
    contactId: parsed.contactId,
    frozenEmail: parsed.frozenEmail,
    frozenFirstName: parsed.frozenFirstName ?? null,
    frozenProjectName: parsed.frozenProjectName ?? null,
    frozenProjectId: parsed.frozenProjectId ?? null,
    frozenAliasEmail: parsed.frozenAliasEmail ?? null,
    unsubscribeToken: parsed.unsubscribeToken,
    deliveryStatus: parsed.deliveryStatus ?? "pending",
    providerMessageId: parsed.providerMessageId ?? null,
    sentAt: toNullableDate(parsed.sentAt),
    deliveredAt: toNullableDate(parsed.deliveredAt),
    bouncedAt: toNullableDate(parsed.bouncedAt),
    openedAt: toNullableDate(parsed.openedAt),
    clickedAt: toNullableDate(parsed.clickedAt),
    complainedAt: toNullableDate(parsed.complainedAt),
    unsubscribedAt: toNullableDate(parsed.unsubscribedAt),
    lastEventAt: toNullableDate(parsed.lastEventAt),
    createdAt: new Date(),
  };
}

function mapAudienceSnapshotMutationFields(
  input: Partial<AudienceSnapshotRecord>,
): Partial<typeof audienceSnapshots.$inferInsert> {
  const values: Partial<typeof audienceSnapshots.$inferInsert> = {};

  if (input.frozenEmail !== undefined) {
    values.frozenEmail = input.frozenEmail;
  }
  if (input.frozenFirstName !== undefined) {
    values.frozenFirstName = input.frozenFirstName;
  }
  if (input.frozenProjectName !== undefined) {
    values.frozenProjectName = input.frozenProjectName;
  }
  if (input.frozenProjectId !== undefined) {
    values.frozenProjectId = input.frozenProjectId;
  }
  if (input.frozenAliasEmail !== undefined) {
    values.frozenAliasEmail = input.frozenAliasEmail;
  }
  if (input.unsubscribeToken !== undefined) {
    values.unsubscribeToken = input.unsubscribeToken;
  }
  if (input.deliveryStatus !== undefined) {
    values.deliveryStatus = input.deliveryStatus;
  }
  if (input.providerMessageId !== undefined) {
    values.providerMessageId = input.providerMessageId;
  }
  if (input.sentAt !== undefined) {
    values.sentAt = toNullableDate(input.sentAt);
  }
  if (input.deliveredAt !== undefined) {
    values.deliveredAt = toNullableDate(input.deliveredAt);
  }
  if (input.bouncedAt !== undefined) {
    values.bouncedAt = toNullableDate(input.bouncedAt);
  }
  if (input.openedAt !== undefined) {
    values.openedAt = toNullableDate(input.openedAt);
  }
  if (input.clickedAt !== undefined) {
    values.clickedAt = toNullableDate(input.clickedAt);
  }
  if (input.complainedAt !== undefined) {
    values.complainedAt = toNullableDate(input.complainedAt);
  }
  if (input.unsubscribedAt !== undefined) {
    values.unsubscribedAt = toNullableDate(input.unsubscribedAt);
  }
  if (input.lastEventAt !== undefined) {
    values.lastEventAt = toNullableDate(input.lastEventAt);
  }

  return values;
}

export function createStage5RepositoryBundle(
  db: Stage1Database,
): Stage5RepositoryBundle {
  const loadCampaignRunById = async (
    id: string,
  ): Promise<CampaignRunRecord | null> => {
    const [row] = await db
      .select()
      .from(campaignRuns)
      .where(eq(campaignRuns.id, id))
      .limit(1);

    return row === undefined ? null : mapCampaignRunRow(row);
  };

  const readOrgSettingsRow = async (): Promise<OrgSettingsRow> => {
    const [existing] = await db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.id, "singleton"))
      .limit(1);

    if (existing !== undefined) {
      return existing;
    }

    await db
      .insert(orgSettings)
      .values({ id: "singleton" })
      .onConflictDoNothing();

    const [inserted] = await db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.id, "singleton"))
      .limit(1);

    return requireRow(
      inserted,
      "Expected org_settings singleton row to exist after fallback insert.",
    );
  };

  return defineStage5RepositoryBundle({
    campaignRuns: {
      async create(input) {
        const parsed = createDraftInputSchema.parse(input);
        const now = new Date();
        const [row] = await db
          .insert(campaignRuns)
          .values({
            id: parsed.id,
            kind: parsed.kind,
            launchType: parsed.launchType,
            state: "draft",
            projectId: parsed.projectId,
            fromEmail: parsed.fromEmail,
            fromName: parsed.fromName,
            replyToEmail: parsed.replyToEmail,
            subjectTemplate: parsed.subjectTemplate,
            bodyHtmlTemplate: parsed.bodyHtmlTemplate,
            bodyDesignJson: parsed.bodyDesignJson,
            bodyTextTemplate: parsed.bodyTextTemplate,
            preheader: parsed.preheader,
            audienceCriteria: audienceCriteriaSchema.parse(
              parsed.audienceCriteria,
            ),
            audienceSize: parsed.audienceSize,
            createdByUserId: parsed.createdByUserId,
            lastEditedByUserId: parsed.lastEditedByUserId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return mapCampaignRunRow(
          requireRow(
            row,
            "Expected campaign run row to be returned from create.",
          ),
        );
      },

      async findById(id) {
        return loadCampaignRunById(id);
      },

      async listByIds(ids) {
        const uniqueIds = [...new Set(ids.map((id) => id.trim()))].filter(
          (id) => id.length > 0,
        );
        if (uniqueIds.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(campaignRuns)
          .where(inArray(campaignRuns.id, uniqueIds));

        return rows.map(mapCampaignRunRow);
      },

      async listRecent(opts = {}) {
        const limit = clampCampaignListLimit(opts.limit);
        const projectIds = normalizeProjectIdFilter(opts.filterByProjectIds);
        const states =
          opts.state === undefined
            ? null
            : [
                ...new Set(
                  opts.state.map((state) => runStateSchema.parse(state)),
                ),
              ];

        if (projectIds !== null && projectIds.length === 0) {
          return [];
        }
        if (states !== null && states.length === 0) {
          return [];
        }

        const predicates: SQL[] = [];
        if (projectIds !== null) {
          predicates.push(inArray(campaignRuns.projectId, [...projectIds]));
        }
        if (states !== null) {
          predicates.push(inArray(campaignRuns.state, [...states]));
        }

        const whereClause = combinePredicates(...predicates);
        const rows =
          whereClause === undefined
            ? await db
                .select()
                .from(campaignRuns)
                .orderBy(desc(campaignRuns.createdAt), asc(campaignRuns.id))
                .limit(limit)
            : await db
                .select()
                .from(campaignRuns)
                .where(whereClause)
                .orderBy(desc(campaignRuns.createdAt), asc(campaignRuns.id))
                .limit(limit);

        return rows.map(mapCampaignRunRow);
      },

      async updateDraft(id, input) {
        const parsed = updateDraftInputSchema.parse(input);
        const existing = await loadCampaignRunById(id);

        if (existing === null) {
          throw new Error(`Campaign run ${id} was not found.`);
        }
        if (existing.state !== "draft") {
          throw new Error(`Campaign run ${id} is not editable outside draft.`);
        }

        campaignRunRecordSchema.parse({
          ...existing,
          ...parsed,
        });

        const [row] = await db
          .update(campaignRuns)
          .set({
            ...mapCampaignRunMutationFields(parsed),
            updatedAt: new Date(),
          })
          .where(and(eq(campaignRuns.id, id), eq(campaignRuns.state, "draft")))
          .returning();

        return mapCampaignRunRow(
          requireRow(
            row,
            "Expected draft campaign run row to be returned from updateDraft.",
          ),
        );
      },

      async transitionState(id, from, to, fields) {
        const parsedFrom = runStateSchema.parse(from);
        const parsedTo = runStateSchema.parse(to);

        if (!CAMPAIGN_RUN_ALLOWED_TRANSITIONS[parsedFrom].includes(parsedTo)) {
          throw new InvalidCampaignRunStateTransitionError({
            runId: id,
            from: parsedFrom,
            to: parsedTo,
          });
        }

        const [row] = await db
          .update(campaignRuns)
          .set({
            ...mapCampaignRunMutationFields(fields ?? {}),
            state: parsedTo,
            updatedAt: new Date(),
          })
          .where(
            and(eq(campaignRuns.id, id), eq(campaignRuns.state, parsedFrom)),
          )
          .returning();

        return mapCampaignRunRow(
          requireRow(
            row,
            `Expected campaign run ${id} in state ${parsedFrom} to transition to ${parsedTo}.`,
          ),
        );
      },

      async update(id, fields) {
        const [row] = await db
          .update(campaignRuns)
          .set({
            ...mapCampaignRunMutationFields(fields),
            updatedAt: new Date(),
          })
          .where(eq(campaignRuns.id, id))
          .returning();

        return mapCampaignRunRow(
          requireRow(
            row,
            `Expected campaign run ${id} to be returned from update.`,
          ),
        );
      },
    },

    audienceSnapshots: {
      async bulkInsert(runId, members) {
        if (members.length === 0) {
          return;
        }

        await db
          .insert(audienceSnapshots)
          .values(
            members.map((member) => mapAudienceSnapshotInsert(runId, member)),
          )
          .onConflictDoNothing({
            target: [
              audienceSnapshots.campaignRunId,
              audienceSnapshots.contactId,
            ],
          });
      },

      async listForRun(runId) {
        const rows = await db
          .select()
          .from(audienceSnapshots)
          .where(eq(audienceSnapshots.campaignRunId, runId))
          .orderBy(asc(audienceSnapshots.createdAt), asc(audienceSnapshots.id));

        return rows.map(mapAudienceSnapshotRow);
      },

      async findByUnsubscribeToken(token) {
        const [row] = await db
          .select()
          .from(audienceSnapshots)
          .where(eq(audienceSnapshots.unsubscribeToken, token))
          .limit(1);

        return row === undefined ? null : mapAudienceSnapshotRow(row);
      },

      async findByProviderMessageId(messageId) {
        const [row] = await db
          .select()
          .from(audienceSnapshots)
          .where(eq(audienceSnapshots.providerMessageId, messageId))
          .limit(1);

        return row === undefined ? null : mapAudienceSnapshotRow(row);
      },

      async update(id, fields) {
        const [row] = await db
          .update(audienceSnapshots)
          .set(mapAudienceSnapshotMutationFields(fields))
          .where(eq(audienceSnapshots.id, id))
          .returning();

        return mapAudienceSnapshotRow(
          requireRow(
            row,
            `Expected audience snapshot ${id} to be returned from update.`,
          ),
        );
      },

      async updateDeliveryEvent(id, event) {
        const status = deliveryStatusSchema.parse(event.status);
        const eventAtIso = event.at.toISOString();
        const eventAtSql = sql`${eventAtIso}::timestamptz`;
        const deliveryFields: Record<string, SQL | DeliveryStatus> = {
          deliveryStatus: status,
          lastEventAt: sql`greatest(coalesce(${audienceSnapshots.lastEventAt}, ${eventAtSql}), ${eventAtSql})`,
        };

        switch (status) {
          case "sent":
            deliveryFields.sentAt = sql`coalesce(${audienceSnapshots.sentAt}, ${eventAtSql})`;
            break;
          case "delivered":
            deliveryFields.deliveredAt = sql`coalesce(${audienceSnapshots.deliveredAt}, ${eventAtSql})`;
            break;
          case "bounced":
            deliveryFields.bouncedAt = sql`coalesce(${audienceSnapshots.bouncedAt}, ${eventAtSql})`;
            break;
          case "complained":
            deliveryFields.complainedAt = sql`coalesce(${audienceSnapshots.complainedAt}, ${eventAtSql})`;
            break;
          case "unsubscribed":
            deliveryFields.unsubscribedAt = sql`coalesce(${audienceSnapshots.unsubscribedAt}, ${eventAtSql})`;
            break;
          case "pending":
          case "failed":
          case "suppressed_at_send":
            break;
        }

        // Stage 5A stores the provider's MessageID but not webhook event IDs.
        // Preserve the parameter in the contract for Brief A2/A6 callers even
        // though this repository has no durable column for it yet.
        void event.providerEventId;

        if (event.activity === "open") {
          deliveryFields.openedAt = sql`coalesce(${audienceSnapshots.openedAt}, ${eventAtSql})`;
        }

        if (event.activity === "click") {
          deliveryFields.clickedAt = sql`coalesce(${audienceSnapshots.clickedAt}, ${eventAtSql})`;
        }

        await db
          .update(audienceSnapshots)
          .set(deliveryFields as Partial<typeof audienceSnapshots.$inferInsert>)
          .where(eq(audienceSnapshots.id, id));
      },
    },

    contactConsent: {
      async recordOptOut(contactId, scope, source, sourceRunId) {
        const normalizedScope = normalizeConsentScope(scope);
        await db
          .insert(contactConsent)
          .values({
            id: crypto.randomUUID(),
            contactId,
            scopeType: normalizedScope.scopeType,
            scopeId: normalizedScope.scopeId,
            source,
            sourceRunId: sourceRunId ?? null,
            optedOutAt: new Date(),
            createdAt: new Date(),
          })
          .onConflictDoNothing();
      },

      async isOptedOut(contactId, scope, at) {
        const normalizedScope = normalizeConsentScope(scope);
        const scopedPredicate =
          normalizedScope.scopeType === "project"
            ? and(
                eq(contactConsent.scopeType, "project"),
                eq(contactConsent.scopeId, normalizedScope.scopeId ?? ""),
              )
            : eq(contactConsent.scopeType, normalizedScope.scopeType);
        const [row] = await db
          .select({ id: contactConsent.id })
          .from(contactConsent)
          .where(
            and(
              eq(contactConsent.contactId, contactId),
              lte(contactConsent.optedOutAt, at),
              or(eq(contactConsent.scopeType, "all"), scopedPredicate),
            ),
          )
          .limit(1);

        return row !== undefined;
      },

      async listForContact(contactId) {
        const rows = await db
          .select()
          .from(contactConsent)
          .where(eq(contactConsent.contactId, contactId))
          .orderBy(
            desc(contactConsent.optedOutAt),
            desc(contactConsent.createdAt),
          );

        return rows.map(mapContactConsentRow);
      },
    },

    suppressionList: {
      async upsertFromBounce(email, reason, providerEventId, eventAt) {
        const normalizedEmail = normalizeSuppressionEmail(email);
        const eventAtIso = eventAt.toISOString();

        await db
          .insert(suppressionList)
          .values({
            id: crypto.randomUUID(),
            normalizedEmail,
            reason,
            firstEventAt: eventAt,
            lastEventAt: eventAt,
            lastProviderEventId: providerEventId,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: suppressionList.normalizedEmail,
            set: {
              reason,
              firstEventAt: sql`least(${suppressionList.firstEventAt}, ${eventAtIso}::timestamptz)`,
              lastEventAt: sql`greatest(${suppressionList.lastEventAt}, ${eventAtIso}::timestamptz)`,
              lastProviderEventId: providerEventId,
              updatedAt: new Date(),
            },
          });
      },

      async isSuppressed(normalizedEmail, at) {
        const [row] = await db
          .select({ id: suppressionList.id })
          .from(suppressionList)
          .where(
            and(
              eq(
                suppressionList.normalizedEmail,
                normalizeSuppressionEmail(normalizedEmail),
              ),
              lte(suppressionList.firstEventAt, at),
            ),
          )
          .limit(1);

        return row !== undefined;
      },

      async listAll() {
        const rows = await db
          .select()
          .from(suppressionList)
          .orderBy(asc(suppressionList.normalizedEmail));

        return rows.map(mapSuppressionListRow);
      },
    },

    orgSettings: {
      async read() {
        return mapOrgSettingsRow(await readOrgSettingsRow());
      },

      async update(input) {
        const values: Partial<typeof orgSettings.$inferInsert> = {};

        if (input.physicalAddressLine1 !== undefined) {
          values.physicalAddressLine1 = input.physicalAddressLine1;
        }
        if (input.physicalAddressLine2 !== undefined) {
          values.physicalAddressLine2 = input.physicalAddressLine2;
        }
        if (input.physicalCity !== undefined) {
          values.physicalCity = input.physicalCity;
        }
        if (input.physicalState !== undefined) {
          values.physicalState = input.physicalState;
        }
        if (input.physicalZip !== undefined) {
          values.physicalZip = input.physicalZip;
        }
        if (input.physicalCountry !== undefined) {
          values.physicalCountry = input.physicalCountry;
        }

        if (Object.keys(values).length === 0) {
          return mapOrgSettingsRow(await readOrgSettingsRow());
        }

        const [row] = await db
          .update(orgSettings)
          .set({
            ...values,
            updatedAt: new Date(),
          })
          .where(eq(orgSettings.id, "singleton"))
          .returning();

        return mapOrgSettingsRow(
          requireRow(
            row,
            "Expected org_settings singleton row to be returned from update.",
          ),
        );
      },
    },

    webhookDeadLetter: {
      async record(input) {
        const isTerminal = isTerminalWebhookDeadLetterFailureKind(
          input.failureKind,
        );
        const terminalReason =
          input.terminalReason === undefined
            ? null
            : input.terminalReason.trim().length === 0
              ? null
              : input.terminalReason.trim();

        if (isTerminal && terminalReason === null) {
          throw new Error(
            `terminalReason is required for ${input.failureKind} dead-letter records.`,
          );
        }
        if (!isTerminal && terminalReason !== null) {
          throw new Error(
            `terminalReason must be omitted for retryable ${input.failureKind} dead-letter records.`,
          );
        }

        const [row] = await db
          .insert(postmarkWebhookDeadLetter)
          .values({
            recordType: input.recordType,
            messageId: input.messageId,
            sourceEvidenceId: input.sourceEvidenceId,
            payloadJson: input.payloadJson,
            failureKind: input.failureKind,
            failureMessage: input.failureMessage,
            status: isTerminal ? "terminal" : "pending",
            terminalReason,
          })
          .returning();

        return mapPostmarkWebhookDeadLetterRow(
          requireRow(
            row,
            "Expected postmark webhook dead-letter row to be returned from record.",
          ),
        );
      },

      async listPending(limit) {
        const rows = await db
          .select()
          .from(postmarkWebhookDeadLetter)
          .where(eq(postmarkWebhookDeadLetter.status, "pending"))
          .orderBy(
            asc(postmarkWebhookDeadLetter.receivedAt),
            asc(postmarkWebhookDeadLetter.id),
          )
          .limit(clampWebhookDeadLetterListLimit(limit));

        return rows.map(mapPostmarkWebhookDeadLetterRow);
      },

      async markRetried(id, at) {
        await db
          .update(postmarkWebhookDeadLetter)
          .set({
            retryCount: sql`${postmarkWebhookDeadLetter.retryCount} + 1`,
            lastRetryAt: at,
            status: "retried",
          })
          .where(eq(postmarkWebhookDeadLetter.id, id));
      },

      async markTerminal(id, reason) {
        await db
          .update(postmarkWebhookDeadLetter)
          .set({
            status: "terminal",
            terminalReason: reason,
          })
          .where(eq(postmarkWebhookDeadLetter.id, id));
      },
    },

    campaignRunProjection: {
      async listRecent(opts = {}) {
        const limit = clampCampaignListLimit(opts.limit);
        const offset = clampCampaignListOffset(opts.offset);
        const projectIds = resolveCampaignProjectionProjectFilter(opts);
        const states = normalizeRunStateFilter(opts.states);
        const searchQuery = normalizeCampaignSearchQuery(opts.searchQuery);
        const whereClause = buildCampaignProjectionWhereClause({
          projectIds,
          states,
          searchQuery,
        });

        const result = await db.execute(sql<CampaignRunProjectionRowDb>`
          select
            "run_id" as "runId",
            "provider" as "provider",
            "kind" as "kind",
            "launch_type" as "launchType",
            "state" as "state",
            "project_id" as "projectId",
            "sender" as "sender",
            "subject" as "subject",
            "audience_size" as "audienceSize",
            "scheduled_at" as "scheduledAt",
            "started_at" as "startedAt",
            "completed_at" as "completedAt",
            "cancelled_at" as "cancelledAt",
            "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "campaign_run_projection"
          ${whereClause}
          order by "updated_at" desc, "created_at" desc, "run_id" asc
          limit ${limit}
          offset ${offset}
        `);

        return normalizeSqlResultRows<CampaignRunProjectionRowDb>(
          result as { readonly rows?: readonly CampaignRunProjectionRowDb[] },
        ).map(mapCampaignRunProjectionRowDb);
      },

      async getDetail(runId, provider) {
        const result = await db.execute(sql<CampaignRunProjectionRowDb>`
          select
            "run_id" as "runId",
            "provider" as "provider",
            "kind" as "kind",
            "launch_type" as "launchType",
            "state" as "state",
            "project_id" as "projectId",
            "sender" as "sender",
            "subject" as "subject",
            "audience_size" as "audienceSize",
            "scheduled_at" as "scheduledAt",
            "started_at" as "startedAt",
            "completed_at" as "completedAt",
            "cancelled_at" as "cancelledAt",
            "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "campaign_run_projection"
          where "run_id" = ${runId}
            and "provider" = ${provider}
          limit 1
        `);
        const [row] = normalizeSqlResultRows<CampaignRunProjectionRowDb>(
          result as { readonly rows?: readonly CampaignRunProjectionRowDb[] },
        );

        return row === undefined ? null : mapCampaignRunProjectionRowDb(row);
      },

      async count(opts = {}) {
        const projectIds = resolveCampaignProjectionProjectFilter(opts);
        const states = normalizeRunStateFilter(opts.states);
        const searchQuery = normalizeCampaignSearchQuery(opts.searchQuery);
        const whereClause = buildCampaignProjectionWhereClause({
          projectIds,
          states,
          searchQuery,
        });

        const result = await db.execute(sql<{
          readonly total: number | string;
        }>`
          select count(*)::int as "total"
          from "campaign_run_projection"
          ${whereClause}
        `);
        const [row] = normalizeSqlResultRows<{
          readonly total: number | string;
        }>(
          result as {
            readonly rows?: readonly { readonly total: number | string }[];
          },
        );

        return Number(row?.total ?? 0);
      },

      async countByState(opts = {}) {
        const projectIds = resolveCampaignProjectionProjectFilter(opts);
        const whereClause = buildCampaignProjectionWhereClause({
          projectIds,
          states: null,
          searchQuery: null,
        });

        const result = await db.execute(sql<{
          readonly state: RunState;
          readonly total: number | string;
        }>`
          select "state" as "state", count(*)::int as "total"
          from "campaign_run_projection"
          ${whereClause}
          group by "state"
        `);

        const counts: Partial<Record<RunState, number>> = {};
        for (const row of normalizeSqlResultRows<{
          readonly state: RunState;
          readonly total: number | string;
        }>(
          result as {
            readonly rows?: readonly {
              readonly state: RunState;
              readonly total: number | string;
            }[];
          },
        )) {
          counts[runStateSchema.parse(row.state)] = Number(row.total);
        }

        return counts;
      },
    },
  });
}

export function createStage5RepositoryBundleFromConnection(
  connection: Pick<DatabaseConnection, "db">,
): Stage5RepositoryBundle {
  return createStage5RepositoryBundle(connection.db);
}
