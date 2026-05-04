#!/usr/bin/env tsx
/**
 * backfill-inbox-projection-coverage
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:backfill-inbox-projection-coverage
 *   pnpm --filter @as-comms/worker ops:backfill-inbox-projection-coverage --execute
 *   pnpm --filter @as-comms/worker ops:backfill-inbox-projection-coverage --execute --batch-size 250 --limit 1000
 *
 * Dry-run by default. Finds contacts with canonical events but no inbox
 * projection row, then rebuilds inbox projections in batches through the
 * existing projection_rebuild orchestration path.
 */
import process from "node:process";

import { asc, eq, isNull } from "drizzle-orm";

import {
  projectionRebuildBatchPayloadSchema,
  stage1JobVersion
} from "@as-comms/contracts";
import {
  canonicalEventLedger,
  closeDatabaseConnection,
  contactInboxProjection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection,
  type Stage1Database
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  qualifiesForInboxProjection,
  type Stage1PersistenceService
} from "@as-comms/domain";

import { createStage1IngestService } from "../ingest/index.js";
import {
  createStage1WorkerOrchestrationService,
  type Stage1WorkerOrchestrationService
} from "../orchestration/index.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag
} from "./helpers.js";

const defaultBatchSize = 100;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface CandidateContactRow {
  readonly contact_id: string;
}

interface BackfillServices {
  readonly persistence: Stage1PersistenceService;
  readonly orchestration: Pick<
    Stage1WorkerOrchestrationService,
    "runProjectionRebuildBatch"
  >;
}

export interface BackfillInboxProjectionCoverageResult {
  readonly dryRun: boolean;
  readonly candidateCount: number;
  readonly scannedCount: number;
  readonly insertedCount: number;
  readonly skippedCount: number;
  readonly errorCount: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command."
    );
  }

  return connectionString;
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildUnexpectedCapturePorts() {
  const unexpectedUse = () =>
    Promise.reject(
      new Error(
        "This ops command should not call provider capture ports while rebuilding inbox projections."
      )
    );

  return {
    gmail: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse
    },
    salesforce: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse
    },
    simpleTexting: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse
    },
    mailchimp: {
      captureHistoricalBatch: unexpectedUse,
      captureTransitionBatch: unexpectedUse
    }
  };
}

function createProjectionRebuildOrchestration(
  connection: DatabaseConnection
): BackfillServices {
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);

  return {
    persistence,
    orchestration: createStage1WorkerOrchestrationService({
      capture: buildUnexpectedCapturePorts(),
      ingest,
      normalization,
      persistence,
      gmailHistoricalReplay: {
        liveAccount: "unused@example.org",
        projectInboxAliases: []
      }
    })
  };
}

export async function loadBackfillInboxProjectionCoverageCandidateContactIds(
  connection: Pick<DatabaseConnection, "sql">,
  input?: {
    readonly limit?: number | null;
  }
): Promise<readonly string[]> {
  const limitClause =
    input?.limit === null || input?.limit === undefined
      ? connection.sql``
      : connection.sql`limit ${input.limit}`;

  const rows = await connection.sql<readonly CandidateContactRow[]>`
    select distinct canonical_event_ledger.contact_id
    from canonical_event_ledger
    left join contact_inbox_projection
      on contact_inbox_projection.contact_id = canonical_event_ledger.contact_id
    where contact_inbox_projection.contact_id is null
    order by canonical_event_ledger.contact_id asc
    ${limitClause}
  `;

  return rows.map((row) => row.contact_id);
}

export async function loadBackfillInboxProjectionCoverageCandidateContactIdsFromDb(
  db: Stage1Database,
  input?: {
    readonly limit?: number | null;
  }
): Promise<readonly string[]> {
  const baseQuery = db
    .select({
      contactId: canonicalEventLedger.contactId
    })
    .from(canonicalEventLedger)
    .leftJoin(
      contactInboxProjection,
      eq(contactInboxProjection.contactId, canonicalEventLedger.contactId)
    )
    .where(isNull(contactInboxProjection.contactId))
    .groupBy(canonicalEventLedger.contactId)
    .orderBy(asc(canonicalEventLedger.contactId));

  const rows =
    input?.limit === null || input?.limit === undefined
      ? await baseQuery
      : await baseQuery.limit(input.limit);

  return rows.map((row) => row.contactId);
}

async function classifyDryRunContact(
  persistence: Stage1PersistenceService,
  contactId: string
): Promise<"inserted" | "skipped"> {
  const events = await persistence.repositories.canonicalEvents.listByContactId(
    contactId
  );

  return events.some((event) => qualifiesForInboxProjection(event))
    ? "inserted"
    : "skipped";
}

