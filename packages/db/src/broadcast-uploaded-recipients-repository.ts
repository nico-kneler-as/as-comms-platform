import { randomUUID } from "node:crypto";

import { asc, count, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  BroadcastUploadedRecipientInput,
  BroadcastUploadedRecipientRecord,
} from "@as-comms/contracts";

import {
  mapBroadcastUploadedRecipientInsert,
  mapBroadcastUploadedRecipientRow,
  type BroadcastUploadedRecipientRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { broadcastUploadedRecipients } from "./schema/index.js";

type BroadcastUploadedRecipientsDatabase = PgDatabase<
  PgQueryResultHKT,
  DatabaseSchema
>;

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (!Array.isArray(result)) {
    return ("rows" in result ? result.rows : undefined) ?? [];
  }

  return result as readonly TRow[];
}

function toBroadcastUploadedRecipientRow(
  row: typeof broadcastUploadedRecipients.$inferSelect,
): BroadcastUploadedRecipientRow {
  return {
    id: row.id,
    campaign_run_id: row.campaignRunId,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    created_at: row.createdAt,
  };
}

export async function replaceBroadcastUploadedRecipientsForRun(
  db: BroadcastUploadedRecipientsDatabase,
  runId: string,
  rows: readonly BroadcastUploadedRecipientInput[],
): Promise<void> {
  await db
    .delete(broadcastUploadedRecipients)
    .where(eq(broadcastUploadedRecipients.campaignRunId, runId));

  if (rows.length === 0) {
    return;
  }

  const uploadedAt = Date.now();
  await db.insert(broadcastUploadedRecipients).values(
    rows.map((row, index) => ({
      id: randomUUID(),
      campaignRunId: runId,
      ...mapBroadcastUploadedRecipientInsert({
        ...row,
        email: row.email.trim().toLowerCase(),
      }),
      createdAt: new Date(uploadedAt + index),
    })),
  );
}

export async function listBroadcastUploadedRecipientsForRun(
  db: BroadcastUploadedRecipientsDatabase,
  runId: string,
): Promise<readonly BroadcastUploadedRecipientRecord[]> {
  const rows = await db
    .select()
    .from(broadcastUploadedRecipients)
    .where(eq(broadcastUploadedRecipients.campaignRunId, runId))
    .orderBy(
      asc(broadcastUploadedRecipients.createdAt),
      asc(broadcastUploadedRecipients.id),
    );

  return normalizeSqlResultRows(rows).map((row) =>
    mapBroadcastUploadedRecipientRow(toBroadcastUploadedRecipientRow(row)),
  );
}

export async function countBroadcastUploadedRecipientsForRun(
  db: BroadcastUploadedRecipientsDatabase,
  runId: string,
): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(broadcastUploadedRecipients)
    .where(eq(broadcastUploadedRecipients.campaignRunId, runId));

  return normalizeSqlResultRows(result)[0]?.value ?? 0;
}
