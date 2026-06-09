import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const TRACKING_TABLE = "applied_migrations";
// Stable primary-key column on a long-lived table. Its presence means the
// pre-tracking schema already exists in a form new enough to seed the
// migration journal during bootstrap.
const SENTINEL_TABLE = "message_attachments";
const SENTINEL_COLUMN = "id";

// Stable Postgres advisory-lock key. Picked from a SHA-256 prefix of
// "as-comms:migrator"; well within JS safe-integer range so we can keep it
// as a plain number for postgres.js parameter binding.
const ADVISORY_LOCK_KEY = 73_314_011;

const NO_TRANSACTION_DIRECTIVE = /^[ \t]*--[ \t]*migrate:no-transaction\b/mu;

interface MigrationFile {
  readonly id: string;
  readonly filename: string;
  readonly fullPath: string;
  readonly sql: string;
  readonly hash: string;
}

export interface RunMigrationsInput {
  readonly databaseUrl: string;
  /** Override directory containing the `<NNNN>_*.sql` files. Defaults to
   *  `packages/db/drizzle/` resolved relative to the compiled module. */
  readonly drizzleDir?: string;
  /** Replace the structured log emitter. Default writes `[migrate] ...` to
   *  stdout. */
  readonly log?: (message: string) => void;
  /** Replace the structured error emitter. Default writes `[migrate] ERROR:
   *  ...` to stderr. */
  readonly logError?: (message: string) => void;
}

export interface RunMigrationsResult {
  readonly mode: "bootstrap" | "fresh" | "incremental" | "noop";
  readonly totalMigrations: number;
  readonly appliedThisRun: number;
}

export class MigratorError extends Error {
  readonly migration: MigrationFile | undefined;
  constructor(message: string, options?: { cause?: unknown; migration?: MigrationFile }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MigratorError";
    this.migration = options?.migration;
  }
}

function defaultLog(message: string): void {
  console.log(`[migrate] ${message}`);
}

function defaultLogError(message: string): void {
  console.error(`[migrate] ERROR: ${message}`);
}

function defaultDrizzleDir(): string {
  // After tsc build this module lives in `packages/db/dist/migrator.js`.
  // Source SQL files live in `packages/db/drizzle/`.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "drizzle");
}

