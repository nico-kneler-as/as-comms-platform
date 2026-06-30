import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { MediaAssetRecord } from "@as-comms/contracts";

import {
  mapMediaAssetInsert,
  mapMediaAssetRow,
  type MediaAssetRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { broadcastMediaAssets } from "./schema/index.js";

type MediaAssetsDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

type MediaAssetCursorKey = Readonly<{
  createdAt: string;
  id: string;
}>;

export interface CreateMediaAssetInput {
  readonly uploaderId: string | null;
  readonly storageKey: string;
  readonly publicUrl: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface ListMediaAssetsInput {
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface ListMediaAssetsResult {
  readonly items: readonly MediaAssetRecord[];
  readonly nextCursor: string | null;
}

function encodeCursor(key: MediaAssetCursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): MediaAssetCursorKey {
  const parsed = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Partial<MediaAssetCursorKey>;

  if (
    typeof parsed.id !== "string" ||
    parsed.id.length === 0 ||
    typeof parsed.createdAt !== "string" ||
    Number.isNaN(Date.parse(parsed.createdAt))
  ) {
    throw new Error("Invalid media asset cursor.");
  }

  return {
    id: parsed.id,
    createdAt: parsed.createdAt,
  };
}

function toMediaAssetRow(
  row: typeof broadcastMediaAssets.$inferSelect,
): MediaAssetRow {
  return {
    id: row.id,
    uploader_id: row.uploaderId,
    storage_key: row.storageKey,
    public_url: row.publicUrl,
    filename: row.filename,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export async function createMediaAsset(
  db: MediaAssetsDatabase,
  input: CreateMediaAssetInput,
): Promise<MediaAssetRecord> {
  const values = mapMediaAssetInsert({
    uploaderId: input.uploaderId,
    storageKey: input.storageKey,
    publicUrl: input.publicUrl,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  const [row] = await db.insert(broadcastMediaAssets).values(values).returning();
  if (row === undefined) {
    throw new Error("Failed to create media asset.");
  }

  return mapMediaAssetRow(toMediaAssetRow(row));
}

export async function listMediaAssets(
  db: MediaAssetsDatabase,
  input: ListMediaAssetsInput,
): Promise<ListMediaAssetsResult> {
  const cursor =
    input.cursor === undefined || input.cursor === null
      ? null
      : decodeCursor(input.cursor);

  const rows = await db
    .select()
    .from(broadcastMediaAssets)
    .where(
      cursor === null
        ? isNull(broadcastMediaAssets.deletedAt)
        : and(
            isNull(broadcastMediaAssets.deletedAt),
            or(
              lt(broadcastMediaAssets.createdAt, new Date(cursor.createdAt)),
              and(
                eq(broadcastMediaAssets.createdAt, new Date(cursor.createdAt)),
                lt(broadcastMediaAssets.id, cursor.id),
              ),
            ),
          ),
    )
    .orderBy(desc(broadcastMediaAssets.createdAt), desc(broadcastMediaAssets.id))
    .limit(input.limit + 1);

  const hasNextPage = rows.length > input.limit;
  const pageRows = hasNextPage ? rows.slice(0, input.limit) : rows;
  const items = pageRows.map((row) => mapMediaAssetRow(toMediaAssetRow(row)));
  const lastItem = items.at(-1) ?? null;

  return {
    items,
    nextCursor:
      hasNextPage && lastItem !== null
        ? encodeCursor({
            id: lastItem.id,
            createdAt: lastItem.createdAt,
          })
        : null,
  };
}

export async function countMediaAssets(
  db: MediaAssetsDatabase,
): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(broadcastMediaAssets)
    .where(isNull(broadcastMediaAssets.deletedAt));

  return result[0]?.value ?? 0;
}

export async function getMediaAssetById(
  db: MediaAssetsDatabase,
  id: string,
): Promise<MediaAssetRecord | null> {
  const [row] = await db
    .select()
    .from(broadcastMediaAssets)
    .where(eq(broadcastMediaAssets.id, id))
    .limit(1);

  return row === undefined ? null : mapMediaAssetRow(toMediaAssetRow(row));
}

export async function softDeleteMediaAsset(
  db: MediaAssetsDatabase,
  id: string,
): Promise<void> {
  await db
    .update(broadcastMediaAssets)
    .set({ deletedAt: new Date() })
    .where(eq(broadcastMediaAssets.id, id));
}
