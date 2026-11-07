import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";

import type {
  SalesforceSubscriptionOutboxEventKind,
  SalesforceSubscriptionOutboxRow,
} from "@as-comms/contracts";

import type { Stage1Database } from "./repositories.js";
import {
  contacts,
  projectDimensions,
  salesforceSubscriptionOutbox,
} from "./schema/index.js";

const claimTimeoutMs = 10 * 60 * 1000;
const maxAttempts = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapRow(
  row: typeof salesforceSubscriptionOutbox.$inferSelect,
): SalesforceSubscriptionOutboxRow {
  return {
    id: row.id,
    email: row.email,
    contactId: row.contactId,
    eventKind: row.eventKind,
    projectId: row.projectId,
    occurredAt: row.occurredAt.toISOString(),
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    lastErrorKind: row.lastErrorKind,
    lastErrorCode: row.lastErrorCode,
    sentAt: row.sentAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function enqueueSalesforceSubscriptionEvent(
  db: Stage1Database,
  input: {
    readonly email: string;
    readonly contactId?: string | null;
    readonly eventKind: SalesforceSubscriptionOutboxEventKind;
    readonly projectId?: string | null;
    readonly occurredAt: Date;
  },
): Promise<void> {
  await db.insert(salesforceSubscriptionOutbox).values({
    id: crypto.randomUUID(),
    email: normalizeEmail(input.email),
    contactId: input.contactId ?? null,
    eventKind: input.eventKind,
    projectId: input.projectId ?? null,
    occurredAt: input.occurredAt,
  });
}

export interface SalesforceSubscriptionOutboxRepository {
  claimPending(
    limit: number,
    now: Date,
  ): Promise<readonly SalesforceSubscriptionOutboxRow[]>;
  markSent(
    rowIds: readonly string[],
    sentAt: Date,
    lastErrorCode?: string | null,
  ): Promise<number>;
  markTransient(
    rowIds: readonly string[],
    now: Date,
    errorCode: string,
  ): Promise<{ readonly retried: number; readonly parked: number }>;
  markParked(
    rowIds: readonly string[],
    errorKind: "permanent" | "permission",
    errorCode: string,
  ): Promise<number>;
  deferPermission(
    rowIds: readonly string[],
    now: Date,
    errorCode: string,
  ): Promise<number>;
  countByStatus(): Promise<{ readonly pending: number; readonly parked: number }>;
  listProjectHosts(projectIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  listSalesforceContactIds(
    contactIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export function createSalesforceSubscriptionOutboxRepository(
  db: Stage1Database,
): SalesforceSubscriptionOutboxRepository {
  return {
    async claimPending(limit, now) {
      if (limit <= 0) return [];
      return db.transaction(async (tx) => {
        const expiredAt = new Date(now.getTime() - claimTimeoutMs);
        const rows = await tx
          .select()
          .from(salesforceSubscriptionOutbox)
          .where(
            and(
              eq(salesforceSubscriptionOutbox.status, "pending"),
              lte(salesforceSubscriptionOutbox.nextAttemptAt, now),
              or(
                isNull(salesforceSubscriptionOutbox.claimedAt),
                lte(salesforceSubscriptionOutbox.claimedAt, expiredAt),
              ),
            ),
          )
          .orderBy(
            asc(salesforceSubscriptionOutbox.occurredAt),
            asc(salesforceSubscriptionOutbox.createdAt),
          )
          .limit(limit)
          .for("update", { skipLocked: true });
        if (rows.length === 0) return [];
        // Pull in every other pending row for the same emails, even ones
        // still in backoff. Otherwise an older row retried later (e.g. a
        // sign-up) could land after a newer one (an opt-out) and undo it.
        // Collapsing all of an email's rows by occurred_at keeps the newest
        // choice winning.
        const firstIds = rows.map((row) => row.id);
        const emails = [...new Set(rows.map((row) => row.email))];
        const siblings = await tx
          .select()
          .from(salesforceSubscriptionOutbox)
          .where(
            and(
              eq(salesforceSubscriptionOutbox.status, "pending"),
              inArray(salesforceSubscriptionOutbox.email, emails),
              notInArray(salesforceSubscriptionOutbox.id, firstIds),
              or(
                isNull(salesforceSubscriptionOutbox.claimedAt),
                lte(salesforceSubscriptionOutbox.claimedAt, expiredAt),
              ),
            ),
          )
          .for("update", { skipLocked: true });
        const claimed = [...rows, ...siblings];
        const rowIds = claimed.map((row) => row.id);
        await tx
          .update(salesforceSubscriptionOutbox)
          .set({ claimedAt: now })
          .where(inArray(salesforceSubscriptionOutbox.id, rowIds));
        return claimed.map((row) => mapRow({ ...row, claimedAt: now }));
      });
    },

    async markSent(rowIds, sentAt, lastErrorCode = null) {
      if (rowIds.length === 0) return 0;
      const rows = await db
        .update(salesforceSubscriptionOutbox)
        .set({
          status: "sent",
          sentAt,
          claimedAt: null,
          lastErrorKind: null,
          lastErrorCode,
        })
        .where(
          and(
            inArray(salesforceSubscriptionOutbox.id, [...rowIds]),
            eq(salesforceSubscriptionOutbox.status, "pending"),
          ),
        )
        .returning({ id: salesforceSubscriptionOutbox.id });
      return rows.length;
    },

    async markTransient(rowIds, now, errorCode) {
      if (rowIds.length === 0) return { retried: 0, parked: 0 };
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: salesforceSubscriptionOutbox.id,
            attempts: salesforceSubscriptionOutbox.attempts,
          })
          .from(salesforceSubscriptionOutbox)
          .where(
            and(
              inArray(salesforceSubscriptionOutbox.id, [...rowIds]),
              eq(salesforceSubscriptionOutbox.status, "pending"),
            ),
          )
          .for("update");
        let retried = 0;
        let parked = 0;
        for (const row of rows) {
          const attempts = row.attempts + 1;
          if (attempts >= maxAttempts) {
            await tx
              .update(salesforceSubscriptionOutbox)
              .set({
                status: "parked",
                attempts,
                claimedAt: null,
                lastErrorKind: "transient",
                lastErrorCode: errorCode,
              })
              .where(eq(salesforceSubscriptionOutbox.id, row.id));
            parked += 1;
            continue;
          }
          const delayMinutes = Math.min(2 ** attempts, 6 * 60);
          await tx
            .update(salesforceSubscriptionOutbox)
            .set({
              attempts,
              nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
              claimedAt: null,
              lastErrorKind: "transient",
              lastErrorCode: errorCode,
            })
            .where(eq(salesforceSubscriptionOutbox.id, row.id));
          retried += 1;
        }
        return { retried, parked };
      });
    },

    async markParked(rowIds, errorKind, errorCode) {
      if (rowIds.length === 0) return 0;
      const rows = await db
        .update(salesforceSubscriptionOutbox)
        .set({
          status: "parked",
          claimedAt: null,
          lastErrorKind: errorKind,
          lastErrorCode: errorCode,
        })
        .where(
          and(
            inArray(salesforceSubscriptionOutbox.id, [...rowIds]),
            eq(salesforceSubscriptionOutbox.status, "pending"),
          ),
        )
        .returning({ id: salesforceSubscriptionOutbox.id });
      return rows.length;
    },

    async deferPermission(rowIds, now, errorCode) {
      if (rowIds.length === 0) return 0;
      const rows = await db
        .update(salesforceSubscriptionOutbox)
        .set({
          nextAttemptAt: new Date(now.getTime() + 15 * 60_000),
          claimedAt: null,
          lastErrorKind: "permission",
          lastErrorCode: errorCode,
        })
        .where(
          and(
            inArray(salesforceSubscriptionOutbox.id, [...rowIds]),
            eq(salesforceSubscriptionOutbox.status, "pending"),
          ),
        )
        .returning({ id: salesforceSubscriptionOutbox.id });
      return rows.length;
    },

    async countByStatus() {
      const rows = await db
        .select({
          status: salesforceSubscriptionOutbox.status,
          value: count(),
        })
        .from(salesforceSubscriptionOutbox)
        .where(
          inArray(salesforceSubscriptionOutbox.status, ["pending", "parked"]),
        )
        .groupBy(salesforceSubscriptionOutbox.status);
      return {
        pending: rows.find((row) => row.status === "pending")?.value ?? 0,
        parked: rows.find((row) => row.status === "parked")?.value ?? 0,
      };
    },

    async listProjectHosts(projectIds) {
      if (projectIds.length === 0) return new Map();
      const rows = await db
        .select({
          projectId: projectDimensions.projectId,
          hostProjectId: projectDimensions.connectedToProjectId,
        })
        .from(projectDimensions)
        .where(inArray(projectDimensions.projectId, [...projectIds]));
      return new Map(
        rows.flatMap((row) =>
          row.hostProjectId === null
            ? []
            : [[row.projectId, row.hostProjectId] as const],
        ),
      );
    },

    async listSalesforceContactIds(contactIds) {
      if (contactIds.length === 0) return new Map();
      const rows = await db
        .select({ id: contacts.id, salesforceContactId: contacts.salesforceContactId })
        .from(contacts)
        .where(inArray(contacts.id, [...contactIds]));
      return new Map(
        rows.flatMap((row) =>
          row.salesforceContactId === null
            ? []
            : [[row.id, row.salesforceContactId] as const],
        ),
      );
    },
  };
}
