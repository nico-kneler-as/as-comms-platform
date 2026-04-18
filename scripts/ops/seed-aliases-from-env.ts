#!/usr/bin/env tsx
/**
 * pnpm ops:worker:seed-aliases-from-env
 *
 * One-time migration: reads GMAIL_PROJECT_INBOX_ALIASES from the environment
 * and inserts them into the project_aliases table (if not already present).
 *
 * Idempotent: skips aliases that already exist (by alias value).
 * Requires: DATABASE_URL env var.
 */
import { randomUUID } from "node:crypto";
import {
  createDatabaseConnection,
  createStage2RepositoryBundleFromConnection
} from "@as-comms/db";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const aliasesEnv = process.env.GMAIL_PROJECT_INBOX_ALIASES;
  if (!aliasesEnv?.trim()) {
    console.error("GMAIL_PROJECT_INBOX_ALIASES is required (comma-separated emails)");
    process.exitCode = 1;
    return;
  }

  const aliases = aliasesEnv.split(",").map(a => a.trim()).filter(Boolean);
  if (aliases.length === 0) {
    console.error("GMAIL_PROJECT_INBOX_ALIASES must contain at least one email");
    process.exitCode = 1;
    return;
  }

  const connection = createDatabaseConnection({ connectionString });
  try {
    const { aliases: aliasRepo } = createStage2RepositoryBundleFromConnection(connection);

    let inserted = 0;
    let skipped = 0;
    for (const alias of aliases) {
      const existing = await aliasRepo.findByAlias(alias);
      if (existing) {
        console.log(`Skipping (already exists): ${alias}`);
        skipped++;
        continue;
      }
      const now = new Date();
      await aliasRepo.create({
        id: randomUUID(),
        alias,
        projectId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null
      });
      console.log(`Inserted: ${alias}`);
      inserted++;
    }

    console.log(`Done. Inserted: ${inserted.toString()}, Skipped: ${skipped.toString()}`);
  } finally {
    const sql = (connection as { sql?: { end?: () => Promise<void> } }).sql;
    if (sql && typeof sql.end === "function") {
      await sql.end();
    }
  }
}

await main();
