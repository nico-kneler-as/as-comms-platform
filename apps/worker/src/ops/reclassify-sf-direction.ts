#!/usr/bin/env tsx
/**
 * reclassify-sf-direction
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops reclassify-sf-direction --dry-run
 *   pnpm --filter @as-comms/worker ops reclassify-sf-direction --execute
 *   pnpm --filter @as-comms/worker ops reclassify-sf-direction --execute --limit 100
 *
 * Dry-run by default. Reclassifies historical Salesforce Task email rows whose
 * subject arrow indicates inbound direction, strips the stored arrow prefix
 * from Salesforce detail subjects, and rebuilds projections for affected
 * contacts after writes.
 */
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection
} from "@as-comms/db";
import {
  parseSubjectDirection
} from "@as-comms/integrations";

import {
  enqueueStage1Job,
  type Stage1EnqueueRequest
} from "./enqueue.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag
} from "./helpers.js";
import {
  buildProjectionRebuildRequestsForContacts
} from "./reclassify-salesforce-tasks.js";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
  begin<T>(callback: (sql: SqlRunner) => Promise<T>): Promise<T>;
}

interface CandidateRow {
  readonly canonical_event_id: string;
  readonly contact_id: string;
  readonly source_evidence_id: string;
  readonly event_type: string;
  readonly subject: string | null;
  readonly cross_provider_collapse_key: string | null;
}

export interface SfDirectionCandidate {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly eventType: "communication.email.inbound" | "communication.email.outbound";
  readonly subject: string | null;
  readonly crossProviderCollapseKey: string | null;
}

export interface SfDirectionReclassificationChange {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly previousEventType:
    | "communication.email.inbound"
    | "communication.email.outbound";
  readonly nextEventType:
    | "communication.email.inbound"
    | "communication.email.outbound";
  readonly previousSubject: string | null;
  readonly nextSubject: string | null;
  readonly direction: "inbound" | "outbound";
  readonly reclassifiesEventType: boolean;
}

