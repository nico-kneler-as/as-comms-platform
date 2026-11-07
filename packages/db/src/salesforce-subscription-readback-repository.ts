import { and, eq, inArray, sql } from "drizzle-orm";

import type { SalesforceSubscriptionReadbackMode } from "@as-comms/contracts";
import type {
  ConsentState,
  MirrorRow,
  PlannedReadbackEvent,
  PlatformConsentState,
} from "@as-comms/domain";

import type { Stage1Database } from "./repositories.js";
import {
  contactConsent,
  contactConsentClears,
  contactIdentities,
  contacts,
  newsletterSubscribers,
  newsletterSuppressions,
  projectDimensions,
  salesforceSubscriptionPreferences,
  salesforceSubscriptionReadbackEvents,
  suppressionList,
} from "./schema/index.js";

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function mirrorFromRow(
  row: typeof salesforceSubscriptionPreferences.$inferSelect,
): MirrorRow {
  return {
    salesforceRecordId: row.salesforceRecordId,
    email: row.email,
    salesforceContactId: row.salesforceContactId,
    generalNewsletter: row.generalNewsletter,
    oregonShoresNewsletter: row.oregonShoresNewsletter,
    projectBoxes: {
      "PNW Forest Monitoring": row.pnwForestMonitoring,
      "Beech and Butternut": row.beechAndButternut,
      "Tracking Whitebark Pine": row.trackingWhitebarkPine,
      "Coral Reef Expansion": row.coralReefExpansion,
      "Monitoring Killer Whales Project": row.monitoringKillerWhalesProject,
    },
    unsubscribedFromAll: row.unsubscribedFromAll,
    unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    emailBounced: row.emailBounced,
    recordCreationSource: row.recordCreationSource,
    isDeleted: row.isDeleted,
    sfLastModifiedAt: row.sfLastModifiedAt.toISOString(),
    sfLastModifiedById: row.sfLastModifiedById,
    capturedAt: row.capturedAt.toISOString(),
  };
}

function mirrorInsert(
  row: MirrorRow,
): typeof salesforceSubscriptionPreferences.$inferInsert {
  return {
    salesforceRecordId: row.salesforceRecordId,
    email: row.email.trim().toLowerCase(),
    salesforceContactId: row.salesforceContactId,
    generalNewsletter: row.generalNewsletter,
    oregonShoresNewsletter: row.oregonShoresNewsletter,
    pnwForestMonitoring: row.projectBoxes["PNW Forest Monitoring"],
    beechAndButternut: row.projectBoxes["Beech and Butternut"],
    trackingWhitebarkPine: row.projectBoxes["Tracking Whitebark Pine"],
    coralReefExpansion: row.projectBoxes["Coral Reef Expansion"],
    monitoringKillerWhalesProject:
      row.projectBoxes["Monitoring Killer Whales Project"],
    unsubscribedFromAll: row.unsubscribedFromAll,
    unsubscribedAt:
      row.unsubscribedAt === null ? null : new Date(row.unsubscribedAt),
    emailBounced: row.emailBounced,
    recordCreationSource: row.recordCreationSource,
    isDeleted: row.isDeleted,
    sfLastModifiedAt: new Date(row.sfLastModifiedAt),
    sfLastModifiedById: row.sfLastModifiedById,
    capturedAt: new Date(row.capturedAt),
    updatedAt: new Date(),
  };
}

