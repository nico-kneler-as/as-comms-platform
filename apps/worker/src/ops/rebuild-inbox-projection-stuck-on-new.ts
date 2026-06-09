#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  contactInboxProjection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1PersistenceService,
  rebuildInboxProjectionForContact,
} from "@as-comms/domain";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface StuckOnNewRow {
  readonly contactId: string;
  readonly bucket: "New" | "Opened";
}

export interface RebuildInboxProjectionStuckOnNewResult {
  readonly processed: number;
  readonly opened: number;
  readonly unchanged: number;
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

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

export async function loadStuckOnNewContactRows(
  db: Stage1Database,
): Promise<readonly StuckOnNewRow[]> {
  const result = await db.execute(sql<StuckOnNewRow>`
    select
      ${contactInboxProjection.contactId} as "contactId",
      ${contactInboxProjection.bucket} as "bucket"
    from ${contactInboxProjection}
    where ${contactInboxProjection.bucket} = 'New'
      and ${contactInboxProjection.lastEventType}::text like '%outbound%'
    order by ${contactInboxProjection.contactId} asc
  `);

  return normalizeSqlResultRows(
    result as
      | readonly StuckOnNewRow[]
      | {
          readonly rows?: readonly StuckOnNewRow[];
        },
  );
}

export async function rebuildInboxProjectionStuckOnNew(input: {
  readonly connection: {
    readonly db: Stage1Database;
  };
  readonly logger?: Logger;
}): Promise<RebuildInboxProjectionStuckOnNewResult> {
  const logger = input.logger ?? console;
  const repositories = createStage1RepositoryBundle(input.connection.db);
  const persistence = createStage1PersistenceService(repositories);
  const stuckRows = await loadStuckOnNewContactRows(input.connection.db);
  let opened = 0;
  let unchanged = 0;

  for (const row of stuckRows) {
    const rebuilt = await rebuildInboxProjectionForContact(
      persistence,
      row.contactId,
    );
    const afterBucket = rebuilt?.bucket ?? "Deleted";

    if (afterBucket === "Opened") {
      opened += 1;
    } else {
      unchanged += 1;
    }

    logger.log(
      `[bucket-fix] contact=${row.contactId} bucket=${row.bucket}→${afterBucket}`,
    );
  }

  return {
    processed: stuckRows.length,
    opened,
    unchanged,
  };
}

export async function runRebuildInboxProjectionStuckOnNewCommand(
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<RebuildInboxProjectionStuckOnNewResult> {
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    return await rebuildInboxProjectionStuckOnNew({
      connection,
      logger,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runRebuildInboxProjectionStuckOnNewCommand().catch((error: unknown) => {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));

    console.error(`[bucket-fix:fatal] ${resolvedError.message}`);
    console.error(resolvedError.stack ?? "(no stack)");

    const anyError = resolvedError as Error & Record<string, unknown>;
    for (const key of [
      "cause",
      "code",
      "detail",
      "constraint",
      "column",
      "table",
      "schema",
      "severity",
      "position",
      "where",
      "hint",
      "errno",
      "syscall",
    ]) {
      if (anyError[key] !== undefined) {
        console.error(
          `[bucket-fix:fatal:${key}] ${JSON.stringify(anyError[key])}`,
        );
      }
    }

    process.exitCode = 1;
  });
}
