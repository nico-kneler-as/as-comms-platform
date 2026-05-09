#!/usr/bin/env tsx
import process from "node:process";

import {
  sourceEvidenceSchema,
  type Provider,
  type SourceEvidenceRecord,
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import { createStage1PersistenceService } from "@as-comms/domain";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

const DEFAULT_SAMPLE_LIMIT = 5;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface QuarantineRow {
  readonly idempotency_key: string;
  readonly provider: string;
  readonly attempted_at: string;
  readonly details_jsonb: Readonly<Record<string, unknown>>;
}

export interface ReconcileTarget {
  readonly idempotencyKey: string;
  readonly provider: Provider;
  readonly attemptedAt: string;
  readonly record: SourceEvidenceRecord;
}

interface ReconcileSummary {
  superseded: number;
  duplicate: number;
  conflict: number;
  invalid: number;
  errors: number;
}

interface ErrorExample {
  readonly idempotencyKey: string;
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

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildLoadQuarantineSql(input: {
  readonly provider: string | null;
  readonly recordType: string | null;
  readonly limit: number | null;
}): string {
  const filters: string[] = ["reason = 'checksum_mismatch'"];

  if (input.provider !== null) {
    filters.push(`provider = ${quoteSqlString(input.provider)}`);
  }

  if (input.recordType !== null) {
    // idempotency_key shape: source-evidence:<provider>:<record_type>:<rest>
    filters.push(
      `idempotency_key LIKE ${quoteSqlString(`source-evidence:%:${input.recordType}:%`)}`,
    );
  }

  const where = filters.join(" AND ");
  const limitClause = input.limit === null ? "" : ` LIMIT ${input.limit.toString()}`;

  // DISTINCT ON picks the latest attempted_at per idempotency_key. For a given
  // collision set, we replay the most recent loser — earlier losers either had
  // an identical checksum (already represented) or were superseded by the
  // newer one upstream in SF.
  return `SELECT DISTINCT ON (idempotency_key)
  idempotency_key,
  provider,
  attempted_at,
  details_jsonb
FROM source_evidence_quarantine
WHERE ${where}
ORDER BY idempotency_key, attempted_at DESC${limitClause}`;
}

export async function loadReconcileTargets(input: {
  readonly sql: SqlRunner;
  readonly provider: string | null;
  readonly recordType: string | null;
  readonly limit: number | null;
}): Promise<{
  readonly targets: readonly ReconcileTarget[];
  readonly invalid: number;
}> {
  const rows = await input.sql.unsafe<readonly QuarantineRow[]>(
    buildLoadQuarantineSql({
      provider: input.provider,
      recordType: input.recordType,
      limit: input.limit,
    }),
  );

  const targets: ReconcileTarget[] = [];
  let invalid = 0;

  for (const row of rows) {
    const parseResult = sourceEvidenceSchema.safeParse(row.details_jsonb);

    if (!parseResult.success) {
      invalid += 1;
      continue;
    }

    targets.push({
      idempotencyKey: row.idempotency_key,
      provider: parseResult.data.provider,
      attemptedAt: row.attempted_at,
      record: parseResult.data,
    });
  }

  return { targets, invalid };
}

export async function applyReconcileTarget(input: {
  readonly db: Stage1Database;
  readonly target: ReconcileTarget;
  readonly dryRun: boolean;
}): Promise<"superseded" | "duplicate" | "conflict"> {
  let outcome: "superseded" | "duplicate" | "conflict" | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const persistence = createStage1PersistenceService(repositories);
    const result = await persistence.recordSourceEvidence(input.target.record);

    switch (result.outcome) {
      case "superseded":
        outcome = "superseded";
        break;
      case "duplicate":
        // Canonical already matches the loser's payload — either organic
        // supersede already applied this fix, or the historical winner and
        // loser collapse under sameSourceEvidenceRecord (e.g., id-only diff).
        outcome = "duplicate";
        break;
      case "inserted":
        // Canonical is missing entirely; treat as a conflict-shaped event so
        // the operator can investigate. recordSourceEvidence will have created
        // a fresh canonical, which is acceptable but unexpected for a
        // reconcile target.
        outcome = "superseded";
        break;
      case "conflict":
        outcome = "conflict";
        break;
    }

    if (input.dryRun) {
      throw new DryRunRollback();
    }
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }
  } else {
    await input.db.transaction(runInTransaction);
  }

  // The outcome is assigned inside the transaction closure before dry-run
  // rollback throws, but TS/ESLint can't track that flow.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (outcome === null) {
    throw new Error(
      `Expected reconcile outcome for idempotency key ${input.target.idempotencyKey}.`,
    );
  }

  return outcome;
}

function buildSampleRows(
  targets: readonly ReconcileTarget[],
): readonly Record<string, unknown>[] {
  return targets.slice(0, DEFAULT_SAMPLE_LIMIT).map((target) => ({
    idempotencyKey: target.idempotencyKey,
    provider: target.provider,
    attemptedAt: target.attemptedAt,
    incomingChecksumPrefix: target.record.checksum.slice(0, 12),
  }));
}

export async function runReconcileStaleCanonicalCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const provider = readOptionalStringFlag(flags, "provider");
  const recordType = readOptionalStringFlag(flags, "record-type");
  const limit = readOptionalIntegerFlag(flags, "limit", 0) || null;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const { targets, invalid } = await loadReconcileTargets({
      sql: connection.sql as unknown as SqlRunner,
      provider,
      recordType,
      limit,
    });

    logger.log(
      JSON.stringify(
        {
          event: "reconcile_stale_canonical.plan",
          dryRun,
          provider,
          recordType,
          limit,
          targetCount: targets.length,
          invalid,
          sample: buildSampleRows(targets),
        },
        null,
        2,
      ),
    );

    if (targets.length === 0) {
      logger.log("No quarantine rows match the requested filter.");
      return;
    }

    const summary: ReconcileSummary = {
      superseded: 0,
      duplicate: 0,
      conflict: 0,
      invalid,
      errors: 0,
    };
    const errorExamples: ErrorExample[] = [];

    for (const target of targets) {
      try {
        const outcome = await applyReconcileTarget({
          db: connection.db,
          target,
          dryRun,
        });
        summary[outcome] += 1;
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        summary.errors += 1;

        if (errorExamples.length < DEFAULT_SAMPLE_LIMIT) {
          errorExamples.push({
            idempotencyKey: target.idempotencyKey,
            message: resolvedError.message,
          });
        }

        logger.error(
          `Failed reconciling ${target.idempotencyKey}: ${resolvedError.message}`,
        );
      }
    }

    logger.log(
      JSON.stringify(
        {
          event: "reconcile_stale_canonical.completed",
          dryRun,
          provider,
          recordType,
          summary,
          errorExamples,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}