export interface SfDirectionReclassificationPlan {
  readonly scannedCount: number;
  readonly reclassifiedCount: number;
  readonly cleanedSubjectCount: number;
  readonly skippedCrossProviderRows: readonly string[];
  readonly affectedContactIds: readonly string[];
  readonly changes: readonly SfDirectionReclassificationChange[];
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toSqlNullableLiteral(value: string | null): string {
  return value === null ? "null" : quoteSqlLiteral(value);
}

function normalizeEventType(
  value: string
): "communication.email.inbound" | "communication.email.outbound" {
  if (
    value !== "communication.email.inbound" &&
    value !== "communication.email.outbound"
  ) {
    throw new Error(`Unsupported Salesforce direction event type ${value}.`);
  }

  return value;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

async function loadCandidates(
  sql: SqlRunner,
  limit: number
): Promise<readonly SfDirectionCandidate[]> {
  const rows = await sql.unsafe<readonly CandidateRow[]>(`
    select
      canonical_event_ledger.id as canonical_event_id,
      canonical_event_ledger.contact_id,
      canonical_event_ledger.source_evidence_id,
      canonical_event_ledger.event_type,
      salesforce_communication_details.subject,
      canonical_event_ledger.provenance #>> '{threadRef,crossProviderCollapseKey}'
        as cross_provider_collapse_key
    from canonical_event_ledger
    inner join salesforce_communication_details
      on salesforce_communication_details.source_evidence_id = canonical_event_ledger.source_evidence_id
    where canonical_event_ledger.provenance ->> 'primaryProvider' = 'salesforce'
      and salesforce_communication_details.channel = 'email'
      and salesforce_communication_details.subject is not null
      and salesforce_communication_details.subject ~* '^[[:space:]]*(?:[←⇐→⇒]|Email:)'
    order by canonical_event_ledger.occurred_at asc, canonical_event_ledger.id asc
    limit ${String(limit)}
  `);

  return rows.map((row) => ({
    canonicalEventId: row.canonical_event_id,
    contactId: row.contact_id,
    sourceEvidenceId: row.source_evidence_id,
    eventType: normalizeEventType(row.event_type),
    subject: row.subject,
    crossProviderCollapseKey: row.cross_provider_collapse_key
  }));
}

export function planSfDirectionReclassifications(
  candidates: readonly SfDirectionCandidate[]
): SfDirectionReclassificationPlan {
  const changes: SfDirectionReclassificationChange[] = [];
  const skippedCrossProviderRows: string[] = [];
  let reclassifiedCount = 0;

  for (const candidate of candidates) {
    const parsed = parseSubjectDirection(candidate.subject);
    const reclassifiesEventType =
      parsed.direction === "inbound" &&
      candidate.eventType === "communication.email.outbound";
    const cleansSubject = parsed.cleanSubject !== candidate.subject;

    if (!reclassifiesEventType && !cleansSubject) {
      continue;
    }

    if (
      reclassifiesEventType &&
      candidate.crossProviderCollapseKey !== null &&
      candidate.crossProviderCollapseKey.trim().length > 0
    ) {
      skippedCrossProviderRows.push(candidate.canonicalEventId);
      continue;
    }

    if (reclassifiesEventType) {
      reclassifiedCount += 1;
    }

    changes.push({
      canonicalEventId: candidate.canonicalEventId,
      contactId: candidate.contactId,
      sourceEvidenceId: candidate.sourceEvidenceId,
      previousEventType: candidate.eventType,
      nextEventType:
        parsed.direction === "inbound"
          ? "communication.email.inbound"
          : "communication.email.outbound",
      previousSubject: candidate.subject,
      nextSubject: parsed.cleanSubject,
      direction: parsed.direction,
      reclassifiesEventType
    });
  }

  return {
    scannedCount: candidates.length,
    reclassifiedCount,
    cleanedSubjectCount: changes.length,
    skippedCrossProviderRows: uniqueSortedStrings(skippedCrossProviderRows),
    affectedContactIds: uniqueSortedStrings(
      changes
        .filter((change) => change.reclassifiesEventType)
        .map((change) => change.contactId)
    ),
    changes
  };
}

function printPlanSummary(
  plan: SfDirectionReclassificationPlan,
  dryRun: boolean
): void {
  console.log("reclassify-sf-direction");
  console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  console.log(
    `- scanned arrow-prefixed Salesforce email rows: ${String(plan.scannedCount)}`
  );
  console.log(
    `- would reclassify outbound -> inbound rows: ${String(plan.reclassifiedCount)}`
  );
  console.log(
    `- would clean stored Salesforce subjects: ${String(plan.cleanedSubjectCount)}`
  );
  console.log(
    `- affected contacts for projection rebuild: ${String(plan.affectedContactIds.length)}`
  );

  if (plan.skippedCrossProviderRows.length > 0) {
    console.log(
      `- skipped rows with cross-provider collapse keys: ${String(plan.skippedCrossProviderRows.length)}`
    );
  }
}

function printSampleChanges(
  changes: readonly SfDirectionReclassificationChange[],
  dryRun: boolean
): void {
  if (changes.length === 0) {
    console.log("No Salesforce Task direction rows need updates.");
    return;
  }

  console.log("Sample rows (first 10):");
  for (const change of changes.slice(0, 10)) {
    console.log(
      JSON.stringify({
        ledgerId: change.canonicalEventId,
        contactId: change.contactId,
        oldType: change.previousEventType,
        newType: change.nextEventType,
        subjectPreview: change.previousSubject?.slice(0, 60) ?? null,
        cleanedSubjectPreview: change.nextSubject?.slice(0, 60) ?? null,
        operation: dryRun ? "would_update" : "updated"
      })
    );
  }
}

async function applyChanges(
  sql: SqlRunner,
  changes: readonly SfDirectionReclassificationChange[]
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const change of changes) {
      if (change.reclassifiesEventType) {
        await tx.unsafe(`
          update canonical_event_ledger
          set event_type = ${quoteSqlLiteral(change.nextEventType)},
              provenance = jsonb_set(
                provenance,
                '{direction}',
                to_jsonb(${quoteSqlLiteral(change.direction)}::text),
                true
              ),
              updated_at = now()
          where id = ${quoteSqlLiteral(change.canonicalEventId)}
        `);
      }

      await tx.unsafe(`
        update salesforce_communication_details
        set subject = ${toSqlNullableLiteral(change.nextSubject)},
            updated_at = now()
        where source_evidence_id = ${quoteSqlLiteral(change.sourceEvidenceId)}
      `);
    }
  });
}