function printSummary(
  result: BackfillInboxProjectionCoverageResult,
  logger: Logger
): void {
  const actionLabel = result.dryRun
    ? "projections that would be inserted"
    : "projections inserted";
  const rows: readonly [string, string][] = [
    ["candidate contacts", String(result.candidateCount)],
    ["contacts scanned", String(result.scannedCount)],
    [actionLabel, String(result.insertedCount)],
    ["contacts skipped", String(result.skippedCount)],
    ["errors", String(result.errorCount)]
  ];
  const labelWidth = rows.reduce(
    (max, [label]) => Math.max(max, label.length),
    0
  );

  logger.log("Summary:");
  for (const [label, value] of rows) {
    logger.log(`- ${label.padEnd(labelWidth, " ")}  ${value}`);
  }
}

export async function backfillInboxProjectionCoverage(input: {
  readonly candidateContactIds: readonly string[];
  readonly services: BackfillServices;
  readonly dryRun: boolean;
  readonly batchSize?: number;
  readonly logger?: Logger;
}): Promise<BackfillInboxProjectionCoverageResult> {
  const logger = input.logger ?? console;
  const batchSize = input.batchSize ?? defaultBatchSize;
  const batches = chunkValues(input.candidateContactIds, batchSize);
  let scannedCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  logger.log("backfill-inbox-projection-coverage");
  logger.log(`Mode: ${input.dryRun ? "dry-run" : "execute"}`);
  logger.log(`- candidate contacts: ${String(input.candidateContactIds.length)}`);
  logger.log(`- batch size: ${String(batchSize)}`);

  for (const [index, chunk] of batches.entries()) {
    if (input.dryRun) {
      const classifications = await Promise.all(
        chunk.map((contactId) =>
          classifyDryRunContact(input.services.persistence, contactId)
        )
      );
      const batchInsertedCount = classifications.filter(
        (outcome) => outcome === "inserted"
      ).length;
      const batchSkippedCount = chunk.length - batchInsertedCount;

      scannedCount += chunk.length;
      insertedCount += batchInsertedCount;
      skippedCount += batchSkippedCount;

      logger.log(
        `- batch ${String(index + 1)} / ${String(batches.length)}: scanned ${String(scannedCount)} / ${String(input.candidateContactIds.length)} contacts; would insert ${String(insertedCount)} projections, skip ${String(skippedCount)}`
      );
      continue;
    }

    try {
      const result = await input.services.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId: buildOperationId("ops:backfill-inbox-projection-coverage:job"),
          correlationId: buildOperationId(
            "ops:backfill-inbox-projection-coverage:correlation"
          ),
          traceId: null,
          batchId: buildOperationId(
            "ops:backfill-inbox-projection-coverage:batch"
          ),
          syncStateId: buildOperationId(
            "ops:backfill-inbox-projection-coverage:sync-state"
          ),
          attempt: 1,
          maxAttempts: 1,
          jobType: "projection_rebuild",
          projection: "inbox",
          contactIds: chunk,
          includeReviewOverlayRefresh: true
        })
      );

      if (result.outcome !== "succeeded") {
        const failureMessage = result.failure?.message ?? "unknown failure";
        throw new Error(failureMessage);
      }

      const projections = await Promise.all(
        chunk.map((contactId) =>
          input.services.persistence.repositories.inboxProjection.findByContactId(
            contactId
          )
        )
      );
      const batchInsertedCount = projections.filter((row) => row !== null).length;
      const batchSkippedCount = chunk.length - batchInsertedCount;

      scannedCount += chunk.length;
      insertedCount += batchInsertedCount;
      skippedCount += batchSkippedCount;

      logger.log(
        `- batch ${String(index + 1)} / ${String(batches.length)}: scanned ${String(scannedCount)} / ${String(input.candidateContactIds.length)} contacts; inserted ${String(insertedCount)} projections, skipped ${String(skippedCount)}`
      );
    } catch (error) {
      scannedCount += chunk.length;
      errorCount += chunk.length;
      logger.error(
        `- batch ${String(index + 1)} / ${String(batches.length)} failed for ${String(chunk.length)} contacts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const summary = {
    dryRun: input.dryRun,
    candidateCount: input.candidateContactIds.length,
    scannedCount,
    insertedCount,
    skippedCount,
    errorCount
  } as const satisfies BackfillInboxProjectionCoverageResult;

  printSummary(summary, logger);
  return summary;
}

export async function runBackfillInboxProjectionCoverageCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<BackfillInboxProjectionCoverageResult> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const batchSize = readOptionalIntegerFlag(
    flags,
    "batch-size",
    defaultBatchSize
  );
  const limit = readOptionalIntegerFlag(flags, "limit", 0) || null;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env)
  });

  try {
    const candidateContactIds =
      await loadBackfillInboxProjectionCoverageCandidateContactIds(connection, {
        limit
      });
    const services = createProjectionRebuildOrchestration(connection);

    return await backfillInboxProjectionCoverage({
      candidateContactIds,
      services,
      dryRun,
      batchSize
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runBackfillInboxProjectionCoverageCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "backfill-inbox-projection-coverage failed.";

      console.error(message);
      process.exitCode = 1;
    }
  );
}
