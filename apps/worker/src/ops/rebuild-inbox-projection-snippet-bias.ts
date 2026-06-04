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

interface InboxProjectionSnippetRow {
  readonly contactId: string;
  readonly snippet: string;
}

export interface RebuildInboxProjectionSnippetBiasResult {
  readonly processed: number;
  readonly changed: number;
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

export async function loadInboxProjectionSnippetRows(
  db: Stage1Database,
): Promise<readonly InboxProjectionSnippetRow[]> {
  const result = await db.execute(sql<InboxProjectionSnippetRow>`
    select
      ${contactInboxProjection.contactId} as "contactId",
      ${contactInboxProjection.snippet} as "snippet"
    from ${contactInboxProjection}
    order by ${contactInboxProjection.contactId} asc
  `);

  return normalizeSqlResultRows(
    result as
      | readonly InboxProjectionSnippetRow[]
      | {
          readonly rows?: readonly InboxProjectionSnippetRow[];
        },
  );
}

export async function rebuildInboxProjectionSnippetBias(input: {
  readonly connection: {
    readonly db: Stage1Database;
  };
  readonly logger?: Logger;
}): Promise<RebuildInboxProjectionSnippetBiasResult> {
  const logger = input.logger ?? console;
  const repositories = createStage1RepositoryBundle(input.connection.db);
  const persistence = createStage1PersistenceService(repositories);
  const rows = await loadInboxProjectionSnippetRows(input.connection.db);
  let changed = 0;
  let unchanged = 0;

  for (const row of rows) {
    const rebuilt = await rebuildInboxProjectionForContact(
      persistence,
      row.contactId,
    );
    const nextSnippet = rebuilt?.snippet ?? "";

    if (nextSnippet === row.snippet) {
      unchanged += 1;
    } else {
      changed += 1;
    }

    logger.log(
      `[snippet-bias] contact=${row.contactId} snippet=${JSON.stringify(row.snippet)}→${JSON.stringify(nextSnippet)}`,
    );
  }

  return {
    processed: rows.length,
    changed,
    unchanged,
  };
}

export async function runRebuildInboxProjectionSnippetBiasCommand(
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<RebuildInboxProjectionSnippetBiasResult> {
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    return await rebuildInboxProjectionSnippetBias({
      connection,
      logger,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runRebuildInboxProjectionSnippetBiasCommand().catch((error: unknown) => {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));

    console.error(`[snippet-bias:fatal] ${resolvedError.message}`);
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
          `[snippet-bias:fatal:${key}] ${JSON.stringify(anyError[key])}`,
        );
      }
    }

    process.exitCode = 1;
  });
}
