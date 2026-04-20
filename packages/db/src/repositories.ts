import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  ProjectAliasRecord,
  Stage1RepositoryBundle,
  Stage2RepositoryBundle,
  UserRecord,
  UserRole
} from "@as-comms/domain";
import {
  defineStage1RepositoryBundle,
  defineStage2RepositoryBundle
} from "@as-comms/domain";

import type { DatabaseConnection } from "./client.js";
import {
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
  mapProjectAliasRow,
  mapProjectAliasToInsert,
  mapProjectDimensionRow,
  mapProjectDimensionToInsert,
  mapRoutingReviewRow,
  mapRoutingReviewToInsert,
  mapSalesforceEventContextRow,
  mapSalesforceEventContextToInsert,
  mapSourceEvidenceRow,
  mapSourceEvidenceToInsert,
  mapSyncStateRow,
  mapSyncStateToInsert,
  mapTimelineProjectionRow,
  mapTimelineProjectionToInsert,
  mapUserRow,
  mapUserToInsert
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import {
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
  projectAliases,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceEventContext,
  simpleTextingMessageDetails,
  sourceEvidenceLog,
  syncState,
  users
} from "./schema/index.js";

export type Stage1Database = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

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
}

type SalesforceCommunicationDetailRow = SalesforceCommunicationDetailRecord;
type SimpleTextingMessageDetailRow = SimpleTextingMessageDetailRecord;
type MailchimpCampaignActivityDetailRow = MailchimpCampaignActivityDetailRecord;
type ManualNoteDetailRow = ManualNoteDetailRecord;

function mapSalesforceCommunicationDetailRowLocal(
  row: SalesforceCommunicationDetailRow
): SalesforceCommunicationDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    channel: row.channel,
    messageKind: row.messageKind,
    subject: row.subject,
    snippet: row.snippet,
    sourceLabel: row.sourceLabel
  };
}

function mapSalesforceCommunicationDetailToInsertLocal(
  record: SalesforceCommunicationDetailRecord
) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    channel: record.channel,
    messageKind: record.messageKind,
    subject: record.subject,
    snippet: record.snippet,
    sourceLabel: record.sourceLabel
  };
}

function mapSimpleTextingMessageDetailRowLocal(
  row: SimpleTextingMessageDetailRow
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
    threadKey: row.threadKey
  };
}

function mapSimpleTextingMessageDetailToInsertLocal(
  record: SimpleTextingMessageDetailRecord
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
    threadKey: record.threadKey
  };
}

function mapMailchimpCampaignActivityDetailRowLocal(
  row: MailchimpCampaignActivityDetailRow
): MailchimpCampaignActivityDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType: row.activityType,
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    memberId: row.memberId,
    campaignName: row.campaignName,
    snippet: row.snippet
  };
}

function mapMailchimpCampaignActivityDetailToInsertLocal(
  record: MailchimpCampaignActivityDetailRecord
) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    activityType: record.activityType,
    campaignId: record.campaignId,
    audienceId: record.audienceId,
    memberId: record.memberId,
    campaignName: record.campaignName,
    snippet: record.snippet
  };
}

function mapManualNoteDetailRowLocal(
  row: ManualNoteDetailRow
): ManualNoteDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    body: row.body,
    authorDisplayName: row.authorDisplayName
  };
}

function mapManualNoteDetailToInsertLocal(record: ManualNoteDetailRecord) {
  return {
    sourceEvidenceId: record.sourceEvidenceId,
    providerRecordId: record.providerRecordId,
    body: record.body,
    authorDisplayName: record.authorDisplayName
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
    status: "not_checked"
  },
  {
    id: "gmail",
    serviceName: "gmail",
    category: "messaging",
    status: "not_checked"
  },
  {
    id: "simpletexting",
    serviceName: "simpletexting",
    category: "messaging",
    status: "not_configured"
  },
  {
    id: "mailchimp",
    serviceName: "mailchimp",
    category: "messaging",
    status: "not_configured"
  },
  {
    id: "notion",
    serviceName: "notion",
    category: "knowledge",
    status: "not_configured"
  },
  {
    id: "openai",
    serviceName: "openai",
    category: "ai",
    status: "not_configured"
  }
] as const;

