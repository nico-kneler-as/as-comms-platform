#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import { canonicalEventSchema } from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";

const DEFAULT_SAMPLE_LIMIT = 5;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface StaleCanonicalRow {
  readonly canonical_event_id: string;
  readonly source_evidence_id: string;
  readonly contact_id: string;
  readonly canonical_occurred_at: string;
  readonly source_occurred_at: string;
}

export interface StaleCanonicalTarget {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly contactId: string;
  readonly canonicalOccurredAt: string;
  readonly sourceOccurredAt: string;
}

interface ReconcileSummary {
  occurredAtUpdated: number;
  alreadyAligned: number;
  missingCanonical: number;
  errors: number;
}

interface ErrorExample {
  readonly canonicalEventId: string;
  readonly message: string;
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value =
    env.WORKER_DATABASE_URL ?? env.DATABASE_URL ?? env.DATABASE_PUBLIC_URL;

  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, DATABASE_URL, or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return value.trim();
}

export function buildLoadStaleCanonicalsSql(input: {
  readonly limit: number | null;
}): string {
  const limitClause =
    input.limit === null ? "" : ` LIMIT ${input.limit.toString()}`;

  // Find canonical_event_ledger rows whose source_evidence has a
  // superseded_canonical audit row AND whose occurred_at no longer matches
  // the source-evidence occurred_at. This is the user-visible staleness:
  // timeline rows + lifecycle date displays read from canonical, not from
  // source-evidence, so they show the pre-supersede date until canonical
  // catches up.
  return `SELECT
  cel.id AS canonical_event_id,
  cel.source_evidence_id,
  cel.contact_id,
  cel.occurred_at::text AS canonical_occurred_at,
  sel.occurred_at::text AS source_occurred_at
FROM canonical_event_ledger cel
JOIN source_evidence_log sel ON sel.id = cel.source_evidence_id
WHERE EXISTS (
  SELECT 1 FROM source_evidence_quarantine q
  WHERE q.idempotency_key = sel.idempotency_key
    AND q.reason = 'superseded_canonical'
)
  AND sel.occurred_at <> cel.occurred_at
ORDER BY sel.idempotency_key${limitClause}`;
}

export async function loadStaleCanonicals(input: {
  readonly sql: SqlRunner;
  readonly limit: number | null;
}): Promise<readonly StaleCanonicalTarget[]> {
  const rows = await input.sql.unsafe<readonly StaleCanonicalRow[]>(
    buildLoadStaleCanonicalsSql({ limit: input.limit }),
  );

  return rows.map((row) => ({
    canonicalEventId: row.canonical_event_id,
    sourceEvidenceId: row.source_evidence_id,
    contactId: row.contact_id,
    canonicalOccurredAt: row.canonical_occurred_at,
    sourceOccurredAt: row.source_occurred_at,
  }));
}

export async function applyOccurredAtUpdate(input: {
  readonly db: Stage1Database;
  readonly target: StaleCanonicalTarget;
  readonly dryRun: boolean;
}): Promise<"updated" | "missing_canonical" | "already_aligned"> {
  let outcome: "updated" | "missing_canonical" | "already_aligned" | null =
    null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const existing = await repositories.canonicalEvents.findById(
      input.target.canonicalEventId,
    );

    if (existing === null) {
      outcome = "missing_canonical";
      if (input.dryRun) {
        throw new DryRunRollback();
      }
      return;
    }

    const sourceEvidence = await repositories.sourceEvidence.findById(
      input.target.sourceEvidenceId,
    );

    if (sourceEvidence === null) {
      outcome = "missing_canonical";
      if (input.dryRun) {
        throw new DryRunRollback();
      }
      return;
    }

    if (existing.occurredAt === sourceEvidence.occurredAt) {
      outcome = "already_aligned";
      if (input.dryRun) {
        throw new DryRunRollback();
      }
      return;
    }

    // Build the updated canonical record. Only occurredAt changes; everything
    // else (channel, eventType, contentFingerprint, provenance, reviewState)
    // is preserved as-is. contentFingerprint may now mildly diverge from a
    // hypothetical fresh derivation, but it's used for cross-provider
    // collapse and can be safely refreshed on next normalization replay.
    const updated = canonicalEventSchema.parse({
      ...existing,
      occurredAt: sourceEvidence.occurredAt,
    });

    await repositories.canonicalEvents.upsert(updated);
    outcome = "updated";

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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (outcome === null) {
    throw new Error(
      `Expected outcome for canonical event ${input.target.canonicalEventId}.`,
    );
  }

  return outcome;
}

function buildSampleRows(
  targets: readonly StaleCanonicalTarget[],
): readonly Record<string, unknown>[] {
  return targets.slice(0, DEFAULT_SAMPLE_LIMIT).map((target) => ({
    canonicalEventId: target.canonicalEventId,
    contactId: target.contactId,
    canonicalOccurredAt: target.canonicalOccurredAt,
    sourceOccurredAt: target.sourceOccurredAt,
  }));
}

export async function runReconcileSupersededProjectionsCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 0) || null;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const targets = await loadStaleCanonicals({
      sql: connection.sql as unknown as SqlRunner,
      limit,
    });

    const distinctContactIds = Array.from(
      new Set(targets.map((target) => target.contactId)),
    ).sort((left, right) => left.localeCompare(right));

    logger.log(
      JSON.stringify(
        {
          event: "reconcile_superseded_projections.plan",
          dryRun,
          limit,
          targetCount: targets.length,
          distinctContactCount: distinctContactIds.length,
          sample: buildSampleRows(targets),
        },
        null,
        2,
      ),
    );

    if (targets.length === 0) {
      logger.log("No canonical-event rows have a stale occurred_at.");
      return;
    }

    const summary: ReconcileSummary = {
      occurredAtUpdated: 0,
      alreadyAligned: 0,
      missingCanonical: 0,
      errors: 0,
    };
    const errorExamples: ErrorExample[] = [];

    for (const target of targets) {
      try {
        const outcome = await applyOccurredAtUpdate({
          db: connection.db,
          target,
          dryRun,
        });

        switch (outcome) {
          case "updated":
            summary.occurredAtUpdated += 1;
            break;
          case "already_aligned":
            summary.alreadyAligned += 1;
            break;
          case "missing_canonical":
            summary.missingCanonical += 1;
            break;
        }
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        summary.errors += 1;

        if (errorExamples.length < DEFAULT_SAMPLE_LIMIT) {
          errorExamples.push({
            canonicalEventId: target.canonicalEventId,
            message: resolvedError.message,
          });
        }

        logger.error(
          `Failed updating canonical ${target.canonicalEventId}: ${resolvedError.message}`,
        );
      }
    }

    logger.log(
      JSON.stringify(
        {
          event: "reconcile_superseded_projections.completed",
          dryRun,
          summary,
          errorExamples,
          contactsForProjectionRebuild: distinctContactIds,
          rebuildCommandHint:
            distinctContactIds.length > 0
              ? `pnpm --filter @as-comms/worker run ops enqueue projection-rebuild --contact-ids ${distinctContactIds.join(",")} --projection all --include-review-overlay-refresh true`
              : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runReconcileSupersededProjectionsCommand().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "reconcile-superseded-projections failed.",
    );
    process.exitCode = 1;
  });
}
