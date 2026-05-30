#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  canonicalEventAudience,
  canonicalEventLedger,
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  createStage1RepositoryBundleFromConnection,
  sourceEvidenceLog,
  type Stage1Database,
} from "@as-comms/db";
import {
  type CanonicalEventRecord,
  applyCanonicalEventAudience,
  createStage1NormalizationService,
  createStage1PersistenceService,
} from "@as-comms/domain";
import type { GmailMessageDetailRecord } from "@as-comms/contracts";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

type SkipReason = "no_gmail_detail" | "no_header_emails";

interface CandidateCanonicalEventRow {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
}

export interface BackfillCanonicalEventAudienceLogEntry {
  readonly action: "applied" | "dryRun" | "skipped";
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly audienceCount?: number;
  readonly reason?: SkipReason;
}

export interface BackfillCanonicalEventAudienceResult {
  readonly dryRun: boolean;
  readonly since: string;
  readonly until: string;
  readonly candidates: number;
  readonly applied: number;
  readonly skipped: number;
  readonly truncated: boolean;
  readonly byReason: Readonly<Record<SkipReason, number>>;
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
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
    throw new Error(`Flag --${flagName} must be a valid ISO-8601 timestamp.`);
  }

  return parsed.toISOString();
}

function buildDefaultSince(): string {
  return "2026-01-01T00:00:00.000Z";
}

function buildDefaultUntil(): string {
  return new Date().toISOString();
}

function logEntry(
  logger: Logger,
  entry: BackfillCanonicalEventAudienceLogEntry,
): void {
  logger.log(JSON.stringify(entry));
}

function hasHeaderEmails(detail: {
  readonly fromEmails: readonly string[];
  readonly toEmails: readonly string[];
  readonly ccEmails: readonly string[];
  readonly bccEmails: readonly string[];
}): boolean {
  return (
    detail.fromEmails.length > 0 ||
    detail.toEmails.length > 0 ||
    detail.ccEmails.length > 0 ||
    detail.bccEmails.length > 0
  );
}

async function loadCandidateRows(input: {
  readonly db: Stage1Database;
  readonly since: string;
  readonly until: string;
  readonly limit: number;
}): Promise<{
  readonly candidates: readonly CandidateCanonicalEventRow[];
  readonly truncated: boolean;
}> {
  const rows = await input.db
    .select({
      canonicalEventId: canonicalEventLedger.id,
      sourceEvidenceId: canonicalEventLedger.sourceEvidenceId,
    })
    .from(canonicalEventLedger)
    .innerJoin(
      sourceEvidenceLog,
      eq(canonicalEventLedger.sourceEvidenceId, sourceEvidenceLog.id),
    )
    .leftJoin(
      canonicalEventAudience,
      eq(canonicalEventAudience.canonicalEventId, canonicalEventLedger.id),
    )
    .where(
      and(
        eq(canonicalEventLedger.channel, "email"),
        eq(sourceEvidenceLog.provider, "gmail"),
        gte(canonicalEventLedger.occurredAt, new Date(input.since)),
        lte(canonicalEventLedger.occurredAt, new Date(input.until)),
        isNull(canonicalEventAudience.canonicalEventId),
      ),
    )
    .orderBy(asc(canonicalEventLedger.occurredAt), asc(canonicalEventLedger.id))
    .limit(input.limit + 1);

  return {
    candidates: rows.slice(0, input.limit),
    truncated: rows.length > input.limit,
  };
}