export async function runReclassifySfDirection(input: {
  readonly connectionString: string;
  readonly dryRun: boolean;
  readonly limit?: number;
  readonly enqueueJob?: (request: Stage1EnqueueRequest) => Promise<{
    readonly enqueuedJobId: string;
  }>;
}): Promise<{
  readonly dryRun: boolean;
  readonly scannedCount: number;
  readonly reclassifiedCount: number;
  readonly cleanedSubjectCount: number;
  readonly affectedContactIds: readonly string[];
  readonly enqueuedJobIds: readonly string[];
}> {
  const connection = createDatabaseConnection({
    connectionString: input.connectionString
  });
  const sql = connection.sql as unknown as SqlRunner;

  try {
    const candidates = await loadCandidates(
      sql,
      input.limit ?? Number.MAX_SAFE_INTEGER
    );
    const plan = planSfDirectionReclassifications(candidates);

    printPlanSummary(plan, input.dryRun);
    printSampleChanges(plan.changes, input.dryRun);

    if (input.dryRun) {
      console.log(
        "Dry run complete. Re-run with --execute to persist these direction updates."
      );
      return {
        dryRun: true,
        scannedCount: plan.scannedCount,
        reclassifiedCount: plan.reclassifiedCount,
        cleanedSubjectCount: plan.cleanedSubjectCount,
        affectedContactIds: plan.affectedContactIds,
        enqueuedJobIds: []
      };
    }

    if (plan.changes.length === 0) {
      console.log("No Salesforce Task direction rows needed changes.");
      return {
        dryRun: false,
        scannedCount: plan.scannedCount,
        reclassifiedCount: 0,
        cleanedSubjectCount: 0,
        affectedContactIds: [],
        enqueuedJobIds: []
      };
    }

    await applyChanges(sql, plan.changes);

    const enqueueJob =
      input.enqueueJob ??
      ((request: Stage1EnqueueRequest) =>
        enqueueStage1Job({
          connectionString: input.connectionString,
          request
        }));
    const enqueuedJobIds: string[] = [];

    for (const request of buildProjectionRebuildRequestsForContacts(
      plan.affectedContactIds,
      {
        buildId: buildOperationId
      }
    )) {
      const result = await enqueueJob(request);
      enqueuedJobIds.push(result.enqueuedJobId);
    }

    console.log("Direction reclassification complete.");
    console.log(`- reclassified rows: ${String(plan.reclassifiedCount)}`);
    console.log(
      `- cleaned Salesforce subjects: ${String(plan.cleanedSubjectCount)}`
    );
    console.log(
      `- enqueued projection rebuild jobs: ${String(enqueuedJobIds.length)}`
    );

    return {
      dryRun: false,
      scannedCount: plan.scannedCount,
      reclassifiedCount: plan.reclassifiedCount,
      cleanedSubjectCount: plan.cleanedSubjectCount,
      affectedContactIds: plan.affectedContactIds,
      enqueuedJobIds
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

export async function runReclassifySfDirectionCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRunRequested = readOptionalBooleanFlag(flags, "dry-run", false);
  const executeRequested = readOptionalBooleanFlag(flags, "execute", false);

  if (dryRunRequested && executeRequested) {
    throw new Error("Use either --dry-run or --execute, not both.");
  }

  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error("DATABASE_URL or WORKER_DATABASE_URL is required.");
  }

  await runReclassifySfDirection({
    connectionString,
    dryRun: !executeRequested,
    limit: readOptionalIntegerFlag(flags, "limit", Number.MAX_SAFE_INTEGER)
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void runReclassifySfDirectionCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "reclassify-sf-direction failed."
      );
      process.exitCode = 1;
    }
  );
}
