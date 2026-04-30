import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
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

import type { DatabaseConnection } from "./client.js";
import {
  mapAiKnowledgeEntryRow,
  mapAiKnowledgeEntryToInsert,
  mapAuditEvidenceRow,
  mapAuditEvidenceToInsert,
  mapCanonicalEventRow,
  mapCanonicalEventToInsert,
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
  mapSalesforceEventContextRow,
  mapSalesforceEventContextToInsert,
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
  internalNotes,
  mailchimpCampaignActivityDetails,
  messageAttachments,
  manualNoteDetails,
  pendingComposerOutbounds,
  projectAliases,
  projectKnowledgeEntries,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceEventContext,
  simpleTextingMessageDetails,
  sourceEvidenceLog,
  sourceEvidenceQuarantine,
  syncState,
  users,
} from "./schema/index.js";

export type Stage1Database = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

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
  readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  readonly campaignId: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly campaignName: string | null;
  readonly snippet: string;
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
  const rowsByCollisionKey = new Map<string, SourceEvidenceCollisionJoinedRow[]>();

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
    activityType: row.activityType,
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
const manualNoteDetailsTable = manualNoteDetails as typeof manualNoteDetails & {
  readonly sourceEvidenceId: typeof manualNoteDetails.sourceEvidenceId;
};
const pendingComposerOutboundsTable =
  pendingComposerOutbounds as typeof pendingComposerOutbounds & {
    readonly id: typeof pendingComposerOutbounds.id;
  };

function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }

  return row;
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
  | "all"
  | "unread"
  | "follow-up"
  | "unresolved"
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

  if (filter === "archived") {
    return isNotNull(contactInboxProjection.archivedAt);
  }

  const filterPredicate =
    filter === "unread"
      ? eq(contactInboxProjection.bucket, "New")
      : filter === "follow-up"
        ? eq(contactInboxProjection.isStarred, true)
        : filter === "unresolved"
          ? eq(contactInboxProjection.hasUnresolved, true)
          : filter === "sent"
            ? isNotNull(contactInboxProjection.lastOutboundAt)
            : undefined;

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

  return sql`exists (
    select 1 from ${contactMemberships}
    inner join ${projectDimensions}
      on ${contactMemberships.projectId} = ${projectDimensions.projectId}
    where ${contactMemberships.contactId} = ${contactInboxProjection.contactId}
      and ${contactMemberships.projectId} = ${projectId}
      and ${projectDimensions.isActive} = true
  )`;
}