async function applyAudienceBackfillForEvent(input: {
  readonly db: Stage1Database;
  readonly canonicalEvent: CanonicalEventRecord;
  readonly gmailMessageDetail: GmailMessageDetailRecord;
  readonly execute: boolean;
}): Promise<number> {
  let dryRunAudienceCount = 0;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const audienceCount = await applyCanonicalEventAudience(
      {
        persistence,
        service: normalization,
      },
      {
        canonicalEvent: input.canonicalEvent,
        gmailMessageDetail: input.gmailMessageDetail,
        openedAt: input.canonicalEvent.occurredAt,
      },
    );

    if (!input.execute) {
      dryRunAudienceCount = audienceCount;
      throw new DryRunRollback();
    }

    return audienceCount;
  };

  if (!input.execute) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    return dryRunAudienceCount;
  }

  return input.db.transaction(runInTransaction);
}

export async function backfillCanonicalEventAudience(input: {
  readonly db: Stage1Database;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly since: string;
  readonly until: string;
  readonly execute: boolean;
  readonly limit: number;
  readonly logger?: Logger;
}): Promise<BackfillCanonicalEventAudienceResult> {
  const logger = input.logger ?? console;
  const { candidates, truncated } = await loadCandidateRows({
    db: input.db,
    since: input.since,
    until: input.until,
    limit: input.limit,
  });
  const canonicalEvents = await input.repositories.canonicalEvents.listByIds(
    candidates.map((candidate) => candidate.canonicalEventId),
  );
  const canonicalEventsById = new Map(
    canonicalEvents.map((event) => [event.id, event]),
  );
  const gmailDetails = await input.repositories.gmailMessageDetails.listBySourceEvidenceIds(
    candidates.map((candidate) => candidate.sourceEvidenceId),
  );
  const gmailDetailsBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );

  let applied = 0;
  let skipped = 0;
  const byReason: Record<SkipReason, number> = {
    no_gmail_detail: 0,
    no_header_emails: 0,
  };

  for (const candidate of candidates) {
    const canonicalEvent = canonicalEventsById.get(candidate.canonicalEventId);

    if (canonicalEvent === undefined) {
      throw new Error(
        `Expected canonical event ${candidate.canonicalEventId} to exist.`,
      );
    }

    const gmailMessageDetail = gmailDetailsBySourceEvidenceId.get(
      candidate.sourceEvidenceId,
    );

    if (gmailMessageDetail === undefined) {
      skipped += 1;
      byReason.no_gmail_detail += 1;
      logEntry(logger, {
        action: "skipped",
        canonicalEventId: canonicalEvent.id,
        sourceEvidenceId: canonicalEvent.sourceEvidenceId,
        reason: "no_gmail_detail",
      });
      continue;
    }

    if (!hasHeaderEmails(gmailMessageDetail)) {
      skipped += 1;
      byReason.no_header_emails += 1;
      logEntry(logger, {
        action: "skipped",
        canonicalEventId: canonicalEvent.id,
        sourceEvidenceId: canonicalEvent.sourceEvidenceId,
        reason: "no_header_emails",
      });
      continue;
    }

    const audienceCount = await applyAudienceBackfillForEvent({
      db: input.db,
      canonicalEvent,
      gmailMessageDetail,
      execute: input.execute,
    });

    applied += 1;
    logEntry(logger, {
      action: input.execute ? "applied" : "dryRun",
      canonicalEventId: canonicalEvent.id,
      sourceEvidenceId: canonicalEvent.sourceEvidenceId,
      audienceCount,
    });
  }

  return {
    dryRun: !input.execute,
    since: input.since,
    until: input.until,
    candidates: candidates.length,
    applied,
    skipped,
    truncated,
    byReason,
  };
}

export async function runBackfillCanonicalEventAudienceCommand(
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
  const limit = readOptionalIntegerFlag(flags, "limit", 5000);

  if (new Date(since).getTime() > new Date(until).getTime()) {
    throw new Error("Flag --since must be earlier than or equal to --until.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const result = await backfillCanonicalEventAudience({
      db: connection.db,
      repositories,
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

async function main(): Promise<void> {
  await runBackfillCanonicalEventAudienceCommand(
    process.argv.slice(2),
    process.env,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Canonical event audience backfill failed.",
    );
    process.exitCode = 1;
  });
}
