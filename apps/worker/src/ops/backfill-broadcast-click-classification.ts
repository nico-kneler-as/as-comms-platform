#!/usr/bin/env tsx
/**
 * backfill-broadcast-click-classification
 *
 * Usage:
 *   pnpm ops:backfill-broadcast-click-classification
 *   pnpm ops:backfill-broadcast-click-classification --execute
 *
 * Dry-run by default. Re-classifies existing broadcast_link_clicks rows with
 * the current classifyBroadcastActivity rules (rows recorded before the ingest
 * classifier went live default to is_bot=false). Idempotent: only rows whose
 * computed (is_bot, bot_reason) differs from what is stored are updated, so a
 * second full pass reports changed=0. Clicks only — there is no historical
 * per-open data to backfill.
 */
import process from "node:process";

import { eq } from "drizzle-orm";

import {
  audienceSnapshots,
  broadcastLinkClicks,
  closeDatabaseConnection,
  createDatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  classifyBroadcastActivity,
  type BroadcastActivityBotReason,
} from "@as-comms/domain";

import { parseCliFlags, readOptionalBooleanFlag } from "./helpers.js";

const updateBatchSize = 500;

interface Logger {
  error(...args: readonly unknown[]): void;
}

interface ClickClassificationChange {
  readonly id: string;
  readonly isBot: boolean;
  readonly botReason: BroadcastActivityBotReason | null;
}

export interface BackfillBroadcastClickClassificationResult {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly changed: number;
  readonly flaggedBot: number;
  readonly byReason: Readonly<Record<BroadcastActivityBotReason, number>>;
  readonly updatedCount: number;
  readonly runtimeMs: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString;
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function applyUpdates(input: {
  readonly db: Stage1Database;
  readonly changes: readonly ClickClassificationChange[];
}): Promise<number> {
  let updatedCount = 0;

  for (const batch of chunkValues(input.changes, updateBatchSize)) {
    await input.db.transaction(async (tx) => {
      for (const change of batch) {
        await tx
          .update(broadcastLinkClicks)
          .set({ isBot: change.isBot, botReason: change.botReason })
          .where(eq(broadcastLinkClicks.id, change.id));
      }
    });
    updatedCount += batch.length;
  }

  return updatedCount;
}

export async function backfillBroadcastClickClassification(input: {
  readonly db: Stage1Database;
  readonly dryRun?: boolean;
  readonly logger?: Logger;
}): Promise<BackfillBroadcastClickClassificationResult> {
  const startedAt = Date.now();
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;

  // Left join so clicks without a snapshot (metadata-only) still classify on
  // the user-agent signal; their delivery reference is simply null.
  const rows = await input.db
    .select({
      id: broadcastLinkClicks.id,
      userAgent: broadcastLinkClicks.userAgent,
      platform: broadcastLinkClicks.platform,
      clickedAt: broadcastLinkClicks.clickedAt,
      isBot: broadcastLinkClicks.isBot,
      botReason: broadcastLinkClicks.botReason,
      deliveredAt: audienceSnapshots.deliveredAt,
      sentAt: audienceSnapshots.sentAt,
    })
    .from(broadcastLinkClicks)
    .leftJoin(
      audienceSnapshots,
      eq(broadcastLinkClicks.audienceSnapshotId, audienceSnapshots.id),
    );

  const byReason: Record<BroadcastActivityBotReason, number> = {
    machine_user_agent: 0,
    fast_activity: 0,
  };
  const changes: ClickClassificationChange[] = [];
  let flaggedBot = 0;

  for (const row of rows) {
    const { isBot, reason } = classifyBroadcastActivity({
      userAgent: row.userAgent,
      platform: row.platform,
      occurredAt: row.clickedAt,
      deliveredAt: row.deliveredAt ?? row.sentAt ?? null,
    });

    if (isBot && reason !== null) {
      flaggedBot += 1;
      byReason[reason] += 1;
    }

    const storedReason = row.botReason ?? null;
    if (isBot !== row.isBot || reason !== storedReason) {
      changes.push({ id: row.id, isBot, botReason: reason });
    }
  }

  const updatedCount = dryRun
    ? 0
    : await applyUpdates({ db: input.db, changes });
  const runtimeMs = Date.now() - startedAt;

  logger.error("backfill-broadcast-click-classification");
  logger.error(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  logger.error(`- scanned rows: ${String(rows.length)}`);
  logger.error(`- would change: ${String(changes.length)}`);
  logger.error(`- flagged bot: ${String(flaggedBot)}`);
  logger.error(`  - machine_user_agent: ${String(byReason.machine_user_agent)}`);
  logger.error(`  - fast_activity: ${String(byReason.fast_activity)}`);
  logger.error(`- updated: ${String(updatedCount)}`);
  logger.error(`- runtime_ms: ${String(runtimeMs)}`);

  return {
    dryRun,
    scanned: rows.length,
    changed: changes.length,
    flaggedBot,
    byReason,
    updatedCount,
    runtimeMs,
  };
}

export async function runBackfillBroadcastClickClassificationCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<BackfillBroadcastClickClassificationResult> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    return await backfillBroadcastClickClassification({
      db: connection.db,
      dryRun: !readOptionalBooleanFlag(flags, "execute", false),
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runBackfillBroadcastClickClassificationCommand(
    process.argv.slice(2),
  ).catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "backfill-broadcast-click-classification failed.";

    console.error(message);
    process.exitCode = 1;
  });
}
