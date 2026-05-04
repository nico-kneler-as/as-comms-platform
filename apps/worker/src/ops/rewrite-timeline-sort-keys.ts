#!/usr/bin/env tsx
/**
 * rewrite-timeline-sort-keys
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:rewrite-timeline-sort-keys
 *   pnpm --filter @as-comms/worker ops:rewrite-timeline-sort-keys --limit 100
 *   pnpm --filter @as-comms/worker ops:rewrite-timeline-sort-keys --execute
 *
 * Dry-run by default. Recomputes lifecycle timeline sort keys using the current
 * canonical lifecycle ordinal tiebreak and updates only rows whose sort key
 * changed.
 */
import process from "node:process";

import { asc, eq, inArray } from "drizzle-orm";

import {
  canonicalEventTypeValues,
  type CanonicalEventRecord
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  contactTimelineProjection,
  createDatabaseConnection,
  type Stage1Database
} from "@as-comms/db";
import { buildTimelineSortKey } from "@as-comms/domain";
import { toIsoTimestamp } from "@as-comms/integrations";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag
} from "./helpers.js";

const sampleLimit = 10;
const updateBatchSize = 500;

const lifecycleEventTypes = canonicalEventTypeValues.filter((eventType) =>
  eventType.startsWith("lifecycle.")
) as readonly CanonicalEventRecord["eventType"][];

interface Logger {
  error(...args: readonly unknown[]): void;
}

interface RewriteTimelineSortKeyCandidate {
  readonly id: string;
  readonly canonicalEventId: string;
  readonly occurredAt: string;
  readonly eventType: CanonicalEventRecord["eventType"];
  readonly oldSortKey: string;
  readonly newSortKey: string;
}

export interface RewriteTimelineSortKeysResult {
  readonly dryRun: boolean;
  readonly scannedCount: number;
  readonly updatedCount: number;
  readonly sample: readonly {
    readonly id: string;
    readonly canonicalEventId: string;
    readonly eventType: CanonicalEventRecord["eventType"];
    readonly oldSortKey: string;
    readonly newSortKey: string;
  }[];
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command."
    );
  }

  return connectionString;
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeOccurredAt(value: Date): string {
  const normalized = toIsoTimestamp(value);

  if (normalized === null) {
    throw new Error(
      "Expected contact_timeline_projection.occurred_at to be a valid timestamp."
    );
  }

  return normalized;
}

async function loadCandidates(input: {
  readonly db: Stage1Database;
  readonly limit: number | null;
}): Promise<{
  readonly scannedCount: number;
  readonly candidates: readonly RewriteTimelineSortKeyCandidate[];
}> {
  const rows = await input.db
    .select({
      id: contactTimelineProjection.id,
      canonicalEventId: contactTimelineProjection.canonicalEventId,
      occurredAt: contactTimelineProjection.occurredAt,
      eventType: contactTimelineProjection.eventType,
      sortKey: contactTimelineProjection.sortKey
    })
    .from(contactTimelineProjection)
    .where(inArray(contactTimelineProjection.eventType, [...lifecycleEventTypes]))
    .orderBy(
      asc(contactTimelineProjection.occurredAt),
      asc(contactTimelineProjection.canonicalEventId)
    );

  const limitedRows = input.limit === null ? rows : rows.slice(0, input.limit);

  const candidates = limitedRows
    .map((row) => {
      const occurredAt = normalizeOccurredAt(row.occurredAt);

      return {
        id: row.id,
        canonicalEventId: row.canonicalEventId,
        occurredAt,
        eventType: row.eventType,
        oldSortKey: row.sortKey,
        newSortKey: buildTimelineSortKey(
          row.canonicalEventId,
          occurredAt,
          row.eventType
        )
      };
    })
    .filter((row) => row.oldSortKey !== row.newSortKey);

  return {
    scannedCount: limitedRows.length,
    candidates
  };
}

async function applyUpdates(input: {
  readonly db: Stage1Database;
  readonly candidates: readonly RewriteTimelineSortKeyCandidate[];
}): Promise<number> {
  let updatedCount = 0;

  for (const batch of chunkValues(input.candidates, updateBatchSize)) {
    await input.db.transaction(async (tx) => {
      for (const candidate of batch) {
        await tx
          .update(contactTimelineProjection)
          .set({
            sortKey: candidate.newSortKey,
            updatedAt: new Date()
          })
          .where(eq(contactTimelineProjection.id, candidate.id));
      }
    });

    updatedCount += batch.length;
  }

  return updatedCount;
}

export async function rewriteTimelineSortKeys(input: {
  readonly db: Stage1Database;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: Logger;
}): Promise<RewriteTimelineSortKeysResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;
  const { scannedCount, candidates } = await loadCandidates({
    db: input.db,
    limit: input.limit ?? null
  });
  const updatedCount = dryRun
    ? 0
    : await applyUpdates({
        db: input.db,
        candidates
      });
  const sample = candidates.slice(0, sampleLimit).map((candidate) => ({
    id: candidate.id,
    canonicalEventId: candidate.canonicalEventId,
    eventType: candidate.eventType,
    oldSortKey: candidate.oldSortKey,
    newSortKey: candidate.newSortKey
  }));

  logger.error("rewrite-timeline-sort-keys");
  logger.error(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  logger.error(`- rows scanned: ${String(scannedCount)}`);
  logger.error(`- rows needing update: ${String(candidates.length)}`);
  logger.error(`- rows updated: ${String(updatedCount)}`);
  logger.error(`- sample: ${JSON.stringify(sample, null, 2)}`);

  return {
    dryRun,
    scannedCount,
    updatedCount,
    sample
  };
}

export async function runRewriteTimelineSortKeysCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<RewriteTimelineSortKeysResult> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env)
  });

  try {
    return await rewriteTimelineSortKeys({
      db: connection.db,
      dryRun: !readOptionalBooleanFlag(flags, "execute", false),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runRewriteTimelineSortKeysCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "rewrite-timeline-sort-keys failed.";

      console.error(message);
      process.exitCode = 1;
    }
  );
}