type InboxProjectionFilter = "all" | "unread" | "follow-up" | "unresolved";

function buildInboxRecencyExpression() {
  return sql<Date>`coalesce(${contactInboxProjection.lastInboundAt}, ${contactInboxProjection.lastActivityAt})`;
}

function buildInboxFilterPredicate(filter: InboxProjectionFilter): SQL | undefined {
  return filter === "unread"
    ? eq(contactInboxProjection.bucket, "New")
    : filter === "follow-up"
      ? eq(contactInboxProjection.isStarred, true)
      : filter === "unresolved"
        ? eq(contactInboxProjection.hasUnresolved, true)
        : undefined;
}

function buildInboxCursorPredicate(input: {
  readonly cursor:
    | {
        readonly sortAt: string;
        readonly lastActivityAt: string;
        readonly contactId: string;
      }
    | null;
  readonly recencyExpression: SQL<Date>;
}): SQL | undefined {
  return input.cursor === null
    ? undefined
    : sql`(
        ${input.recencyExpression} < ${new Date(input.cursor.sortAt)}
        or (
          ${input.recencyExpression} = ${new Date(input.cursor.sortAt)}
          and ${contactInboxProjection.lastActivityAt} < ${new Date(input.cursor.lastActivityAt)}
        )
        or (
          ${input.recencyExpression} = ${new Date(input.cursor.sortAt)}
          and ${contactInboxProjection.lastActivityAt} = ${new Date(input.cursor.lastActivityAt)}
          and ${contactInboxProjection.contactId} > ${input.cursor.contactId}
        )
      )`;
}