function discoverMigrations(drizzleDir: string): MigrationFile[] {
  const entries = readdirSync(drizzleDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return files.map((filename) => {
    const fullPath = join(drizzleDir, filename);
    const raw = readFileSync(fullPath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
    const hash = createHash("sha256").update(normalized).digest("hex");
    const id = filename.replace(/\.sql$/u, "");
    return { id, filename, fullPath, sql: raw, hash };
  });
}

function migrationOptsOutOfTransaction(migration: MigrationFile): boolean {
  return NO_TRANSACTION_DIRECTIVE.test(migration.sql);
}

function summarizeError(error: unknown, migration: MigrationFile): string {
  const errAny = error as { code?: string; message?: string; position?: string } | null;
  const code = errAny?.code ? `[${errAny.code}] ` : "";
  const message = errAny?.message ?? String(error);
  const position = errAny?.position ? ` at position ${errAny.position}` : "";
  const snippet = migration.sql.replace(/\s+/g, " ").slice(0, 200);
  return `failed ${migration.filename}${position}: ${code}${message} | SQL preview: ${snippet}${
    migration.sql.length > 200 ? "..." : ""
  }`;
}

export async function runMigrations(
  input: RunMigrationsInput,
): Promise<RunMigrationsResult> {
  const log = input.log ?? defaultLog;
  const logError = input.logError ?? defaultLogError;
  const drizzleDir = input.drizzleDir ?? defaultDrizzleDir();

  const sql = postgres(input.databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    onnotice: () => {
      // Suppress NOTICE-level Postgres messages (e.g., "table already exists").
    },
  });

  let lockAcquired = false;
  try {
    // Concurrency: hold an advisory lock for the duration of the migrator run.
    // If two replicas come up simultaneously, the second blocks on the first
    // and then sees applied_migrations already populated.
    const lockProbeRows = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired
    `;
    const acquired = lockProbeRows[0]?.acquired ?? false;
    if (!acquired) {
      log("another migrator run is in progress; waiting for advisory lock");
      await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    }
    lockAcquired = true;

    const migrations = discoverMigrations(drizzleDir);
    log(`discovered ${String(migrations.length)} migration files`);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
        id           text PRIMARY KEY,
        hash         text NOT NULL,
        applied_at   timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await sql.unsafe<{ id: string }[]>(
      `SELECT id FROM ${TRACKING_TABLE}`,
    );
    const applied = new Set(appliedRows.map((row) => row.id));

    if (applied.size === 0) {
      const sentinelRows = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${SENTINEL_TABLE}
          AND column_name = ${SENTINEL_COLUMN}
        LIMIT 1
      `;
      const hasSentinel = sentinelRows.length > 0;

      if (hasSentinel) {
        log(
          `bootstrap mode: seeding ${String(migrations.length)} migrations as already applied`,
        );
        await sql.begin(async (tx) => {
          for (const migration of migrations) {
            await tx.unsafe(
              `INSERT INTO ${TRACKING_TABLE} (id, hash) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
              [migration.id, migration.hash],
            );
          }
        });
        log(`OK — bootstrap complete (${String(migrations.length)} total)`);
        return { mode: "bootstrap", totalMigrations: migrations.length, appliedThisRun: 0 };
      }

      const otherTablesRows = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> ${TRACKING_TABLE}
        LIMIT 1
      `;
      if (otherTablesRows.length > 0) {
        const message =
          `schema appears partially applied (tables exist in public) but ` +
          `the sentinel column ${SENTINEL_TABLE}.${SENTINEL_COLUMN} is missing ` +
          `and ${TRACKING_TABLE} is empty. Refusing to guess. Operator must seed ` +
          `${TRACKING_TABLE} manually before the next deploy.`;
        logError(message);
        throw new MigratorError(message);
      }

      log("fresh database detected — applying all migrations from scratch");
    }

    const pending = migrations.filter((migration) => !applied.has(migration.id));

    if (pending.length === 0) {
      log(`OK — 0 applied this run, ${String(migrations.length)} total`);
      return {
        mode: applied.size === 0 ? "fresh" : "noop",
        totalMigrations: migrations.length,
        appliedThisRun: 0,
      };
    }

    log(`pending: ${String(pending.length)}`);
    let appliedThisRun = 0;
    for (const migration of pending) {
      const noTransaction = migrationOptsOutOfTransaction(migration);
      log(`applying ${migration.id}${noTransaction ? " (no-transaction)" : ""}`);

      try {
        if (noTransaction) {
          await sql.unsafe(migration.sql);
          await sql.unsafe(
            `INSERT INTO ${TRACKING_TABLE} (id, hash) VALUES ($1, $2)`,
            [migration.id, migration.hash],
          );
        } else {
          await sql.begin(async (tx) => {
            await tx.unsafe(migration.sql);
            await tx.unsafe(
              `INSERT INTO ${TRACKING_TABLE} (id, hash) VALUES ($1, $2)`,
              [migration.id, migration.hash],
            );
          });
        }
      } catch (error) {
        const summary = summarizeError(error, migration);
        logError(summary);
        throw new MigratorError(summary, { cause: error, migration });
      }

      log(`applied ${migration.id}`);
      appliedThisRun += 1;
    }

    log(
      `OK — ${String(appliedThisRun)} applied this run, ${String(migrations.length)} total`,
    );
    return {
      mode: applied.size === 0 ? "fresh" : "incremental",
      totalMigrations: migrations.length,
      appliedThisRun,
    };
  } finally {
    if (lockAcquired) {
      try {
        await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
      } catch {
        // ignore unlock errors during shutdown
      }
    }
    await sql.end({ timeout: 5 });
  }
}
