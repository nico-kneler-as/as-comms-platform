#!/usr/bin/env node
// @ts-check
/**
 * Thin CLI wrapper around the in-process migrator.
 *
 * The substantive logic lives in `packages/db/src/migrator.ts` and is
 * exported via the package's public API so the worker can call it at
 * startup. This script remains for local-dev / ad-hoc invocation:
 *
 *   pnpm --filter @as-comms/db migrate
 *
 * Production now invokes the migrator in-process from the worker
 * bootstrap (see apps/worker/src/runtime.ts) rather than relying on
 * Railway preDeployCommand, which was observed to silently no-op
 * (issue #286).
 */

import { runMigrations, MigratorError } from "../dist/migrator.js";

function readDatabaseUrl() {
  const url =
    process.env.DATABASE_URL?.trim() ?? process.env.DATABASE_PUBLIC_URL?.trim();
  if (!url || url.length === 0) {
    console.error(
      "[migrate] ERROR: Neither DATABASE_URL nor DATABASE_PUBLIC_URL is set.",
    );
    process.exit(1);
  }
  return url;
}

async function main() {
  await runMigrations({ databaseUrl: readDatabaseUrl() });
}

main().catch((error) => {
  if (error instanceof MigratorError) {
    process.exit(1);
  }
  console.error("[migrate] ERROR:", error?.message ?? String(error));
  if (error?.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
