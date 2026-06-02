import process from "node:process";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  messageAttachments,
  type Stage1Database,
} from "@as-comms/db";
import { classifyAttachment } from "@as-comms/integrations";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

interface Logger {
  log(value: string): void;
  error?(value: string): void;
}

interface CandidateAttachmentRow {
  readonly id: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly isDecoration: boolean;
}

export interface RecomputeAttachmentDecorationLogEntry {
  readonly id: string;
  readonly action: "unchanged" | "recomputed";
  readonly before?: boolean;
  readonly after?: boolean;
  readonly dryRun?: boolean;
}

export interface RecomputeAttachmentDecorationResult {
  readonly dryRun: boolean;
  readonly since: string;
  readonly until: string;
  readonly candidates: number;
  readonly recomputed: number;
  readonly unchanged: number;
  readonly truncated: boolean;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands.",
    );
  }

  return connectionString;
}

function parseWindowTimestamp(value: string, flagName: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Flag --${flagName} must be a valid ISO timestamp.`);
  }

  return parsed.toISOString();
}

function buildDefaultSince(): string {
  return "1970-01-01T00:00:00.000Z";
}

function buildDefaultUntil(): string {
  return new Date().toISOString();
}

function logEntry(logger: Logger, entry: RecomputeAttachmentDecorationLogEntry) {
  logger.log(JSON.stringify(entry));
}

async function loadCandidateRows(input: {
  readonly db: Stage1Database;
  readonly since: string;
  readonly until: string;
  readonly limit: number;
}): Promise<{
  readonly candidates: readonly CandidateAttachmentRow[];
  readonly truncated: boolean;
}> {
  const rows = await input.db
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      isDecoration: messageAttachments.isDecoration,
    })
    .from(messageAttachments)
    .where(
      and(
        sql`${messageAttachments.createdAt} >= ${input.since}::timestamptz`,
        sql`${messageAttachments.createdAt} <= ${input.until}::timestamptz`,
      ),
    )
    .orderBy(asc(messageAttachments.createdAt), asc(messageAttachments.id))
    .limit(input.limit + 1);

  return {
    candidates: rows.slice(0, input.limit),
    truncated: rows.length > input.limit,
  };
}

export async function recomputeAttachmentDecoration(input: {
  readonly db: Stage1Database;
  readonly since: string;
  readonly until: string;
  readonly execute: boolean;
  readonly limit: number;
  readonly logger?: Logger;
}): Promise<RecomputeAttachmentDecorationResult> {
  const logger = input.logger ?? console;
  const { candidates, truncated } = await loadCandidateRows(input);

  let recomputed = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    const nextIsDecoration = classifyAttachment({
      filename: candidate.filename,
      mimeType: candidate.mimeType,
    }).isDecoration;

    if (nextIsDecoration === candidate.isDecoration) {
      unchanged += 1;
      logEntry(logger, {
        id: candidate.id,
        action: "unchanged",
      });
      continue;
    }

    if (input.execute) {
      await input.db
        .update(messageAttachments)
        .set({ isDecoration: nextIsDecoration })
        .where(eq(messageAttachments.id, candidate.id));
    }

    recomputed += 1;
    logEntry(logger, {
      id: candidate.id,
      action: "recomputed",
      before: candidate.isDecoration,
      after: nextIsDecoration,
      dryRun: !input.execute,
    });
  }

  return {
    dryRun: !input.execute,
    since: input.since,
    until: input.until,
    candidates: candidates.length,
    recomputed,
    unchanged,
    truncated,
  };
}

export async function runRecomputeAttachmentDecorationCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const since = parseWindowTimestamp(
    readOptionalStringFlag(flags, "since") ?? buildDefaultSince(),
    "since",
  );
  const until = parseWindowTimestamp(
    readOptionalStringFlag(flags, "until") ?? buildDefaultUntil(),
    "until",
  );
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 10_000);

  if (new Date(since).getTime() > new Date(until).getTime()) {
    throw new Error("Flag --since must be earlier than or equal to --until.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const result = await recomputeAttachmentDecoration({
      db: connection.db,
      since,
      until,
      execute,
      limit,
      logger,
    });

    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main() {
  await runRecomputeAttachmentDecorationCommand();
}

void main().catch((error: unknown) => {
  const resolvedError =
    error instanceof Error ? error : new Error(String(error));
  console.error(resolvedError.message);
  process.exitCode = 1;
});
