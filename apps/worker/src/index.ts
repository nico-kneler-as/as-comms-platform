import { runMigrations } from "@as-comms/db";

import { startWorker } from "./runtime.js";

function readDatabaseUrl(): string | null {
  const url =
    process.env.DATABASE_URL?.trim() ?? process.env.DATABASE_PUBLIC_URL?.trim();
  return url && url.length > 0 ? url : null;
}

async function applyMigrationsOrFail(): Promise<void> {
  if (process.env.WORKER_AUTO_MIGRATE_ENABLED === "false") {
    console.info(
      "[migrate] WORKER_AUTO_MIGRATE_ENABLED=false — skipping in-process migration run",
    );
    return;
  }

  const databaseUrl = readDatabaseUrl();
  if (databaseUrl === null) {
    throw new Error(
      "[migrate] Neither DATABASE_URL nor DATABASE_PUBLIC_URL is set; cannot run migrations.",
    );
  }

  await runMigrations({ databaseUrl });
}

async function main() {
  await applyMigrationsOrFail();

  const runner = await startWorker();
  if (!runner) {
    return;
  }

  console.info(
    "Stage 1 worker runtime is active. Gmail live capture, Salesforce capture, replay, rebuild, parity, and cutover-support tasks now execute through the single normalization path, while historical Gmail backfill enters through the worker .mbox import command."
  );
  await runner.promise;
}

void main().catch((error: unknown) => {
  console.error("Stage 1 worker bootstrap failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
