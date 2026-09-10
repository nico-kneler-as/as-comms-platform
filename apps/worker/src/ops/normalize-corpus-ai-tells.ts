#!/usr/bin/env tsx
/**
 * normalize-corpus-ai-tells
 *
 * Rewrites only deterministic AI-tell character substitutions in the stored
 * project corpus. Dry-run by default; pass --execute to persist changes.
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:normalize-corpus-ai-tells -- [--execute]
 */
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  projectKnowledgeEntries,
} from "@as-comms/db";
import { normalizeAiTellCharacters } from "@as-comms/domain";
import { asc, eq } from "drizzle-orm";

import { parseCliFlags, readOptionalBooleanFlag } from "./helpers.js";

interface CorpusRow {
  readonly id: string;
  readonly maskedExample: string | null;
}

export interface NormalizeCorpusAiTellsResult {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly runtimeMs: number;
}

interface RunOptions {
  readonly dryRun: boolean;
  readonly logger?: Pick<Console, "info" | "error">;
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

export async function runNormalizeCorpusAiTells(
  options: RunOptions,
): Promise<NormalizeCorpusAiTellsResult> {
  const startedAt = Date.now();
  const logger = options.logger ?? console;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env),
  });

  try {
    const rows: readonly CorpusRow[] = await connection.db
      .select({
        id: projectKnowledgeEntries.id,
        maskedExample: projectKnowledgeEntries.maskedExample,
      })
      .from(projectKnowledgeEntries)
      .orderBy(asc(projectKnowledgeEntries.id));

    logger.info(
      `[normalize-corpus-ai-tells] scanned=${String(rows.length)} ` +
        `dry-run=${String(options.dryRun)}`,
    );

    let changed = 0;
    let unchanged = 0;

    for (const row of rows) {
      if (row.maskedExample === null) {
        unchanged += 1;
        continue;
      }

      const normalized = normalizeAiTellCharacters(row.maskedExample);

      if (normalized === row.maskedExample) {
        unchanged += 1;
        continue;
      }

      changed += 1;

      if (!options.dryRun) {
        await connection.db
          .update(projectKnowledgeEntries)
          .set({
            maskedExample: normalized,
            updatedAt: new Date(),
          })
          .where(eq(projectKnowledgeEntries.id, row.id));
      }
    }

    return {
      dryRun: options.dryRun,
      scanned: rows.length,
      changed,
      unchanged,
      runtimeMs: Date.now() - startedAt,
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv.slice(2));
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const result = await runNormalizeCorpusAiTells({ dryRun: !execute });

  console.error(
    `[normalize-corpus-ai-tells] done ` +
      `scanned=${String(result.scanned)} ` +
      `changed=${String(result.changed)} ` +
      `unchanged=${String(result.unchanged)} ` +
      `dry_run=${String(result.dryRun)} ` +
      `runtime_ms=${String(result.runtimeMs)}`,
  );

  if (result.dryRun) {
    console.error(
      "[normalize-corpus-ai-tells] dry-run: no rows written. Re-run with --execute to persist.",
    );
  }
}

if (process.argv[1]?.endsWith("normalize-corpus-ai-tells.ts")) {
  void main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error("Corpus AI-tell normalization failed.");
      console.error("message:", error.message);
      if (error.cause !== undefined) {
        console.error("cause:", error.cause);
      }
    } else {
      console.error("Corpus AI-tell normalization failed:", error);
    }
    process.exitCode = 1;
  });
}
