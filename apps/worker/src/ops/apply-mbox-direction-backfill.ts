#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import {
  canonicalEventLedger,
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  gmailMessageDetails,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1PersistenceService,
  rebuildInboxProjectionForContact,
} from "@as-comms/domain";

import { parseCliFlags, readOptionalBooleanFlag, readRequiredFlag } from "./helpers.js";

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

interface ApplyCsvRow {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string | null;
  readonly currentDirection: string;
  readonly suggestedDirection: string;
  readonly confidence: string;
}

interface LiveCandidateState {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly direction: string | null;
  readonly eventType: string;
}

export interface ApplyMboxDirectionBackfillResult {
  readonly csvRowsConsidered: number;
  readonly flipped: number;
  readonly skippedAlreadyOutbound: number;
  readonly skippedFilterMismatch: number;
  readonly skippedUnexpectedState: number;
  readonly contactsAffected: number;
  readonly projectionsRebuilt: number;
  readonly dryRun: boolean;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString.trim();
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === undefined) {
      continue;
    }

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    if (char !== "\r") {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  const [header, ...body] = rows;

  if (header === undefined) {
    return [];
  }

  return body
    .filter((row) => row.length === header.length)
    .map((row) =>
      Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])),
    );
}

function readRequiredCsvCell(row: Record<string, string>, key: string): string {
  const value = row[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`CSV row is missing required column ${key}.`);
  }

  return value.trim();
}

function parseApplyCsvRow(row: Record<string, string>): ApplyCsvRow {
  const sourceEvidenceId = row.source_evidence_id?.trim();

  return {
    canonicalEventId: readRequiredCsvCell(row, "canonical_event_id"),
    sourceEvidenceId:
      sourceEvidenceId === undefined || sourceEvidenceId.length === 0
        ? null
        : sourceEvidenceId,
    currentDirection: readRequiredCsvCell(row, "current_direction"),
    suggestedDirection: readRequiredCsvCell(row, "suggested_direction"),
    confidence: readRequiredCsvCell(row, "confidence"),
  };
}

function buildFilterMismatchReason(row: ApplyCsvRow): string {
  return `filter mismatch: suggested_direction=${row.suggestedDirection}, confidence=${row.confidence}, current_direction=${row.currentDirection}`;
}

async function loadLiveCandidateState(
  db: Stage1Database,
  row: ApplyCsvRow,
): Promise<LiveCandidateState | null> {
  const [ledgerRow] = await db
    .select({
      canonicalEventId: canonicalEventLedger.id,
      contactId: canonicalEventLedger.contactId,
      sourceEvidenceId: canonicalEventLedger.sourceEvidenceId,
      eventType: canonicalEventLedger.eventType,
    })
    .from(canonicalEventLedger)
    .where(eq(canonicalEventLedger.id, row.canonicalEventId));

  if (ledgerRow === undefined) {
    return null;
  }

  const [gmailDetail] = await db
    .select({
      direction: gmailMessageDetails.direction,
    })
    .from(gmailMessageDetails)
    .where(eq(gmailMessageDetails.sourceEvidenceId, ledgerRow.sourceEvidenceId));

  return {
    canonicalEventId: ledgerRow.canonicalEventId,
    contactId: ledgerRow.contactId,
    sourceEvidenceId: ledgerRow.sourceEvidenceId,
    direction: gmailDetail?.direction ?? null,
    eventType: ledgerRow.eventType,
  };
}

function logSummary(
  logger: Logger,
  result: ApplyMboxDirectionBackfillResult,
): void {
  logger.log(`[apply] CSV rows considered: ${String(result.csvRowsConsidered)}`);
  logger.log(`[apply] flipped: ${String(result.flipped)}`);
  logger.log(
    `[apply] skipped (already outbound): ${String(result.skippedAlreadyOutbound)}`,
  );
  logger.log(
    `[apply] skipped (filter mismatch): ${String(result.skippedFilterMismatch)}`,
  );
  logger.log(
    `[apply] skipped (unexpected state): ${String(result.skippedUnexpectedState)}`,
  );
  logger.log(`[apply] contacts affected: ${String(result.contactsAffected)}`);
  logger.log(`[apply] projections rebuilt: ${String(result.projectionsRebuilt)}`);

  if (result.dryRun) {
    logger.log("[apply] DRY RUN - no changes persisted");
  }
}