export interface SalesforceSubscriptionReadbackRepository {
  countMirror(): Promise<number>;
  maxMirrorModifiedAt(): Promise<Date | null>;
  loadMirror(ids: readonly string[]): Promise<ReadonlyMap<string, MirrorRow>>;
  loadContacts(
    records: readonly {
      salesforceRecordId: string;
      salesforceContactId: string | null;
      email: string;
    }[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  loadProjectsByBox(): Promise<ReadonlyMap<string, readonly string[]>>;
  loadPlatformState(input: {
    readonly emails: readonly string[];
    readonly contactIds: readonly string[];
  }): Promise<PlatformConsentState>;
  persistBatch(input: {
    readonly mirrorUpserts: readonly MirrorRow[];
    readonly events: readonly PlannedReadbackEvent[];
    readonly mode: SalesforceSubscriptionReadbackMode;
  }): Promise<void>;
}

export function createSalesforceSubscriptionReadbackRepository(
  db: Stage1Database,
): SalesforceSubscriptionReadbackRepository {
  return {
    async countMirror() {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(salesforceSubscriptionPreferences);
      return row?.count ?? 0;
    },
    async maxMirrorModifiedAt() {
      const [row] = await db
        .select({
          value: sql<
            Date | string | null
          >`max(${salesforceSubscriptionPreferences.sfLastModifiedAt})`,
        })
        .from(salesforceSubscriptionPreferences);
      // Raw sql isn't mapped by Drizzle: postgres-js returns a string here,
      // PGlite a Date. Normalize both.
      const value = row?.value ?? null;
      return value === null ? null : new Date(value);
    },
    async loadMirror(ids) {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select()
        .from(salesforceSubscriptionPreferences)
        .where(
          inArray(salesforceSubscriptionPreferences.salesforceRecordId, [
            ...new Set(ids),
          ]),
        );
      return new Map(
        rows.map((row) => [row.salesforceRecordId, mirrorFromRow(row)]),
      );
    },
    async loadContacts(records) {
      // Three batched lookups instead of one query per record. Stored
      // emails are already lowercase (contacts.primary_email and the email
      // identities), so plain equality uses the indexes.
      const emails = [
        ...new Set(records.map((record) => record.email.trim().toLowerCase())),
      ];
      const salesforceContactIds = [
        ...new Set(
          records.flatMap((record) =>
            record.salesforceContactId === null
              ? []
              : [record.salesforceContactId],
          ),
        ),
      ];
      const bySalesforceId = new Map<string, Set<string>>();
      const byEmail = new Map<string, Set<string>>();
      const add = (
        map: Map<string, Set<string>>,
        key: string | null,
        contactId: string,
      ) => {
        if (key === null) return;
        const values = map.get(key) ?? new Set<string>();
        values.add(contactId);
        map.set(key, values);
      };
      for (const chunk of chunked(salesforceContactIds, 1000)) {
        const rows = await db
          .select({
            id: contacts.id,
            salesforceContactId: contacts.salesforceContactId,
          })
          .from(contacts)
          .where(inArray(contacts.salesforceContactId, chunk));
        for (const row of rows) add(bySalesforceId, row.salesforceContactId, row.id);
      }
      for (const chunk of chunked(emails, 1000)) {
        const identityRows = await db
          .select({
            id: contactIdentities.contactId,
            email: contactIdentities.normalizedValue,
          })
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.kind, "email"),
              inArray(contactIdentities.normalizedValue, chunk),
            ),
          );
        for (const row of identityRows) add(byEmail, row.email, row.id);
        const primaryRows = await db
          .select({ id: contacts.id, email: contacts.primaryEmail })
          .from(contacts)
          .where(inArray(contacts.primaryEmail, chunk));
        for (const row of primaryRows) add(byEmail, row.email, row.id);
      }
      const result = new Map<string, readonly string[]>();
      for (const record of records) {
        const matched = new Set<string>([
          ...(record.salesforceContactId === null
            ? []
            : (bySalesforceId.get(record.salesforceContactId) ?? [])),
          ...(byEmail.get(record.email.trim().toLowerCase()) ?? []),
        ]);
        result.set(record.salesforceRecordId, [...matched]);
      }
      return result;
    },
    async loadProjectsByBox() {
      const rows = await db
        .select({
          projectId: projectDimensions.projectId,
          subscriptionBox: projectDimensions.subscriptionBox,
          connectedToProjectId: projectDimensions.connectedToProjectId,
        })
        .from(projectDimensions);
      const boxes = new Map(
        rows.flatMap((row) =>
          row.subscriptionBox === null
            ? []
            : [[row.projectId, row.subscriptionBox] as const],
        ),
      );
      const result = new Map<string, string[]>();
      for (const row of rows) {
        const box =
          row.subscriptionBox ??
          (row.connectedToProjectId === null
            ? undefined
            : boxes.get(row.connectedToProjectId));
        if (box === undefined) continue;
        const projectIds = result.get(box) ?? [];
        projectIds.push(row.projectId);
        result.set(box, projectIds);
      }
      return result;
    },
    async loadPlatformState(input) {
      const emails = [
        ...new Set(input.emails.map((email) => email.trim().toLowerCase())),
      ];
      const contactIds = [...new Set(input.contactIds)];
      const [consents, subscribers, suppressions, hardSuppressions] =
        await Promise.all([
          contactIds.length === 0
            ? Promise.resolve([])
            : db
                .select()
                .from(contactConsent)
                .where(inArray(contactConsent.contactId, contactIds)),
          emails.length === 0
            ? Promise.resolve([])
            : db
                .select()
                .from(newsletterSubscribers)
                .where(inArray(newsletterSubscribers.email, emails)),
          emails.length === 0
            ? Promise.resolve([])
            : db
                .select()
                .from(newsletterSuppressions)
                .where(inArray(newsletterSuppressions.email, emails)),
          emails.length === 0
            ? Promise.resolve([])
            : db
                .select({ email: suppressionList.normalizedEmail })
                .from(suppressionList)
                .where(inArray(suppressionList.normalizedEmail, emails)),
        ]);
      const consentsByContact = new Map<string, ConsentState[]>();
      for (const row of consents) {
        const values = consentsByContact.get(row.contactId) ?? [];
        values.push({
          id: row.id,
          contactId: row.contactId,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          optedOutAt: row.optedOutAt.toISOString(),
        });
        consentsByContact.set(row.contactId, values);
      }
      return {
        consentsByContact,
        newsletterSubscribersByEmail: new Map(
          subscribers.map((row) => [
            row.email,
            {
              status: row.status,
              lastChangedAt: row.lastChangedAt?.toISOString() ?? null,
            },
          ]),
        ),
        newsletterSuppressionsByEmail: new Map(
          suppressions.map((row) => [
            row.email,
            { reason: row.reason, updatedAt: row.updatedAt.toISOString() },
          ]),
        ),
        suppressionEmails: new Set(hardSuppressions.map((row) => row.email)),
      };
    },
    async persistBatch(input) {
      await db.transaction(async (tx) => {
        for (const mirror of input.mirrorUpserts) {
          const values = mirrorInsert(mirror);
          await tx
            .insert(salesforceSubscriptionPreferences)
            .values(values)
            .onConflictDoUpdate({
              target: salesforceSubscriptionPreferences.salesforceRecordId,
              set: values,
            });
        }
        for (const event of input.events) {
          await tx.insert(salesforceSubscriptionReadbackEvents).values({
            id: event.id,
            salesforceRecordId: event.salesforceRecordId,
            email: event.email,
            field: event.field,
            projectBox: event.projectBox,
            fromValue: event.fromValue,
            toValue: event.toValue,
            sfModifiedAt: new Date(event.sfModifiedAt),
            sfModifiedByUsername: event.sfModifiedByUsername,
            mode: input.mode,
            outcome: event.outcome,
            contactsMatched: event.contactsMatched,
            rowsChanged: 0,
          });
          let changed = 0;
          if (input.mode === "apply" && event.outcome === "applied")
            for (const action of event.actions) {
              if (action.kind === "insert_consent") {
                const rows = await tx
                  .insert(contactConsent)
                  .values({
                    id: crypto.randomUUID(),
                    contactId: action.contactId,
                    scopeType: action.scopeType,
                    scopeId: action.scopeId,
                    source: "salesforce",
                    sourceRunId: null,
                    optedOutAt: new Date(action.optedOutAt),
                    createdAt: new Date(),
                  })
                  .onConflictDoNothing()
                  .returning({ id: contactConsent.id });
                changed += rows.length;
              } else if (action.kind === "clear_consent") {
                if (action.consentIds.length === 0) continue;
                const rows = await tx
                  .select()
                  .from(contactConsent)
                  .where(inArray(contactConsent.id, [...action.consentIds]));
                for (const row of rows)
                  await tx
                    .insert(contactConsentClears)
                    .values({
                      id: crypto.randomUUID(),
                      consentId: row.id,
                      contactId: row.contactId,
                      scopeType: row.scopeType,
                      scopeId: row.scopeId,
                      source: row.source,
                      sourceRunId: row.sourceRunId,
                      optedOutAt: row.optedOutAt,
                      clearedAt: new Date(),
                      clearedBySource: "salesforce",
                      salesforceRecordId: event.salesforceRecordId,
                      readbackEventId: event.id,
                    });
                if (rows.length > 0) {
                  await tx.delete(contactConsent).where(
                    inArray(
                      contactConsent.id,
                      rows.map((row) => row.id),
                    ),
                  );
                  changed += rows.length;
                }
              } else if (action.kind === "insert_suppression") {
                const rows = await tx
                  .insert(newsletterSuppressions)
                  .values({
                    email: action.email,
                    reason: "platform_optout",
                    source: "salesforce",
                  })
                  .onConflictDoNothing()
                  .returning({ id: newsletterSuppressions.id });
                changed += rows.length;
              } else if (action.kind === "delete_suppression") {
                const rows = await tx
                  .delete(newsletterSuppressions)
                  .where(
                    and(
                      eq(newsletterSuppressions.email, action.email),
                      sql`${newsletterSuppressions.reason} IN ('platform_optout', 'unsubscribed')`,
                    ),
                  )
                  .returning({ id: newsletterSuppressions.id });
                changed += rows.length;
              } else {
                const existing = await tx
                  .select({ id: newsletterSubscribers.id })
                  .from(newsletterSubscribers)
                  .where(eq(newsletterSubscribers.email, action.email))
                  .limit(1);
                if (existing.length === 0) {
                  await tx
                    .insert(newsletterSubscribers)
                    .values({
                      email: action.email,
                      status: "subscribed",
                      source: "salesforce",
                      optinTime: new Date(action.changedAt),
                      lastChangedAt: new Date(action.changedAt),
                    });
                  changed += 1;
                } else {
                  // Only flip a subscriber who isn't subscribed. An already
                  // subscribed row keeps its source (e.g. mailchimp_import)
                  // and its newer last_changed_at.
                  const rows = await tx
                    .update(newsletterSubscribers)
                    .set({
                      status: "subscribed",
                      source: "salesforce",
                      lastChangedAt: new Date(action.changedAt),
                      updatedAt: new Date(),
                    })
                    .where(
                      and(
                        eq(newsletterSubscribers.email, action.email),
                        sql`${newsletterSubscribers.status} <> 'subscribed'`,
                      ),
                    )
                    .returning({ id: newsletterSubscribers.id });
                  changed += rows.length;
                }
              }
            }
          await tx
            .update(salesforceSubscriptionReadbackEvents)
            .set({ rowsChanged: changed })
            .where(eq(salesforceSubscriptionReadbackEvents.id, event.id));
        }
      });
    },
  };
}
