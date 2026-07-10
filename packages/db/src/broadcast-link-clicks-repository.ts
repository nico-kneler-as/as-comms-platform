import { asc, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  broadcastLinkClickAggregateSchema,
  type BroadcastLinkClickAggregate,
  type BroadcastLinkClickRecord,
  type BroadcastLinkClickRecordInput,
} from "@as-comms/contracts";

import {
  mapBroadcastLinkClickInsert,
  mapBroadcastLinkClickRow,
  type BroadcastLinkClickRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { broadcastLinkClicks } from "./schema/index.js";

type BroadcastLinkClicksDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

function toBroadcastLinkClickRow(
  row: typeof broadcastLinkClicks.$inferSelect,
): BroadcastLinkClickRow {
  return {
    id: row.id,
    campaign_run_id: row.campaignRunId,
    audience_snapshot_id: row.audienceSnapshotId,
    contact_id: row.contactId,
    original_link: row.originalLink,
    clicked_at: row.clickedAt,
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

export async function insertBroadcastLinkClick(
  db: BroadcastLinkClicksDatabase,
  record: BroadcastLinkClickRecordInput,
): Promise<boolean> {
  const values = mapBroadcastLinkClickInsert(record);
  const [row] = await db
    .insert(broadcastLinkClicks)
    .values(values)
    .onConflictDoNothing({
      target: broadcastLinkClicks.idempotencyKey,
    })
    .returning({ id: broadcastLinkClicks.id });

  return row !== undefined;
}

export async function aggregateBroadcastLinkClicksByRunId(
  db: BroadcastLinkClicksDatabase,
  runId: string,
): Promise<readonly BroadcastLinkClickAggregate[]> {
  const totalClicks = sql<number>`count(*)::int`;
  const uniqueClickers = sql<number>`
    count(
      distinct coalesce(
        ${broadcastLinkClicks.contactId},
        ${broadcastLinkClicks.audienceSnapshotId}
      )
    )::int
  `;

  const rows = await db
    .select({
      originalLink: broadcastLinkClicks.originalLink,
      totalClicks,
      uniqueClickers,
    })
    .from(broadcastLinkClicks)
    .where(eq(broadcastLinkClicks.campaignRunId, runId))
    .groupBy(broadcastLinkClicks.originalLink)
    .orderBy(desc(totalClicks), asc(broadcastLinkClicks.originalLink));

  return rows.map((row) =>
    broadcastLinkClickAggregateSchema.parse({
      originalLink: row.originalLink,
      totalClicks: row.totalClicks,
      uniqueClickers: row.uniqueClickers,
    }),
  );
}

export async function listBroadcastLinkClicksForRun(
  db: BroadcastLinkClicksDatabase,
  runId: string,
): Promise<readonly BroadcastLinkClickRecord[]> {
  const rows = await db
    .select()
    .from(broadcastLinkClicks)
    .where(eq(broadcastLinkClicks.campaignRunId, runId))
    .orderBy(
      asc(broadcastLinkClicks.clickedAt),
      asc(broadcastLinkClicks.originalLink),
      asc(broadcastLinkClicks.id),
    );

  return rows.map((row) => mapBroadcastLinkClickRow(toBroadcastLinkClickRow(row)));
}
