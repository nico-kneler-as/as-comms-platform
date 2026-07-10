import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  BroadcastOpenRecord,
  BroadcastOpenRecordInput,
} from "@as-comms/contracts";

import {
  mapBroadcastOpenInsert,
  mapBroadcastOpenRow,
  type BroadcastOpenRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { broadcastOpens } from "./schema/index.js";

type BroadcastOpensDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

function toBroadcastOpenRow(
  row: typeof broadcastOpens.$inferSelect,
): BroadcastOpenRow {
  return {
    id: row.id,
    campaign_run_id: row.campaignRunId,
    audience_snapshot_id: row.audienceSnapshotId,
    contact_id: row.contactId,
    opened_at: row.openedAt,
    user_agent: row.userAgent,
    platform: row.platform,
    client: row.client,
    os: row.os,
    geo: row.geo,
    is_bot: row.isBot,
    bot_reason: row.botReason,
    idempotency_key: row.idempotencyKey,
    created_at: row.createdAt,
  };
}

export async function insertBroadcastOpen(
  db: BroadcastOpensDatabase,
  record: BroadcastOpenRecordInput,
): Promise<boolean> {
  const values = mapBroadcastOpenInsert(record);
  const [row] = await db
    .insert(broadcastOpens)
    .values(values)
    .onConflictDoNothing({
      target: broadcastOpens.idempotencyKey,
    })
    .returning({ id: broadcastOpens.id });

  return row !== undefined;
}

export async function listBroadcastOpensForRun(
  db: BroadcastOpensDatabase,
  runId: string,
): Promise<readonly BroadcastOpenRecord[]> {
  const rows = await db
    .select()
    .from(broadcastOpens)
    .where(eq(broadcastOpens.campaignRunId, runId))
    .orderBy(asc(broadcastOpens.openedAt), asc(broadcastOpens.id));

  return rows.map((row) => mapBroadcastOpenRow(toBroadcastOpenRow(row)));
}
