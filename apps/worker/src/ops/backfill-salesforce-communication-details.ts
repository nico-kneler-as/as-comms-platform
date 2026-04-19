#!/usr/bin/env tsx
/**
 * backfill-salesforce-communication-details
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops backfill-salesforce-communication-details --dry-run
 *   pnpm --filter @as-comms/worker ops backfill-salesforce-communication-details --confirm
 *
 * Dry-run by default. Re-fetches Salesforce Task communication records that
 * already normalized into canonical events but pre-date the April 17, 2026
 * salesforce_communication_details writer path, then rebuilds projections for
 * the affected contacts.
 */
import process from "node:process";

import {
  projectionRebuildBatchPayloadSchema,
  salesforceCommunicationDetailSchema,
  salesforceHistoricalCaptureBatchPayloadSchema,
  stage1JobVersion,
  type SalesforceCommunicationDetailRecord
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  type Stage1PersistenceService
} from "@as-comms/domain";
import {
  capturePortHttpConfigSchema,
  createSalesforceCapturePort,
  mapSalesforceRecord,
  salesforceTaskCommunicationRecordSchema,
  type CapturePortHttpConfig,
  type SalesforceRecord,
  type SalesforceTaskCommunicationRecord
} from "@as-comms/integrations";

import { createStage1IngestService } from "../ingest/index.js";
import {
  createStage1WorkerOrchestrationService,
  type Stage1WorkerOrchestrationService
} from "../orchestration/index.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag
} from "./helpers.js";

const candidateChunkSize = 500;
const projectionChunkSize = 250;
const sampleLimit = 10;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface MissingDetailCandidateRow {
  readonly source_evidence_id: string;
  readonly provider_record_id: string;
  readonly payload_ref: string;
  readonly contact_id: string;
}

export interface SalesforceCommunicationDetailBackfillCandidate {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly payloadRef: string;
  readonly contactId: string;
}

export interface PreparedSalesforceCommunicationDetail {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly contactId: string;
  readonly detail: SalesforceCommunicationDetailRecord;
}

export interface SalesforceCommunicationDetailBackfillPreparation {
  readonly prepared: readonly PreparedSalesforceCommunicationDetail[];
  readonly missing: readonly SalesforceCommunicationDetailBackfillCandidate[];
}

export interface BackfillSalesforceCommunicationDetailsResult {
  readonly dryRun: boolean;
  readonly candidateCount: number;
  readonly preparedCount: number;
  readonly upsertedCount: number;
  readonly rebuiltContactCount: number;
  readonly affectedContactIds: readonly string[];
  readonly missingProviderRecordIds: readonly string[];
  readonly sampleDetails: readonly PreparedSalesforceCommunicationDetail[];
}

