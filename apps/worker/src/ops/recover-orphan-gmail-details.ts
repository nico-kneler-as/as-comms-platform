#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  stage1JobVersion,
  type GmailMessageDetailRecord,
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import {
  capturePortHttpConfigSchema,
  createGmailCapturePort,
  toIsoTimestamp,
  type GmailMessageRecord,
} from "@as-comms/integrations";

import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";
import { mapLiveRecordToDetailRow } from "./backfill-gmail-message-bodies.js";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_SAMPLE_LIMIT = 5;

export const recoverOrphanGmailDetailsSql = `SELECT
  cel.id AS canonical_event_id,
  cel.source_evidence_id,
  sel.provider_record_id AS gmail_message_id,
  sel.occurred_at,
  sel.received_at,
  cel.contact_id
FROM canonical_event_ledger cel
JOIN source_evidence_log sel
  ON sel.id = cel.source_evidence_id
LEFT JOIN gmail_message_details gmd
  ON gmd.source_evidence_id = sel.id
WHERE sel.provider = 'gmail'
  AND sel.provider_record_type = 'message'
  AND gmd.source_evidence_id IS NULL
ORDER BY sel.occurred_at DESC`;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface OrphanGmailDetailRow {
  readonly canonical_event_id: string;
  readonly source_evidence_id: string;
  readonly gmail_message_id: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly contact_id: string;
}

export interface OrphanGmailDetailTarget {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly gmailMessageId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly contactId: string;
}

export type OrphanGmailRecoveryBucket = "R" | "M";

export type OrphanGmailMissingReason =
  | "mbox_import_unrecoverable"
  | "live_fetch_returned_no_record";

export interface OrphanGmailRecoveryPlan {
  readonly bucket: OrphanGmailRecoveryBucket;
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly gmailMessageId: string;
  readonly reason: OrphanGmailMissingReason | null;
  readonly detail: GmailMessageDetailRecord | null;
}