function buildInboxCursorPredicate(input: {
  readonly cursor: InboxRecencyCursor | null;
  readonly order: InboxProjectionOrder;
}): SQL | undefined {
  if (input.cursor === null) {
    return undefined;
  }

  if (input.order === "last-outbound") {
    if (input.cursor.lastOutboundAt === null) {
      return undefined;
    }

    return sql`(
      ${contactInboxProjection.lastOutboundAt} < ${new Date(input.cursor.lastOutboundAt)}
      or (
        ${contactInboxProjection.lastOutboundAt} = ${new Date(input.cursor.lastOutboundAt)}
        and ${contactInboxProjection.lastActivityAt} < ${new Date(input.cursor.lastActivityAt)}
      )
      or (
        ${contactInboxProjection.lastOutboundAt} = ${new Date(input.cursor.lastOutboundAt)}
        and ${contactInboxProjection.lastActivityAt} = ${new Date(input.cursor.lastActivityAt)}
        and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
      )
    )`;
  }

  if (input.cursor.lastInboundAt === null) {
    return sql`(
      ${contactInboxProjection.lastInboundAt} is null
      and (
        ${contactInboxProjection.lastActivityAt} < ${new Date(input.cursor.lastActivityAt)}
        or (
          ${contactInboxProjection.lastActivityAt} = ${new Date(input.cursor.lastActivityAt)}
          and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
        )
      )
    )`;
  }

  return sql`(
    ${contactInboxProjection.lastInboundAt} is null
    or ${contactInboxProjection.lastInboundAt} < ${new Date(input.cursor.lastInboundAt)}
    or (
      ${contactInboxProjection.lastInboundAt} = ${new Date(input.cursor.lastInboundAt)}
      and ${contactInboxProjection.lastActivityAt} < ${new Date(input.cursor.lastActivityAt)}
    )
    or (
      ${contactInboxProjection.lastInboundAt} = ${new Date(input.cursor.lastInboundAt)}
      and ${contactInboxProjection.lastActivityAt} = ${new Date(input.cursor.lastActivityAt)}
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
                eq(sourceEvidenceLog.provider, sourceEvidenceQuarantine.provider),
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
          requireRow(row, "Expected source evidence quarantine row after insert."),
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

        const visibleRows = rows.slice(0, limit).map(mapSourceEvidenceQuarantineRow);

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
          .where(eq(canonicalEventLedger.contactId, contactId))
          .orderBy(
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
          .orderBy(desc(aiKnowledgeEntries.syncedAt), asc(aiKnowledgeEntries.id))
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
          .orderBy(desc(aiKnowledgeEntries.syncedAt), asc(aiKnowledgeEntries.id))
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

      async findProjectIdsWithNotionContent(projectIds) {
        if (projectIds.length === 0) {
          return [];
        }
        const rows = await db
          .selectDistinct({ scopeKey: aiKnowledgeEntries.scopeKey })
          .from(aiKnowledgeEntries)
          .where(
            and(
              eq(aiKnowledgeEntries.scope, "project"),
              eq(aiKnowledgeEntries.sourceProvider, "notion"),
              inArray(aiKnowledgeEntries.scopeKey, projectIds as string[]),
              sql`length(btrim(${aiKnowledgeEntries.content})) > 0`,
            ),
          );

        return rows
          .map((row) => row.scopeKey)
          .filter((key): key is string => key !== null);
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

      async searchByQuery(input) {
        const normalizedQuery = input.query.trim().toLowerCase();

        if (normalizedQuery.length < 2) {
          return [];
        }

        const limit = Math.max(1, Math.min(input.limit, 8));
        const pattern = `%${normalizedQuery}%`;
        const rows = await db
          .select()
          .from(contacts)
          .where(
            or(
              sql`lower(${contacts.displayName}) like ${pattern}`,
              sql`lower(coalesce(${contacts.primaryEmail}, '')) like ${pattern}`,
            ),
          )
          .orderBy(
            sql`case when lower(${contacts.displayName}) like ${pattern} then 0 else 1 end`,
            asc(contacts.displayName),
            asc(contacts.id),
          )
          .limit(limit);

        return rows.map(mapContactRow);
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

    projectDimensions: {
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
              // isActive intentionally NOT updated: admins manage it in Settings,
              // and Salesforce capture must not overwrite that app-owned state.
              aiKnowledgeUrl: values.aiKnowledgeUrl,
              aiKnowledgeSyncedAt: values.aiKnowledgeSyncedAt,
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
          : ((result as {
              readonly rows?: readonly {
                readonly contactId: string;
                readonly projectInboxAlias: string;
              }[];
            }).rows ?? []);

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
          .where(inArray(messageAttachments.sourceEvidenceId, [...sourceEvidenceIds]))
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

        return row === undefined ? undefined : mapInternalNoteWithAuthorRow(row);
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
          requireRow(
            row,
            `Expected internal_notes row ${input.id} to update.`,
          ),
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
          sentAt: input.sentAt,
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
            desc(pendingComposerOutbounds.sentAt),
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
          .orderBy(desc(pendingComposerOutbounds.sentAt))
          .limit(1)) as PendingComposerOutboundRow[];
        return row === undefined ? null : mapPendingComposerOutboundRow(row);
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
              lt(pendingComposerOutbounds.sentAt, input.olderThan),
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
            desc(pendingComposerOutbounds.sentAt),
            desc(pendingComposerOutbounds.createdAt),
          )
          .limit(input.limit)) as PendingComposerOutboundRow[];

        return rows.map(mapPendingComposerOutboundRow);
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
          .where(eq(contactTimelineProjection.contactId, contactId))
          .orderBy(asc(contactTimelineProjection.sortKey));

        return rows.map(mapTimelineProjectionRow);
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

    const resolvedProjectIds = projectRows.map((row) => row.projectId);
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

    return projectRows.map((row) => {
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

      async setProjectAlias(
        projectId: string,
        projectAlias: string | null,
      ) {
        const [row] = await db
          .update(projectDimensions)
          .set({
            projectAlias,
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