export async function applyMboxDirectionBackfill(input: {
  readonly db: Stage1Database;
  readonly csvPath: string;
  readonly dryRun: boolean;
  readonly logger?: Logger;
}): Promise<ApplyMboxDirectionBackfillResult> {
  const logger = input.logger ?? {
    log(message: string) {
      console.log(message);
    },
    error(message: string) {
      console.error(message);
    },
  };
  const repositories = createStage1RepositoryBundle(input.db);
  const persistence = createStage1PersistenceService(repositories);
  const csvText = await readFile(input.csvPath, "utf8");
  const csvRows = parseCsv(csvText).map(parseApplyCsvRow);
  const affectedContactIds = new Set<string>();
  let flipped = 0;
  let skippedAlreadyOutbound = 0;
  let skippedFilterMismatch = 0;
  let skippedUnexpectedState = 0;

  for (const row of csvRows) {
    const matchesFilter =
      row.suggestedDirection === "outbound" &&
      row.confidence === "high" &&
      row.currentDirection === "inbound";

    if (!matchesFilter) {
      skippedFilterMismatch += 1;
      logger.log(
        `[apply] skip event=${row.canonicalEventId} reason=${buildFilterMismatchReason(row)}`,
      );
      continue;
    }

    const liveState = await loadLiveCandidateState(input.db, row);

    if (liveState === null) {
      skippedUnexpectedState += 1;
      logger.log(
        `[apply] event=${row.canonicalEventId} skipped (unexpected state: direction=null, event_type=null)`,
      );
      continue;
    }

    if (
      liveState.direction === "outbound" ||
      liveState.eventType.endsWith(".outbound")
    ) {
      skippedAlreadyOutbound += 1;
      logger.log(`[apply] event=${row.canonicalEventId} skipped (already outbound)`);
      continue;
    }

    if (
      liveState.direction !== "inbound" ||
      !liveState.eventType.endsWith(".inbound")
    ) {
      skippedUnexpectedState += 1;
      logger.log(
        `[apply] event=${row.canonicalEventId} skipped (unexpected state: direction=${liveState.direction ?? "null"}, event_type=${liveState.eventType})`,
      );
      continue;
    }

    if (!input.dryRun) {
      const updatedAt = new Date();

      await input.db.transaction(async (tx) => {
        await tx
          .update(gmailMessageDetails)
          .set({
            direction: "outbound",
            updatedAt,
          })
          .where(eq(gmailMessageDetails.sourceEvidenceId, liveState.sourceEvidenceId));

        await tx
          .update(canonicalEventLedger)
          .set({
            eventType: "communication.email.outbound",
            updatedAt,
          })
          .where(eq(canonicalEventLedger.id, liveState.canonicalEventId));
      });

      logger.log(
        `[apply] event=${row.canonicalEventId} flipped inbound->outbound contact=${liveState.contactId}`,
      );
    } else {
      logger.log(
        `[apply] event=${row.canonicalEventId} would flip inbound->outbound contact=${liveState.contactId}`,
      );
    }

    flipped += 1;
    affectedContactIds.add(liveState.contactId);
  }

  let projectionsRebuilt = 0;
  const dedupedContactIds = [...affectedContactIds].sort((left, right) =>
    left.localeCompare(right),
  );

  if (!input.dryRun) {
    for (const [index, contactId] of dedupedContactIds.entries()) {
      await rebuildInboxProjectionForContact(persistence, contactId);
      projectionsRebuilt += 1;
      logger.log(
        `[apply] rebuilt projection for contact=${contactId} (${String(index + 1)} of ${String(dedupedContactIds.length)})`,
      );
    }
  }

  const result: ApplyMboxDirectionBackfillResult = {
    csvRowsConsidered: csvRows.length,
    flipped,
    skippedAlreadyOutbound,
    skippedFilterMismatch,
    skippedUnexpectedState,
    contactsAffected: dedupedContactIds.length,
    projectionsRebuilt,
    dryRun: input.dryRun,
  };

  logSummary(logger, result);
  return result;
}

export async function runApplyMboxDirectionBackfillCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApplyMboxDirectionBackfillResult> {
  const flags = parseCliFlags(args);
  const csvPath = readRequiredFlag(flags, "csv-path");
  const dryRun = readOptionalBooleanFlag(flags, "dry-run", false);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    return await applyMboxDirectionBackfill({
      db: connection.db as Stage1Database,
      csvPath,
      dryRun,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runApplyMboxDirectionBackfillCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const resolvedError =
        error instanceof Error ? error : new Error(String(error));

      console.error(`[apply:fatal] ${resolvedError.message}`);
      console.error(resolvedError.stack ?? "(no stack)");
      process.exitCode = 1;
    },
  );
}