interface ExecutionErrorExample {
  readonly sourceEvidenceId: string;
  readonly gmailMessageId: string;
  readonly message: string;
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

function buildRecoverOrphanGmailDetailsSql(limit: number | null): string {
  if (limit === null) {
    return recoverOrphanGmailDetailsSql;
  }

  return `${recoverOrphanGmailDetailsSql}\nLIMIT ${limit.toString()}`;
}

export async function loadOrphanGmailDetailTargets(
  sql: SqlRunner,
  input?: {
    readonly limit?: number | null;
  },
): Promise<readonly OrphanGmailDetailTarget[]> {
  const rows = await sql.unsafe<readonly OrphanGmailDetailRow[]>(
    buildRecoverOrphanGmailDetailsSql(input?.limit ?? null),
  );

  return rows.map((row) => {
    const occurredAt = toIsoTimestamp(row.occurred_at);
    const receivedAt = toIsoTimestamp(row.received_at);

    if (occurredAt === null || receivedAt === null) {
      throw new Error(
        `Source-evidence row ${row.source_evidence_id} has unparseable timestamps (occurred_at=${row.occurred_at}, received_at=${row.received_at}).`,
      );
    }

    return {
      canonicalEventId: row.canonical_event_id,
      sourceEvidenceId: row.source_evidence_id,
      gmailMessageId: row.gmail_message_id,
      occurredAt,
      receivedAt,
      contactId: row.contact_id,
    };
  });
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function isLiveRecoveryTarget(target: OrphanGmailDetailTarget): boolean {
  return !target.gmailMessageId.startsWith("mbox:");
}

function isGmailMessageRecord(
  record: { readonly recordType: string },
): record is GmailMessageRecord {
  return record.recordType === "message";
}

function buildCapturePayload(recordIds: readonly string[], batchSize: number) {
  return {
    version: stage1JobVersion,
    jobId: buildOperationId("stage1:gmail:orphan-detail-recovery:job"),
    correlationId: buildOperationId(
      "stage1:gmail:orphan-detail-recovery:correlation",
    ),
    traceId: null,
    batchId: buildOperationId("stage1:gmail:orphan-detail-recovery:batch"),
    syncStateId: buildOperationId(
      "stage1:gmail:orphan-detail-recovery:sync-state",
    ),
    attempt: 1,
    maxAttempts: 1,
    provider: "gmail" as const,
    mode: "live" as const,
    jobType: "live_ingest" as const,
    cursor: null,
    checkpoint: null,
    windowStart: null,
    windowEnd: null,
    recordIds: [...recordIds],
    maxRecords: batchSize,
  };
}

export function planOrphanGmailRecoveryTargets(input: {
  readonly targets: readonly OrphanGmailDetailTarget[];
  readonly liveRecordsById: ReadonlyMap<string, GmailMessageRecord>;
}): readonly OrphanGmailRecoveryPlan[] {
  return input.targets.map((target) => {
    if (!isLiveRecoveryTarget(target)) {
      return {
        bucket: "M",
        canonicalEventId: target.canonicalEventId,
        sourceEvidenceId: target.sourceEvidenceId,
        gmailMessageId: target.gmailMessageId,
        reason: "mbox_import_unrecoverable",
        detail: null,
      };
    }

    const liveRecord = input.liveRecordsById.get(target.gmailMessageId);

    if (liveRecord === undefined) {
      return {
        bucket: "M",
        canonicalEventId: target.canonicalEventId,
        sourceEvidenceId: target.sourceEvidenceId,
        gmailMessageId: target.gmailMessageId,
        reason: "live_fetch_returned_no_record",
        detail: null,
      };
    }

    return {
      bucket: "R",
      canonicalEventId: target.canonicalEventId,
      sourceEvidenceId: target.sourceEvidenceId,
      gmailMessageId: target.gmailMessageId,
      reason: null,
      detail: mapLiveRecordToDetailRow({
        sourceEvidenceId: target.sourceEvidenceId,
        record: liveRecord,
      }),
    };
  });
}

export async function applyOrphanGmailRecoveryPlan(input: {
  readonly db: Stage1Database;
  readonly plan: OrphanGmailRecoveryPlan;
  readonly dryRun: boolean;
}): Promise<boolean> {
  if (input.plan.bucket !== "R") {
    return false;
  }

  if (input.plan.detail === null) {
    throw new Error(
      `Expected recovered Gmail detail row for source evidence ${input.plan.sourceEvidenceId}.`,
    );
  }

  const detail = input.plan.detail;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    await repositories.gmailMessageDetails.upsert(detail);

    if (input.dryRun) {
      throw new DryRunRollback();
    }

    return true;
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    return false;
  }

  return input.db.transaction(runInTransaction);
}

function buildMissingSample(
  plans: readonly OrphanGmailRecoveryPlan[],
): readonly {
  readonly sourceEvidenceId: string;
  readonly gmailMessageId: string;
  readonly reason: OrphanGmailMissingReason;
}[] {
  return plans.slice(0, DEFAULT_SAMPLE_LIMIT).map((plan) => {
    if (plan.reason === null) {
      throw new Error(
        `Expected missing reason for source evidence ${plan.sourceEvidenceId}.`,
      );
    }

    return {
      sourceEvidenceId: plan.sourceEvidenceId,
      gmailMessageId: plan.gmailMessageId,
      reason: plan.reason,
    };
  });
}

function addExecutionError(
  errors: ExecutionErrorExample[],
  input: {
    readonly sourceEvidenceId: string;
    readonly gmailMessageId: string;
    readonly error: unknown;
  },
): void {
  const resolvedError =
    input.error instanceof Error ? input.error : new Error(String(input.error));

  errors.push({
    sourceEvidenceId: input.sourceEvidenceId,
    gmailMessageId: input.gmailMessageId,
    message: resolvedError.message,
  });
}

export async function runRecoverOrphanGmailDetailsCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 0) || null;
  const batchSize = readOptionalIntegerFlag(
    flags,
    "batch-size",
    DEFAULT_BATCH_SIZE,
  );
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const targets = await loadOrphanGmailDetailTargets(
      connection.sql as unknown as SqlRunner,
      { limit },
    );
    const missingPlans: OrphanGmailRecoveryPlan[] = [];
    const recoverablePlans: OrphanGmailRecoveryPlan[] = [];
    const errors: ExecutionErrorExample[] = [];
    let capture: ReturnType<typeof createGmailCapturePort> | null = null;

    const getCapture = () => {
      capture ??= createGmailCapturePort(
        capturePortHttpConfigSchema.parse({
          baseUrl: env.GMAIL_CAPTURE_BASE_URL,
          bearerToken: env.GMAIL_CAPTURE_TOKEN,
        }),
      );

      return capture;
    };

    for (const chunk of chunkValues(targets, batchSize)) {
      const liveTargets = chunk.filter(isLiveRecoveryTarget);
      const historicalTargets = chunk.filter((target) => !isLiveRecoveryTarget(target));

      if (historicalTargets.length > 0) {
        missingPlans.push(
          ...planOrphanGmailRecoveryTargets({
            targets: historicalTargets,
            liveRecordsById: new Map<string, GmailMessageRecord>(),
          }),
        );
      }

      if (liveTargets.length === 0) {
        continue;
      }

      try {
        const fetchedBatch = await getCapture().captureLiveBatch(
          buildCapturePayload(
            Array.from(new Set(liveTargets.map((target) => target.gmailMessageId))),
            batchSize,
          ),
        );
        const liveRecordsById = new Map<string, GmailMessageRecord>();

        for (const record of fetchedBatch.records) {
          if (isGmailMessageRecord(record)) {
            liveRecordsById.set(record.recordId, record);
          }
        }

        for (const plan of planOrphanGmailRecoveryTargets({
          targets: liveTargets,
          liveRecordsById,
        })) {
          if (plan.bucket === "R") {
            recoverablePlans.push(plan);
          } else {
            missingPlans.push(plan);
          }
        }
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));

        for (const target of liveTargets) {
          addExecutionError(errors, {
            sourceEvidenceId: target.sourceEvidenceId,
            gmailMessageId: target.gmailMessageId,
            error: resolvedError,
          });
        }

        logger.error(
          `Failed fetching orphan Gmail recovery batch (${liveTargets.length.toString()} targets): ${resolvedError.message}`,
        );
      }
    }

    let ingested = 0;

    for (const plan of recoverablePlans) {
      try {
        const didIngest = await applyOrphanGmailRecoveryPlan({
          db: connection.db,
          plan,
          dryRun,
        });

        if (didIngest) {
          ingested += 1;
        }
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));

        addExecutionError(errors, {
          sourceEvidenceId: plan.sourceEvidenceId,
          gmailMessageId: plan.gmailMessageId,
          error: resolvedError,
        });
        logger.error(
          `Failed recovering Gmail detail for ${plan.gmailMessageId}: ${resolvedError.message}`,
        );
      }
    }

    logger.log(
      JSON.stringify(
        {
          event: "recover_orphan_gmail_details.completed",
          dryRun,
          bucketR: {
            count: recoverablePlans.length,
            ingested,
          },
          bucketM: {
            count: missingPlans.length,
            mboxCount: missingPlans.filter(
              (plan) => plan.reason === "mbox_import_unrecoverable",
            ).length,
            liveMissingCount: missingPlans.filter(
              (plan) => plan.reason === "live_fetch_returned_no_record",
            ).length,
            sample: buildMissingSample(missingPlans),
          },
          errors: {
            count: errors.length,
            examples: errors.slice(0, DEFAULT_SAMPLE_LIMIT),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runRecoverOrphanGmailDetailsCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "recover-orphan-gmail-details failed.",
      );
      process.exitCode = 1;
    },
  );
}