interface BackfillRuntime {
  readonly connection: DatabaseConnection;
  readonly sql: SqlRunner;
  readonly persistence: Stage1PersistenceService;
  readonly salesforceCapture: ReturnType<typeof createSalesforceCapturePort>;
  readonly orchestration: Pick<
    Stage1WorkerOrchestrationService,
    "runProjectionRebuildBatch"
  >;
  dispose(): Promise<void>;
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
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

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for this ops command.`);
  }

  return value;
}

function readOptionalPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string
): number | undefined {
  const rawValue = env[key]?.trim();

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return parsed;
}

function readSalesforceCaptureConfig(
  env: NodeJS.ProcessEnv
): CapturePortHttpConfig {
  return capturePortHttpConfigSchema.parse({
    baseUrl: readRequiredEnv(env, "SALESFORCE_CAPTURE_BASE_URL"),
    bearerToken: readRequiredEnv(env, "SALESFORCE_CAPTURE_TOKEN"),
    timeoutMs: readOptionalPositiveIntegerEnv(env, "SALESFORCE_CAPTURE_TIMEOUT_MS")
  });
}

function createUnusedCapturePorts(
  salesforceCapture: ReturnType<typeof createSalesforceCapturePort>
) {
  const unexpectedUse = (): Promise<never> => {
    return Promise.reject(
      new Error(
        "This ops runtime only supports projection rebuilds plus direct Salesforce Task capture."
      )
    );
  };

  return {
    gmail: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse
    },
    salesforce: salesforceCapture,
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

function createBackfillRuntime(input: {
  readonly connectionString: string;
  readonly salesforceCaptureConfig: CapturePortHttpConfig;
}): BackfillRuntime {
  const connection = createDatabaseConnection({
    connectionString: input.connectionString
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);
  const salesforceCapture = createSalesforceCapturePort(
    input.salesforceCaptureConfig
  );
  const orchestration = createStage1WorkerOrchestrationService({
    capture: createUnusedCapturePorts(salesforceCapture),
    ingest,
    normalization,
    persistence,
    gmailHistoricalReplay: {
      liveAccount: "unused@example.org",
      projectInboxAliases: []
    }
  });

  return {
    connection,
    sql: connection.sql as unknown as SqlRunner,
    persistence,
    salesforceCapture,
    orchestration,
    async dispose() {
      await closeDatabaseConnection(connection);
    }
  };
}

async function loadMissingDetailCandidates(
  sql: SqlRunner
): Promise<readonly SalesforceCommunicationDetailBackfillCandidate[]> {
  const rows = await sql.unsafe<readonly MissingDetailCandidateRow[]>(`
    select
      source_evidence_log.id as source_evidence_id,
      source_evidence_log.provider_record_id,
      source_evidence_log.payload_ref,
      canonical_event_ledger.contact_id
    from source_evidence_log
    join canonical_event_ledger
      on canonical_event_ledger.source_evidence_id = source_evidence_log.id
    left join salesforce_communication_details
      on salesforce_communication_details.source_evidence_id = source_evidence_log.id
    where source_evidence_log.provider = 'salesforce'
      and source_evidence_log.provider_record_type = 'task_communication'
      and salesforce_communication_details.source_evidence_id is null
    order by source_evidence_log.occurred_at asc, source_evidence_log.id asc
  `);

  return rows.map((row) => {
    const parsedPayloadRef = parseSalesforceTaskPayloadRef(row.payload_ref);

    if (parsedPayloadRef.recordId !== row.provider_record_id) {
      throw new Error(
        `Expected source evidence ${row.source_evidence_id} payloadRef record ${parsedPayloadRef.recordId} to match provider_record_id ${row.provider_record_id}.`
      );
    }

    return {
      sourceEvidenceId: row.source_evidence_id,
      providerRecordId: row.provider_record_id,
      payloadRef: row.payload_ref,
      contactId: row.contact_id
    };
  });
}

export function parseSalesforceTaskPayloadRef(payloadRef: string): {
  readonly objectName: "Task";
  readonly recordId: string;
} {
  let url: URL;

  try {
    url = new URL(payloadRef);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid Salesforce Task payloadRef ${payloadRef}: ${error.message}`
        : `Invalid Salesforce Task payloadRef ${payloadRef}.`
    );
  }

  if (url.protocol !== "salesforce:") {
    throw new Error(
      `Expected Salesforce Task payloadRef to use the salesforce:// scheme, received ${payloadRef}.`
    );
  }

  if (url.hostname !== "Task") {
    throw new Error(
      `Expected Salesforce Task payloadRef to target the Task object, received ${payloadRef}.`
    );
  }

  const encodedRecordId = url.pathname.replace(/^\/+/u, "");
  const recordId = decodeURIComponent(encodedRecordId);

  if (recordId.length === 0) {
    throw new Error(
      `Expected Salesforce Task payloadRef to include a Task id, received ${payloadRef}.`
    );
  }

  return {
    objectName: "Task",
    recordId
  };
}

export function buildSalesforceCommunicationDetailFromTaskRecord(
  taskRecord: SalesforceTaskCommunicationRecord
): SalesforceCommunicationDetailRecord {
  const mapped = mapSalesforceRecord(taskRecord);

  if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
    throw new Error(
      `Expected Salesforce Task ${taskRecord.recordId} to map into a canonical event command.`
    );
  }

  const detail = mapped.command.input.salesforceCommunicationDetail;

  if (detail === undefined) {
    throw new Error(
      `Expected Salesforce Task ${taskRecord.recordId} mapping to produce salesforceCommunicationDetail.`
    );
  }

  return salesforceCommunicationDetailSchema.parse(detail);
}

