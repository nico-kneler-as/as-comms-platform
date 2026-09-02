import { randomUUID } from "node:crypto";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { DatabaseSchema } from "./schema/index.js";
import { broadcastWebVersions } from "./schema/index.js";

type BroadcastWebVersionsDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

export interface BroadcastWebVersionRecord {
  readonly id: string;
  readonly campaignRunId: string;
  readonly publicToken: string;
  readonly title: string | null;
  readonly renderedHtml: string | null;
  readonly renderedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly unpublishedAt: Date | null;
  readonly publishChangedByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function mapRow(
  row: typeof broadcastWebVersions.$inferSelect,
): BroadcastWebVersionRecord {
  return {
    id: row.id,
    campaignRunId: row.campaignRunId,
    publicToken: row.publicToken,
    title: row.title,
    renderedHtml: row.renderedHtml,
    renderedAt: row.renderedAt,
    publishedAt: row.publishedAt,
    unpublishedAt: row.unpublishedAt,
    publishChangedByUserId: row.publishChangedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findBroadcastWebVersionByRunId(
  db: BroadcastWebVersionsDatabase,
  runId: string,
): Promise<BroadcastWebVersionRecord | null> {
  const [row] = await db
    .select()
    .from(broadcastWebVersions)
    .where(eq(broadcastWebVersions.campaignRunId, runId))
    .limit(1);
  return row === undefined ? null : mapRow(row);
}

export async function ensureBroadcastWebVersion(
  db: BroadcastWebVersionsDatabase,
  runId: string,
): Promise<BroadcastWebVersionRecord> {
  const existing = await findBroadcastWebVersionByRunId(db, runId);
  if (existing !== null) {
    return existing;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    await db
      .insert(broadcastWebVersions)
      .values({
        id: randomUUID(),
        campaignRunId: runId,
        publicToken: randomUUID(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const row = await findBroadcastWebVersionByRunId(db, runId);
    if (row !== null) {
      return row;
    }
  }

  throw new Error(`Failed to ensure broadcast web version for run ${runId}.`);
}

export async function findPublishedBroadcastWebVersionByToken(
  db: BroadcastWebVersionsDatabase,
  token: string,
): Promise<BroadcastWebVersionRecord | null> {
  const [row] = await db
    .select()
    .from(broadcastWebVersions)
    .where(
      and(
        eq(broadcastWebVersions.publicToken, token),
        isNotNull(broadcastWebVersions.renderedHtml),
        isNull(broadcastWebVersions.unpublishedAt),
      ),
    )
    .limit(1);
  return row === undefined ? null : mapRow(row);
}

export async function storeBroadcastWebVersionHtml(
  db: BroadcastWebVersionsDatabase,
  runId: string,
  input: { readonly html: string; readonly title: string },
): Promise<BroadcastWebVersionRecord> {
  const now = new Date();
  const [stored] = await db
    .update(broadcastWebVersions)
    .set({
      renderedHtml: input.html,
      title: input.title,
      renderedAt: now,
      publishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(broadcastWebVersions.campaignRunId, runId),
        isNull(broadcastWebVersions.renderedHtml),
      ),
    )
    .returning();

  if (stored !== undefined) {
    return mapRow(stored);
  }

  const existing = await findBroadcastWebVersionByRunId(db, runId);
  if (existing === null) {
    throw new Error(`Broadcast web version for run ${runId} was not found.`);
  }
  return existing;
}

export async function setBroadcastWebVersionPublished(
  db: BroadcastWebVersionsDatabase,
  runId: string,
  input: { readonly published: boolean; readonly userId: string | null },
): Promise<BroadcastWebVersionRecord> {
  const [row] = await db
    .update(broadcastWebVersions)
    .set({
      unpublishedAt: input.published ? null : new Date(),
      publishChangedByUserId: input.userId,
      updatedAt: new Date(),
    })
    .where(eq(broadcastWebVersions.campaignRunId, runId))
    .returning();
  if (row === undefined) {
    throw new Error(`Broadcast web version for run ${runId} was not found.`);
  }
  return mapRow(row);
}
