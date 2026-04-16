import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Stage1RepositoryBundle } from "@as-comms/domain";
import { defineStage1RepositoryBundle } from "@as-comms/domain";

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
  mapIdentityResolutionRow,
  mapIdentityResolutionToInsert,
  mapInboxProjectionRow,
  mapInboxProjectionToInsert,
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
  mapTimelineProjectionToInsert
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
  identityResolutionQueue,
  projectDimensions,
  routingReviewQueue,
  salesforceEventContext,
  sourceEvidenceLog,
  syncState
} from "./schema/index.js";

export type Stage1Database = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }

  return row;
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

      async findByContactId(contactId) {
        const [row] = await db
          .select()
          .from(contactInboxProjection)
          .where(eq(contactInboxProjection.contactId, contactId))
          .limit(1);

        return row === undefined ? null : mapInboxProjectionRow(row);
      },

      async listAllOrderedByRecency() {
        const rows = await db
          .select()
          .from(contactInboxProjection)
          .orderBy(
            desc(
              sql`coalesce(${contactInboxProjection.lastInboundAt}, ${contactInboxProjection.lastActivityAt})`
            ),
            desc(contactInboxProjection.lastActivityAt),
            asc(contactInboxProjection.contactId)
          );

        return rows.map(mapInboxProjectionRow);
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