export function prepareSalesforceCommunicationDetailsFromCapturedRecords(input: {
  readonly candidates: readonly SalesforceCommunicationDetailBackfillCandidate[];
  readonly capturedRecords: readonly SalesforceRecord[];
}): SalesforceCommunicationDetailBackfillPreparation {
  const requestedRecordIds = new Set(
    input.candidates.map((candidate) => candidate.providerRecordId)
  );
  const taskRecordById = new Map<string, SalesforceTaskCommunicationRecord>();

  for (const record of input.capturedRecords) {
    const parsed = salesforceTaskCommunicationRecordSchema.safeParse(record);

    if (!parsed.success || !requestedRecordIds.has(parsed.data.recordId)) {
      continue;
    }

    taskRecordById.set(parsed.data.recordId, parsed.data);
  }

  const prepared: PreparedSalesforceCommunicationDetail[] = [];
  const missing: SalesforceCommunicationDetailBackfillCandidate[] = [];

  for (const candidate of input.candidates) {
    const parsedPayloadRef = parseSalesforceTaskPayloadRef(candidate.payloadRef);

    if (parsedPayloadRef.recordId !== candidate.providerRecordId) {
      throw new Error(
        `Expected candidate payloadRef ${candidate.payloadRef} to match providerRecordId ${candidate.providerRecordId}.`
      );
    }

    const taskRecord = taskRecordById.get(candidate.providerRecordId);

    if (taskRecord === undefined) {
      missing.push(candidate);
      continue;
    }

    const detail = buildSalesforceCommunicationDetailFromTaskRecord(taskRecord);

    if (detail.sourceEvidenceId !== candidate.sourceEvidenceId) {
      throw new Error(
        `Expected mapped detail sourceEvidenceId ${detail.sourceEvidenceId} to match candidate ${candidate.sourceEvidenceId}.`
      );
    }

    prepared.push({
      sourceEvidenceId: candidate.sourceEvidenceId,
      providerRecordId: candidate.providerRecordId,
      contactId: candidate.contactId,
      detail
    });
  }

  return {
    prepared,
    missing
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateForLog(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function printSampleDetails(
  logger: Logger,
  sampleDetails: readonly PreparedSalesforceCommunicationDetail[]
): void {
  if (sampleDetails.length === 0) {
    logger.log("No Salesforce Task detail rows were prepared.");
    return;
  }

  logger.log(`Sample detail rows (first ${String(sampleDetails.length)}):`);
  for (const sample of sampleDetails) {
    logger.log(
      `- ${JSON.stringify({
        sourceEvidenceId: sample.sourceEvidenceId,
        contactId: sample.contactId,
        providerRecordId: sample.providerRecordId,
        channel: sample.detail.channel,
        messageKind: sample.detail.messageKind,
        subject: sample.detail.subject,
        snippet: truncateForLog(
          normalizeWhitespace(sample.detail.snippet),
          120
        ),
        sourceLabel: sample.detail.sourceLabel
      })}`
    );
  }
}

function printMissingCandidates(
  logger: Logger,
  missingCandidates: readonly SalesforceCommunicationDetailBackfillCandidate[]
): void {
  if (missingCandidates.length === 0) {
    return;
  }

  logger.log(
    `Warning: ${String(missingCandidates.length)} Salesforce Task ids could not be reconstructed from the capture service.`
  );
  logger.log("Missing Task ids (first 10):");
  for (const candidate of missingCandidates.slice(0, 10)) {
    logger.log(
      `- ${JSON.stringify({
        sourceEvidenceId: candidate.sourceEvidenceId,
        providerRecordId: candidate.providerRecordId,
        contactId: candidate.contactId
      })}`
    );
  }
}

async function rebuildProjectionsForContacts(
  orchestration: Pick<Stage1WorkerOrchestrationService, "runProjectionRebuildBatch">,
  contactIds: readonly string[],
  logger: Logger
): Promise<{
  readonly rebuiltContactCount: number;
  readonly missingProjectionSeeds: readonly string[];
}> {
  const sortedContactIds = uniqueSortedStrings(contactIds);
  const missingProjectionSeeds = new Set<string>();
  let rebuiltContactCount = 0;

  for (const [index, chunk] of chunkValues(
    sortedContactIds,
    projectionChunkSize
  ).entries()) {
    const result = await orchestration.runProjectionRebuildBatch(
      projectionRebuildBatchPayloadSchema.parse({
        version: stage1JobVersion,
        jobId: buildOperationId("stage1:projection-rebuild:job"),
        correlationId: buildOperationId("stage1:projection-rebuild:correlation"),
        traceId: null,
        batchId: buildOperationId("stage1:projection-rebuild:batch"),
        syncStateId: buildOperationId("stage1:projection-rebuild:sync-state"),
        attempt: 1,
        maxAttempts: 1,
        jobType: "projection_rebuild",
        projection: "all",
        contactIds: chunk,
        includeReviewOverlayRefresh: true
      })
    );

    if (result.outcome !== "succeeded") {
      const failureMessage = result.failure?.message ?? "unknown failure";
      throw new Error(
        `Projection rebuild batch ${String(index + 1)} failed: ${failureMessage}`
      );
    }

    rebuiltContactCount += result.rebuiltContactIds.length;
    for (const canonicalEventId of result.missingProjectionSeeds) {
      missingProjectionSeeds.add(canonicalEventId);
    }

    logger.log(
      `- rebuilt projections for ${String(rebuiltContactCount)} / ${String(sortedContactIds.length)} contacts`
    );
  }

  return {
    rebuiltContactCount,
    missingProjectionSeeds: Array.from(missingProjectionSeeds).sort((left, right) =>
      left.localeCompare(right)
    )
  };
}

export async function runBackfillSalesforceCommunicationDetails(input: {
  readonly connectionString: string;
  readonly salesforceCaptureConfig: CapturePortHttpConfig;
  readonly dryRun: boolean;
  readonly logger?: Logger;
}): Promise<BackfillSalesforceCommunicationDetailsResult> {
  const logger = input.logger ?? console;
  const runtime = createBackfillRuntime({
    connectionString: input.connectionString,
    salesforceCaptureConfig: input.salesforceCaptureConfig
  });

  try {
    const candidates = await loadMissingDetailCandidates(runtime.sql);
    const affectedContactIds = new Set<string>();
    const missingCandidates: SalesforceCommunicationDetailBackfillCandidate[] = [];
    const sampleDetails: PreparedSalesforceCommunicationDetail[] = [];
    let preparedCount = 0;
    let upsertedCount = 0;

    logger.log("backfill-salesforce-communication-details");
    logger.log(`Mode: ${input.dryRun ? "dry-run" : "confirm"}`);
    logger.log(
      `- Salesforce Task rows missing detail: ${String(candidates.length)}`
    );
    logger.log(
      `- candidate fetch/upsert chunk size: ${String(candidateChunkSize)}`
    );

    for (const [index, chunk] of chunkValues(candidates, candidateChunkSize).entries()) {
      const captured = await runtime.salesforceCapture.captureHistoricalBatch(
        salesforceHistoricalCaptureBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId: buildOperationId("stage1:sf-details-backfill:job"),
          correlationId: buildOperationId(
            "stage1:sf-details-backfill:correlation"
          ),
          traceId: null,
          batchId: buildOperationId("stage1:sf-details-backfill:batch"),
          syncStateId: buildOperationId("stage1:sf-details-backfill:sync-state"),
          attempt: 1,
          maxAttempts: 1,
          provider: "salesforce",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          recordIds: chunk.map((candidate) => candidate.providerRecordId),
          // Record-id fetches only fan out to the requested Task rows plus at
          // most one contact snapshot per touched contact, so 500 Task ids stay
          // within the capture contract's 1000-record ceiling.
          maxRecords: 1000
        })
      );

      if (captured.nextCursor !== null) {
        throw new Error(
          `Expected record-id Task backfill fetches to fit in a single capture page, but chunk ${String(index + 1)} returned nextCursor ${captured.nextCursor}.`
        );
      }

      const preparedChunk = prepareSalesforceCommunicationDetailsFromCapturedRecords({
        candidates: chunk,
        capturedRecords: captured.records
      });

      preparedCount += preparedChunk.prepared.length;
      missingCandidates.push(...preparedChunk.missing);

      for (const preparedRecord of preparedChunk.prepared) {
        affectedContactIds.add(preparedRecord.contactId);

        if (sampleDetails.length < sampleLimit) {
          sampleDetails.push(preparedRecord);
        }
      }

      if (!input.dryRun) {
        for (const preparedRecord of preparedChunk.prepared) {
          await runtime.persistence.upsertSalesforceCommunicationDetail(
            preparedRecord.detail
          );
        }

        upsertedCount += preparedChunk.prepared.length;
        logger.log(
          `- upserted ${String(upsertedCount)} / ${String(candidates.length)} detail rows`
        );
      } else {
        logger.log(
          `- prepared ${String(preparedCount)} / ${String(candidates.length)} detail rows`
        );
      }
    }

    printSampleDetails(logger, sampleDetails);
    printMissingCandidates(logger, missingCandidates);

    if (input.dryRun) {
      logger.log(
        "Dry run complete. Re-run with --confirm to write detail rows and rebuild projections."
      );

      return {
        dryRun: true,
        candidateCount: candidates.length,
        preparedCount,
        upsertedCount: 0,
        rebuiltContactCount: 0,
        affectedContactIds: uniqueSortedStrings(Array.from(affectedContactIds)),
        missingProviderRecordIds: uniqueSortedStrings(
          missingCandidates.map((candidate) => candidate.providerRecordId)
        ),
        sampleDetails
      };
    }

    const rebuildResult =
      affectedContactIds.size === 0
        ? {
            rebuiltContactCount: 0,
            missingProjectionSeeds: [] as readonly string[]
          }
        : await rebuildProjectionsForContacts(
            runtime.orchestration,
            Array.from(affectedContactIds),
            logger
          );

    if (rebuildResult.missingProjectionSeeds.length > 0) {
      logger.log(
        `Warning: projection rebuild fell back to durable seed defaults for ${String(rebuildResult.missingProjectionSeeds.length)} canonical events.`
      );
    }

    logger.log("Backfill complete.");
    logger.log(`- detail rows upserted: ${String(upsertedCount)}`);
    logger.log(
      `- contacts rebuilt: ${String(rebuildResult.rebuiltContactCount)}`
    );

    return {
      dryRun: false,
      candidateCount: candidates.length,
      preparedCount,
      upsertedCount,
      rebuiltContactCount: rebuildResult.rebuiltContactCount,
      affectedContactIds: uniqueSortedStrings(Array.from(affectedContactIds)),
      missingProviderRecordIds: uniqueSortedStrings(
        missingCandidates.map((candidate) => candidate.providerRecordId)
      ),
      sampleDetails
    };
  } finally {
    await runtime.dispose();
  }
}

export async function runBackfillSalesforceCommunicationDetailsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<BackfillSalesforceCommunicationDetailsResult> {
  const flags = parseCliFlags(args);
  const confirm = readOptionalBooleanFlag(flags, "confirm", false);
  const dryRunRequested = readOptionalBooleanFlag(flags, "dry-run", false);

  if (confirm && dryRunRequested) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }

  return runBackfillSalesforceCommunicationDetails({
    connectionString: readConnectionString(env),
    salesforceCaptureConfig: readSalesforceCaptureConfig(env),
    dryRun: dryRunRequested || !confirm
  });
}

async function main(): Promise<void> {
  await runBackfillSalesforceCommunicationDetailsCommand(process.argv.slice(2));
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "backfill-salesforce-communication-details failed."
    );
    process.exitCode = 1;
  });
}