function combinePredicates(
  ...predicates: readonly (SQL | undefined)[]
): SQL | undefined {
  const definedPredicates = predicates.filter(
    (predicate): predicate is SQL => predicate !== undefined
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
  const primaryProjectLabelExpression = buildInboxPrimaryProjectLabelExpression();
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
  db: Stage1Database
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
              sourceEvidenceLog.checksum
            ]
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
              eq(sourceEvidenceLog.checksum, values.checksum)
            )
          )
          .limit(1);

        return mapSourceEvidenceRow(
          requireRow(
            existing,
            "Expected an existing source evidence row after duplicate append."
          )
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

      async countByProvider(provider) {
        const [row] = await db
          .select({
            value: count()
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
              eq(sourceEvidenceLog.providerRecordType, input.providerRecordType),
              eq(sourceEvidenceLog.providerRecordId, input.providerRecordId)
            )
          )
          .orderBy(
            asc(sourceEvidenceLog.occurredAt),
            asc(sourceEvidenceLog.createdAt)
          );

        return rows.map(mapSourceEvidenceRow);
      }
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

      async countAll() {
        const [row] = await db
          .select({
            value: count()
          })
          .from(canonicalEventLedger);

        return row?.value ?? 0;
      },

      async countByPrimaryProvider(provider) {
        const [row] = await db
          .select({
            value: count()
          })
          .from(canonicalEventLedger)
          .innerJoin(
            sourceEvidenceLog,
            eq(canonicalEventLedger.sourceEvidenceId, sourceEvidenceLog.id)
          )
          .where(eq(sourceEvidenceLog.provider, provider));

        return row?.value ?? 0;
      },

      async countDistinctInboxContacts() {
        const [row] = await db
          .select({
            value: countDistinct(canonicalEventLedger.contactId)
          })
          .from(canonicalEventLedger)
          .where(
            inArray(canonicalEventLedger.eventType, [
              "communication.email.inbound",
              "communication.email.outbound",
              "communication.sms.inbound",
              "communication.sms.outbound"
            ])
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
            asc(canonicalEventLedger.createdAt)
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
              sourceEvidenceId: values.sourceEvidenceId,
              idempotencyKey: values.idempotencyKey,
              provenance: values.provenance,
              reviewState: values.reviewState,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapCanonicalEventRow(
          requireRow(row, "Expected canonical event row to be returned.")
        );
      }
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
              updatedAt: values.updatedAt
            }
          })
          .returning();

        return mapContactRow(requireRow(row, "Expected contact row to be returned."));
      }
    },

    contactIdentities: {
      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.contactId, contactId))
          .orderBy(
            desc(contactIdentities.isPrimary),
            asc(contactIdentities.normalizedValue)
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
              eq(contactIdentities.normalizedValue, input.normalizedValue)
            )
          )
          .orderBy(desc(contactIdentities.isPrimary), asc(contactIdentities.id));

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
              contactIdentities.normalizedValue
            ],
            set: {
              isPrimary: values.isPrimary,
              source: values.source,
              verifiedAt: values.verifiedAt,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapContactIdentityRow(
          requireRow(row, "Expected contact identity row to be returned.")
        );
      }
    },

    contactMemberships: {
      async listByContactId(contactId) {
        const rows = await db
          .select()
          .from(contactMemberships)
          .where(eq(contactMemberships.contactId, contactId))
          .orderBy(asc(contactMemberships.projectId), asc(contactMemberships.id));

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
            asc(contactMemberships.id)
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
              role: values.role,
              status: values.status,
              source: values.source,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapContactMembershipRow(
          requireRow(row, "Expected contact membership row to be returned.")
        );
      }
    },

    projectDimensions: {
      async listAll() {
        const rows = await db
          .select()
          .from(projectDimensions)
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
              isActive: values.isActive,
              aiKnowledgeUrl: values.aiKnowledgeUrl,
              aiKnowledgeSyncedAt: values.aiKnowledgeSyncedAt,
              source: values.source,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapProjectDimensionRow(
          requireRow(row, "Expected project dimension row to be returned.")
        );
      }
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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapExpeditionDimensionRow(
          requireRow(row, "Expected expedition dimension row to be returned.")
        );
      }
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
            inArray(gmailMessageDetails.sourceEvidenceId, [...sourceEvidenceIds])
          )
          .orderBy(asc(gmailMessageDetails.sourceEvidenceId));

        return rows.map(mapGmailMessageDetailRow);
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
              snippetClean: values.snippetClean,
              bodyTextPreview: values.bodyTextPreview,
              capturedMailbox: values.capturedMailbox,
              projectInboxAlias: values.projectInboxAlias,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapGmailMessageDetailRow(
          requireRow(row, "Expected Gmail message detail row to be returned.")
        );
      }
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
              ...sourceEvidenceIds
            ])
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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapSalesforceEventContextRow(
          requireRow(row, "Expected Salesforce event context row to be returned.")
        );
      }
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
          .orderBy(asc(sourceEvidenceIdColumn))) as SalesforceCommunicationDetailRow[];

        return rows.map(mapSalesforceCommunicationDetailRowLocal);
      },

      async upsert(record) {
        const sourceEvidenceIdColumn =
          salesforceCommunicationDetailsTable.sourceEvidenceId;
        const values = mapSalesforceCommunicationDetailToInsertLocal(
          record as SalesforceCommunicationDetailRecord
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
              updatedAt: new Date()
            }
          })
          .returning()) as SalesforceCommunicationDetailRow[];

        return mapSalesforceCommunicationDetailRowLocal(
          requireRow(
            row,
            "Expected Salesforce communication detail row to be returned."
          )
        );
      }
    },

    simpleTextingMessageDetails: {
      async listBySourceEvidenceIds(sourceEvidenceIds) {
        if (sourceEvidenceIds.length === 0) {
          return [];
        }

        const sourceEvidenceIdColumn = simpleTextingMessageDetailsTable.sourceEvidenceId;
        const rows = (await db
          .select()
          .from(simpleTextingMessageDetails)
          .where(inArray(sourceEvidenceIdColumn, [...sourceEvidenceIds]))
          .orderBy(asc(sourceEvidenceIdColumn))) as SimpleTextingMessageDetailRow[];

        return rows.map(mapSimpleTextingMessageDetailRowLocal);
      },

      async upsert(record) {
        const sourceEvidenceIdColumn = simpleTextingMessageDetailsTable.sourceEvidenceId;
        const values = mapSimpleTextingMessageDetailToInsertLocal(
          record as SimpleTextingMessageDetailRecord
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
              updatedAt: new Date()
            }
          })
          .returning()) as SimpleTextingMessageDetailRow[];

        return mapSimpleTextingMessageDetailRowLocal(
          requireRow(
            row,
            "Expected SimpleTexting message detail row to be returned."
          )
        );
      }
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
          .orderBy(asc(sourceEvidenceIdColumn))) as MailchimpCampaignActivityDetailRow[];

        return rows.map(mapMailchimpCampaignActivityDetailRowLocal);
      },

      async upsert(record) {
        const sourceEvidenceIdColumn =
          mailchimpCampaignActivityDetailsTable.sourceEvidenceId;
        const values = mapMailchimpCampaignActivityDetailToInsertLocal(
          record as MailchimpCampaignActivityDetailRecord
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
              updatedAt: new Date()
            }
          })
          .returning()) as MailchimpCampaignActivityDetailRow[];

        return mapMailchimpCampaignActivityDetailRowLocal(
          requireRow(
            row,
            "Expected Mailchimp campaign activity detail row to be returned."
          )
        );
      }
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

      async upsert(record) {
        const sourceEvidenceIdColumn = manualNoteDetailsTable.sourceEvidenceId;
        const values = mapManualNoteDetailToInsertLocal(record as ManualNoteDetailRecord);
        const [row] = (await db
          .insert(manualNoteDetails)
          .values(values)
          .onConflictDoUpdate({
            target: sourceEvidenceIdColumn,
            set: {
              providerRecordId: values.providerRecordId,
              body: values.body,
              authorDisplayName: values.authorDisplayName,
              updatedAt: new Date()
            }
          })
          .returning()) as ManualNoteDetailRow[];

        return mapManualNoteDetailRowLocal(
          requireRow(row, "Expected manual note detail row to be returned.")
        );
      }
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
              eq(identityResolutionQueue.status, "open")
            )
          )
          .orderBy(asc(identityResolutionQueue.openedAt));

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
                sql`${contactId} = any(${identityResolutionQueue.candidateContactIds})`
              )
            )
          )
          .orderBy(desc(identityResolutionQueue.openedAt), asc(identityResolutionQueue.id));

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
              normalizedIdentityValues: values.normalizedIdentityValues,
              anchoredContactId: values.anchoredContactId,
              explanation: values.explanation,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapIdentityResolutionRow(
          requireRow(row, "Expected identity resolution row to be returned.")
        );
      }
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
              eq(routingReviewQueue.status, "open")
            )
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
              eq(routingReviewQueue.status, "open")
            )
          )
          .orderBy(desc(routingReviewQueue.openedAt), asc(routingReviewQueue.id));

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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapRoutingReviewRow(
          requireRow(row, "Expected routing review row to be returned.")
        );
      }
    },

    inboxProjection: {
      async countAll() {
        const [row] = await db
          .select({
            value: count()
          })
          .from(contactInboxProjection);

        return row?.value ?? 0;
      },

      async countInvalidRecencyRows() {
        const [row] = await db
          .select({
            value: count()
          })
          .from(contactInboxProjection)
          .where(
            sql`${contactInboxProjection.lastActivityAt} is distinct from greatest(
              coalesce(${contactInboxProjection.lastInboundAt}, '-infinity'::timestamptz),
              coalesce(${contactInboxProjection.lastOutboundAt}, '-infinity'::timestamptz)
            )`
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
            contactId: contactInboxProjection.contactId
          })
          .from(contactInboxProjection)
          .where(
            sql`${contactInboxProjection.lastActivityAt} is distinct from greatest(
              coalesce(${contactInboxProjection.lastInboundAt}, '-infinity'::timestamptz),
              coalesce(${contactInboxProjection.lastOutboundAt}, '-infinity'::timestamptz)
            )`
          )
          .orderBy(asc(contactInboxProjection.contactId));

        return rows.map((row) => row.contactId);
      },

      async listAllOrderedByRecency() {
        const recencyExpression = buildInboxRecencyExpression();
        const rows = await db
          .select()
          .from(contactInboxProjection)
          .orderBy(
            desc(recencyExpression),
            desc(contactInboxProjection.lastActivityAt),
            asc(contactInboxProjection.contactId)
          );

        return rows.map(mapInboxProjectionRow);
      },

      async listPageOrderedByRecency(input) {
        const recencyExpression = buildInboxRecencyExpression();
        const whereClause = combinePredicates(
          buildInboxFilterPredicate(input.filter),
          buildInboxCursorPredicate({
            cursor: input.cursor,
            recencyExpression
          })
        );
        const baseQuery = db.select().from(contactInboxProjection);
        const filteredQuery =
          whereClause === undefined ? baseQuery : baseQuery.where(whereClause);
        const rows = await filteredQuery
          .orderBy(
            desc(recencyExpression),
            desc(contactInboxProjection.lastActivityAt),
            asc(contactInboxProjection.contactId)
          )
          .limit(input.limit);

        return rows.map(mapInboxProjectionRow);
      },

      async searchPageOrderedByRecency(input) {
        const recencyExpression = buildInboxRecencyExpression();
        const whereClause = combinePredicates(
          buildInboxFilterPredicate(input.filter),
          buildInboxCursorPredicate({
            cursor: input.cursor,
            recencyExpression
          }),
          buildInboxSearchPredicate(input.query)
        );
        const filteredQuery = db
          .select()
          .from(contactInboxProjection)
          .where(whereClause);
        const [rows, totalRow] = await Promise.all([
          filteredQuery
            .orderBy(
              desc(recencyExpression),
              desc(contactInboxProjection.lastActivityAt),
              asc(contactInboxProjection.contactId)
            )
            .limit(input.limit),
          db
            .select({
              value: count()
            })
            .from(contactInboxProjection)
            .where(
              combinePredicates(
                buildInboxFilterPredicate(input.filter),
                buildInboxSearchPredicate(input.query)
              )
            )
            .then((result) => result[0])
        ]);

        return {
          rows: rows.map(mapInboxProjectionRow),
          total: totalRow?.value ?? 0
        };
      },

      async countByFilters() {
        const [row] = await db
          .select({
            all: count(),
            unread:
              sql<number>`coalesce(sum(case when ${contactInboxProjection.bucket} = 'New' then 1 else 0 end), 0)`,
            followUp:
              sql<number>`coalesce(sum(case when ${contactInboxProjection.isStarred} then 1 else 0 end), 0)`,
            unresolved:
              sql<number>`coalesce(sum(case when ${contactInboxProjection.hasUnresolved} then 1 else 0 end), 0)`
          })
          .from(contactInboxProjection);

        return {
          all: row?.all ?? 0,
          unread: row?.unread ?? 0,
          followUp: row?.followUp ?? 0,
          unresolved: row?.unresolved ?? 0
        };
      },

      async getFreshness() {
        const [row] = await db
          .select({
            total: count(),
            latestUpdatedAt:
              sql<Date | null>`max(${contactInboxProjection.updatedAt})`
          })
          .from(contactInboxProjection);

        return {
          total: row?.total ?? 0,
          latestUpdatedAt:
            row?.latestUpdatedAt instanceof Date
              ? row.latestUpdatedAt.toISOString()
              : null
        };
      },

      async getFreshnessByContactId(contactId) {
        const [row] = await db
          .select({
            updatedAt: contactInboxProjection.updatedAt
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
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
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
            updatedAt: new Date()
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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapInboxProjectionRow(
          requireRow(row, "Expected inbox projection row to be returned.")
        );
      }
    },

    timelineProjection: {
      async countAll() {
        const [row] = await db
          .select({
            value: count()
          })
          .from(contactTimelineProjection);

        return row?.value ?? 0;
      },

      async findByCanonicalEventId(canonicalEventId) {
        const [row] = await db
          .select()
          .from(contactTimelineProjection)
          .where(eq(contactTimelineProjection.canonicalEventId, canonicalEventId))
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
                lt(contactTimelineProjection.sortKey, input.beforeSortKey)
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
            value: count()
          })
          .from(contactTimelineProjection)
          .where(eq(contactTimelineProjection.contactId, contactId));

        return row?.value ?? 0;
      },

      async getFreshnessByContactId(contactId) {
        const [row] = await db
          .select({
            total: count(),
            latestUpdatedAt:
              sql<Date | null>`max(${contactTimelineProjection.updatedAt})`,
            latestSortKey:
              sql<string | null>`max(${contactTimelineProjection.sortKey})`
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
          latestSortKey: row?.latestSortKey ?? null
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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapTimelineProjectionRow(
          requireRow(row, "Expected timeline projection row to be returned.")
        );
      }
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
              eq(syncState.jobType, input.jobType)
            )
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
              deadLetterCount: values.deadLetterCount,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapSyncStateRow(
          requireRow(row, "Expected sync state row to be returned.")
        );
      }
    },

    auditEvidence: {
      async append(record) {
        const values = mapAuditEvidenceToInsert(record);
        const [row] = await db
          .insert(auditPolicyEvidence)
          .values(values)
          .returning();

        return mapAuditEvidenceRow(
          requireRow(row, "Expected audit evidence row to be returned.")
        );
      },

      async listByEntity(input) {
        const rows = await db
          .select()
          .from(auditPolicyEvidence)
          .where(
            and(
              eq(auditPolicyEvidence.entityType, input.entityType),
              eq(auditPolicyEvidence.entityId, input.entityId)
            )
          )
          .orderBy(
            asc(auditPolicyEvidence.occurredAt),
            asc(auditPolicyEvidence.createdAt)
          );

        return rows.map(mapAuditEvidenceRow);
      }
    }
  });
}

