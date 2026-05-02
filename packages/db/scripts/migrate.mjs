#!/usr/bin/env node
// @ts-check
/**
 * Custom auto-apply migrator for the AS Comms Platform.
 *
 * Replaces the broken `drizzle-kit migrate` invocation that PR #237 tried to
 * wire into the worker's Railway preDeployCommand. drizzle-kit migrate
 * silently failed because the repo never carried a `meta/_journal.json`
 * (schema state has historically been managed by drizzle-kit push).
 *
 * Behavior:
 *   1. Connect via DATABASE_URL (Railway-provided in the worker), with a
 *      fallback to DATABASE_PUBLIC_URL.
 *   2. CREATE TABLE IF NOT EXISTS applied_migrations.
 *   3. Discover SQL files under packages/db/drizzle/<NNNN>_*.sql, sorted.
 *   4. If applied_migrations is empty AND `message_attachments.is_inline`
 *      exists (proxy: 0049 was already applied manually after the
 *      2026-05-02 outage), seed every migration as already-applied. This
 *      is the one-time bootstrap path — it runs at most once on prod.
 *   5. Otherwise, run any pending migrations in order, each in its own
 *      transaction. Track success in applied_migrations.
 *   6. Exit non-zero on any error so Railway fails the deploy.
 *
 * The bootstrap detection is intentionally narrow. If no sentinel column
 * is found AND there are unrelated tables in `public`, the migrator
 * refuses to guess and exits 1 with a clear instruction. Better to fail
 * loud than silently double-apply migrations against a partially-set-up
 * database.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const TRACKING_TABLE = "applied_migrations";
// Column added by 0049_inline_attachments. Used as the bootstrap sentinel:
// its presence means migrations 0000-0049 have been applied to the DB
// (whether by drizzle-kit push, manual SQL, or any future mix).
const SENTINEL_TABLE = "message_attachments";
const SENTINEL_COLUMN = "is_inline";

function log(message) {
  console.log(`[migrate] ${message}`);
}

function logError(message) {
  console.error(`[migrate] ERROR: ${message}`);
}

function readDatabaseUrl() {
  const url =
    process.env.DATABASE_URL?.trim() ?? process.env.DATABASE_PUBLIC_URL?.trim();
  if (!url || url.length === 0) {
    logError(
      "Neither DATABASE_URL nor DATABASE_PUBLIC_URL is set. Cannot connect.",
    );
    process.exit(1);
  }
  return url;
}

function discoverMigrations() {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzleDir = resolve(here, "..", "drizzle");
  const entries = readdirSync(drizzleDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return files.map((filename) => {
    const fullPath = join(drizzleDir, filename);
    const raw = readFileSync(fullPath, "utf8");
    // Normalize line endings + trim trailing whitespace so the hash is
    // stable across platforms. The hash is informational only — the
    // filename is the unique key we re-check against applied_migrations.
    const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
    const hash = createHash("sha256").update(normalized).digest("hex");
    const id = filename.replace(/\.sql$/u, "");
    return { id, filename, fullPath, sql: raw, hash };
  });
}

async function ensureTrackingTable(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id           text PRIMARY KEY,
      hash         text NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function listAppliedIds(sql) {
  const rows = await sql`SELECT id FROM ${sql(TRACKING_TABLE)}`;
  return new Set(rows.map((row) => row.id));
}

async function sentinelColumnExists(sql) {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${SENTINEL_TABLE}
      AND column_name = ${SENTINEL_COLUMN}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function publicHasUnrelatedTables(sql) {
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> ${TRACKING_TABLE}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function bootstrap(sql, migrations) {
  log(
    `bootstrap mode: seeding ${String(migrations.length)} migrations as already applied`,
  );
  const rows = migrations.map((migration) => ({
    id: migration.id,
    hash: migration.hash,
  }));
  await sql`
    INSERT INTO ${sql(TRACKING_TABLE)} ${sql(rows, "id", "hash")}
    ON CONFLICT (id) DO NOTHING
  `;
}

async function applyMigration(sql, migration) {
  log(`applying ${migration.id}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(migration.sql);
    await tx`
      INSERT INTO ${tx(TRACKING_TABLE)} (id, hash)
      VALUES (${migration.id}, ${migration.hash})
    `;
  });
  log(`applied ${migration.id}`);
}

function summarizeError(error, migration) {
  const code = error?.code ? `[${error.code}] ` : "";
  const message = error?.message ?? String(error);
  const position = error?.position ? ` at position ${error.position}` : "";
  const snippet = migration.sql.replace(/\s+/g, " ").slice(0, 200);
  logError(`failed ${migration.filename}${position}: ${code}${message}`);
  logError(`SQL preview: ${snippet}${migration.sql.length > 200 ? "..." : ""}`);
}

async function main() {
  const databaseUrl = readDatabaseUrl();
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    onnotice: () => {},
  });

  try {
    const migrations = discoverMigrations();
    log(`discovered ${String(migrations.length)} migration files`);

    await ensureTrackingTable(sql);
    const applied = await listAppliedIds(sql);

    if (applied.size === 0) {
      const hasSentinel = await sentinelColumnExists(sql);
      if (hasSentinel) {
        await bootstrap(sql, migrations);
        log(`OK — bootstrap complete (${String(migrations.length)} total)`);
        return;
      }

      const hasOtherTables = await publicHasUnrelatedTables(sql);
      if (hasOtherTables) {
        logError(
          "Schema appears partially applied (tables exist in public) but " +
            "the sentinel column " +
            SENTINEL_TABLE +
            "." +
            SENTINEL_COLUMN +
            " is missing and applied_migrations is empty. Refusing to " +
            "guess. Operator must seed applied_migrations manually before " +
            "the next deploy.",
        );
        process.exit(1);
      }

      log("fresh database detected — applying all migrations from scratch");
    }

    const pending = migrations.filter((migration) => !applied.has(migration.id));

    if (pending.length === 0) {
      log(
        `OK — 0 applied this run, ${String(migrations.length)} total`,
      );
      return;
    }

    log(`pending: ${String(pending.length)}`);
    let appliedThisRun = 0;
    for (const migration of pending) {
      try {
        await applyMigration(sql, migration);
        appliedThisRun += 1;
      } catch (error) {
        summarizeError(error, migration);
        process.exit(1);
      }
    }

    log(
      `OK — ${String(appliedThisRun)} applied this run, ${String(migrations.length)} total`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  logError(error?.message ?? String(error));
  if (error?.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