export function createStage1RepositoryBundle(
  db: Stage1Database
): Stage1RepositoryBundle {
  return createStage1RepositoriesInternal(db);
}

export function createStage1RepositoryBundleFromConnection(
  connection: Pick<DatabaseConnection, "db">
): Stage1RepositoryBundle {
  return createStage1RepositoriesInternal(connection.db);
}

function createStage2RepositoriesInternal(
  db: Stage1Database
): Stage2RepositoryBundle {
  async function loadSettingsProjects(projectIds?: readonly string[]) {
    const normalizedProjectIds =
      projectIds === undefined
        ? null
        : [...new Set(projectIds.filter((projectId) => projectId.trim().length > 0))];

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
        asc(projectAliases.alias)
      );
    const memberCountRows = await db
      .select({
        projectId: contactMemberships.projectId,
        memberCount: count()
      })
      .from(contactMemberships)
      .where(inArray(contactMemberships.projectId, resolvedProjectIds))
      .groupBy(contactMemberships.projectId);

    const emailsByProjectId = new Map<
      string,
      { readonly address: string; readonly createdAt: Date }[]
    >();
    for (const aliasRow of aliasRows) {
      if (aliasRow.projectId === null) {
        continue;
      }

      const projectEmails = emailsByProjectId.get(aliasRow.projectId) ?? [];
      projectEmails.push({
        address: aliasRow.alias,
        createdAt: aliasRow.createdAt
      });
      emailsByProjectId.set(aliasRow.projectId, projectEmails);
    }

    const memberCountByProjectId = new Map(
      memberCountRows.flatMap((row) =>
        row.projectId === null
          ? []
          : [[row.projectId, row.memberCount] as const]
      )
    );

    return projectRows.map((row) => {
      const orderedEmails = (emailsByProjectId.get(row.projectId) ?? [])
        .slice()
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.address.localeCompare(right.address)
        )
        .map((email, index) => ({
          address: email.address,
          isPrimary: index === 0
        }));

      return {
        projectId: row.projectId,
        salesforceProjectId: row.projectId,
        projectName: row.projectName,
        isActive: row.isActive,
        aiKnowledgeUrl: row.aiKnowledgeUrl,
        aiKnowledgeSyncedAt: row.aiKnowledgeSyncedAt,
        emails: orderedEmails,
        memberCount: memberCountByProjectId.get(row.projectId) ?? 0,
        updatedAt: row.updatedAt
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
              metadataJson: {}
            }))
          )
          .onConflictDoNothing({
            target: integrationHealth.id
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
              detail: values.detail,
              metadataJson: values.metadataJson,
              updatedAt: new Date()
            }
          })
          .returning();

        return mapIntegrationHealthRow(
          requireRow(
            row,
            "Expected integration health row to be returned from upsert."
          )
        );
      }
    },

    projects: {
      async findById(projectId) {
        const [row] = await loadSettingsProjects([projectId]);
        return row ?? null;
      },

      async listAll() {
        return loadSettingsProjects();
      }
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
        const rows = await db
          .select()
          .from(users)
          .orderBy(asc(users.email));

        return rows.map(mapUserRow);
      },

      async updateRole(id, role: UserRole) {
        const [row] = await db
          .update(users)
          .set({
            role,
            updatedAt: new Date()
          })
          .where(eq(users.id, id))
          .returning();

        return mapUserRow(
          requireRow(row, "Expected user row to be returned from updateRole.")
        );
      },

      async setDeactivated(id, deactivatedAt) {
        const [row] = await db
          .update(users)
          .set({
            deactivatedAt,
            updatedAt: new Date()
          })
          .where(eq(users.id, id))
          .returning();

        return mapUserRow(
          requireRow(
            row,
            "Expected user row to be returned from setDeactivated."
          )
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
              updatedAt: new Date()
            }
          })
          .returning();

        return mapUserRow(
          requireRow(row, "Expected user row to be returned from upsert.")
        );
      }
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

      async create(record: ProjectAliasRecord) {
        const values = mapProjectAliasToInsert(record);
        const [row] = await db
          .insert(projectAliases)
          .values(values)
          .returning();

        return mapProjectAliasRow(
          requireRow(
            row,
            "Expected project alias row to be returned from create."
          )
        );
      },

      async update(record: ProjectAliasRecord) {
        const values = mapProjectAliasToInsert(record);
        const [row] = await db
          .update(projectAliases)
          .set({
            alias: values.alias,
            projectId: values.projectId,
            updatedAt: new Date(),
            updatedBy: values.updatedBy
          })
          .where(eq(projectAliases.id, values.id))
          .returning();

        return mapProjectAliasRow(
          requireRow(
            row,
            "Expected project alias row to be returned from update."
          )
        );
      },

      async delete(id) {
        await db.delete(projectAliases).where(eq(projectAliases.id, id));
      }
    }
  });
}

export function createStage2RepositoryBundle(
  db: Stage1Database
): Stage2RepositoryBundle {
  return createStage2RepositoriesInternal(db);
}

export function createStage2RepositoryBundleFromConnection(
  connection: Pick<DatabaseConnection, "db">
): Stage2RepositoryBundle {
  return createStage2RepositoriesInternal(connection.db);
}
