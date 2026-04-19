#!/usr/bin/env tsx
/**
 * reclassify-salesforce-tasks
 *
 * Usage:
 *   pnpm ops:reclassify-salesforce-tasks
 *   pnpm ops:reclassify-salesforce-tasks --confirm
 *
 * Dry-run by default. Reclassifies historical Salesforce outbound email Tasks
 * using the conservative Stage 1 heuristic, then enqueues scoped projection
 * rebuild jobs for affected contacts.
 *
 * This script is an ops tool, not part of `apps/web`. The repo boundary rule
 * that restricts direct `@as-comms/db` imports to the Stage 1 composition
 * root only applies to workspace packages under `apps/` and `packages/`.
 */
import { parseArgs } from "node:util";

import {
  projectionRebuildBatchJobName,
  projectionRebuildBatchPayloadSchema,
  stage1JobVersion,
  type CommunicationMessageKind
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection
} from "@as-comms/db";
import {
  classifySalesforceTaskMessageKind,
  type SalesforceTaskMessageKindClassification
} from "@as-comms/integrations";

import {
  buildOperationId
} from "./helpers.js";
import {
  enqueueStage1Job,
  type Stage1EnqueueRequest
} from "./enqueue.js";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
  begin<T>(callback: (sql: SqlRunner) => Promise<T>): Promise<T>;
}

interface ReclassificationCandidateRow {
  readonly canonical_event_id: string;
  readonly contact_id: string;
  readonly source_evidence_id: string;
  readonly current_message_kind: string | null;
  readonly subject: string | null;
  readonly snippet: string | null;
}

interface IdRow {
  readonly id: string;
}

export interface SalesforceTaskReclassificationCandidate {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly currentMessageKind: CommunicationMessageKind | null;
  readonly subject: string | null;
  readonly snippet: string;
}

export interface SalesforceTaskReclassificationChange {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly previousMessageKind: "one_to_one" | null;
  readonly nextMessageKind: "auto";
  readonly subject: string | null;
  readonly snippet: string;
  readonly summary: "Auto email sent";
  readonly sourceLabel: "Salesforce Flow";
  readonly reason: SalesforceTaskMessageKindClassification["reason"];
}

export interface SalesforceTaskReclassificationPlan {
  readonly scannedCount: number;
  readonly reclassifiedCount: number;
  readonly affectedContactIds: readonly string[];
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly changes: readonly SalesforceTaskReclassificationChange[];
}

export interface ReclassifySalesforceTasksResult {
  readonly confirm: boolean;
  readonly scannedCount: number;
  readonly reclassifiedCount: number;
  readonly affectedContactIds: readonly string[];
  readonly enqueuedJobIds: readonly string[];
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

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeMessageKind(
  value: string | null
): CommunicationMessageKind | null {
  return value === "one_to_one" || value === "auto" || value === "campaign"
    ? value
    : null;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

async function loadCandidates(
  sql: SqlRunner
): Promise<readonly SalesforceTaskReclassificationCandidate[]> {
  const rows = await sql.unsafe<readonly ReclassificationCandidateRow[]>(`
    select
      canonical_event_ledger.id as canonical_event_id,
      canonical_event_ledger.contact_id,
      canonical_event_ledger.source_evidence_id,
      canonical_event_ledger.provenance ->> 'messageKind' as current_message_kind,
      salesforce_communication_details.subject,
      salesforce_communication_details.snippet
    from canonical_event_ledger
    left join salesforce_communication_details
      on salesforce_communication_details.source_evidence_id = canonical_event_ledger.source_evidence_id
    where canonical_event_ledger.event_type = 'communication.email.outbound'
      and canonical_event_ledger.provenance ->> 'primaryProvider' = 'salesforce'
    order by canonical_event_ledger.occurred_at asc, canonical_event_ledger.id asc
  `);

  return rows.map((row) => ({
    canonicalEventId: row.canonical_event_id,
    contactId: row.contact_id,
    sourceEvidenceId: row.source_evidence_id,
    currentMessageKind: normalizeMessageKind(row.current_message_kind),
    subject: row.subject,
    snippet: row.snippet ?? ""
  }));
}

export function planSalesforceTaskReclassifications(
  candidates: readonly SalesforceTaskReclassificationCandidate[]
): SalesforceTaskReclassificationPlan {
  const changes: SalesforceTaskReclassificationChange[] = [];
  const reasonCounts = new Map<string, number>();

  for (const candidate of candidates) {
    // Historical Stage 1 rows only persist Salesforce subject/snippet, not the
    // original owner or TaskSubtype metadata, so ambiguous legacy rows
    // intentionally default to auto to protect queue truth.
    const classification = classifySalesforceTaskMessageKind({
      channel: "email",
      subject: candidate.subject
    });

    // Flip both explicit `one_to_one` rows and null-kind historical rows
    // when the classifier resolves to `auto`. Historical Stage 1 rows landed
    // with `messageKind = null` before the Slice 2 classifier existed; those
    // rows are the real blast radius for the Alice-Chang-at-top-of-inbox bug.
    // Per the classifier's own conservative default (documented at the call
    // site above), ambiguous legacy Salesforce Tasks prefer `auto` to protect
    // queue truth — a legit 1:1 mis-classified as auto is visible-but-wrong
    // and safely recoverable, whereas automation masquerading as 1:1 keeps
    // polluting the inbox triage surface.
    const isFlippableSource =
      candidate.currentMessageKind === "one_to_one" ||
      candidate.currentMessageKind === null;
    if (isFlippableSource && classification.messageKind === "auto") {
      reasonCounts.set(
        classification.reason,
        (reasonCounts.get(classification.reason) ?? 0) + 1
      );
      changes.push({
        canonicalEventId: candidate.canonicalEventId,
        contactId: candidate.contactId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        previousMessageKind: candidate.currentMessageKind,
        nextMessageKind: "auto",
        subject: candidate.subject,
        snippet: candidate.snippet,
        summary: "Auto email sent",
        sourceLabel: "Salesforce Flow",
        reason: classification.reason
      });
    }
  }

  return {
    scannedCount: candidates.length,
    reclassifiedCount: changes.length,
    affectedContactIds: uniqueSortedStrings(
      changes.map((change) => change.contactId)
    ),
    reasonCounts: Object.fromEntries(
      Array.from(reasonCounts.entries()).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    changes
  };
}

export function buildProjectionRebuildRequestsForContacts(
  contactIds: readonly string[],
  input?: {
    readonly chunkSize?: number;
    readonly buildId?: (prefix: string) => string;
  }
): readonly Stage1EnqueueRequest[] {
  const chunkSize = input?.chunkSize ?? 250;
  const buildIdFn = input?.buildId ?? buildOperationId;

  return chunkValues(uniqueSortedStrings(contactIds), chunkSize).map((ids) => ({
    jobName: projectionRebuildBatchJobName,
    payload: projectionRebuildBatchPayloadSchema.parse({
      version: stage1JobVersion,
      jobId: buildIdFn("stage1:projection-rebuild:job"),
      correlationId: buildIdFn("stage1:projection-rebuild:correlation"),
      traceId: null,
      batchId: buildIdFn("stage1:projection-rebuild:batch"),
      syncStateId: buildIdFn("stage1:projection-rebuild:sync-state"),
      attempt: 1,
      maxAttempts: 3,
      jobType: "projection_rebuild",
      projection: "all",
      contactIds: ids,
      includeReviewOverlayRefresh: true
    })
  }));
}

function printPlanSummary(
  plan: SalesforceTaskReclassificationPlan,
  confirm: boolean
): void {
  console.log("reclassify-salesforce-tasks");
  console.log(`Mode: ${confirm ? "confirm" : "dry-run"}`);
  console.log(
    `- scanned Salesforce outbound email events: ${String(plan.scannedCount)}`
  );
  console.log(
    `- would reclassify (one_to_one|null) -> auto: ${String(plan.reclassifiedCount)}`
  );
  console.log(
    `- affected contacts: ${String(plan.affectedContactIds.length)}`
  );

  if (Object.keys(plan.reasonCounts).length > 0) {
    console.log("Reason counts:");
    for (const [reason, count] of Object.entries(plan.reasonCounts)) {
      console.log(`- ${reason}: ${String(count)}`);
    }
  }
}

function printSampleChanges(
  changes: readonly SalesforceTaskReclassificationChange[]
): void {
  if (changes.length === 0) {
    console.log("No Salesforce Task rows need reclassification.");
    return;
  }

  console.log("Sample rows (first 10):");
  for (const change of changes.slice(0, 10)) {
    console.log(
      `- ${JSON.stringify({
        canonicalEventId: change.canonicalEventId,
        contactId: change.contactId,
        subject: change.subject,
        reason: change.reason
      })}`
    );
  }
}

async function applyChanges(
  sql: SqlRunner,
  changes: readonly SalesforceTaskReclassificationChange[]
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const change of changes) {
      await tx.unsafe(`
        update canonical_event_ledger
        set provenance = jsonb_set(
              provenance,
              '{messageKind}',
              to_jsonb(${quoteSqlLiteral(change.nextMessageKind)}::text),
              true
            ),
            updated_at = now()
        where id = ${quoteSqlLiteral(change.canonicalEventId)}
      `);

      await tx.unsafe(`
        update salesforce_communication_details
        set message_kind = ${quoteSqlLiteral(change.nextMessageKind)},
            source_label = ${quoteSqlLiteral(change.sourceLabel)},
            updated_at = now()
        where source_evidence_id = ${quoteSqlLiteral(change.sourceEvidenceId)}
      `);

      const metadataJson = quoteSqlLiteral(
        JSON.stringify({
          summary: change.summary,
          snippet: change.snippet
        })
      );
      const updatedProjectionSeed = await tx.unsafe<readonly IdRow[]>(`
        update audit_policy_evidence
        set metadata_json = ${metadataJson}::jsonb
        where entity_type = 'canonical_event'
          and entity_id = ${quoteSqlLiteral(change.canonicalEventId)}
          and policy_code = 'stage1.projection.seed'
        returning id
      `);

      if (updatedProjectionSeed.length === 0) {
        await tx.unsafe(`
          insert into audit_policy_evidence (
            id,
            actor_type,
            actor_id,
            action,
            entity_type,
            entity_id,
            occurred_at,
            result,
            policy_code,
            metadata_json
          ) values (
            ${quoteSqlLiteral(`audit:canonical_event:${change.canonicalEventId}:projection-seed`)},
            'worker',
            'stage1-ops:reclassify-salesforce-tasks',
            'record_projection_seed',
            'canonical_event',
            ${quoteSqlLiteral(change.canonicalEventId)},
            now(),
            'recorded',
            'stage1.projection.seed',
            ${metadataJson}::jsonb
          )
        `);
      }
    }
  });
}

export async function runReclassifySalesforceTasks(input: {
  readonly connectionString: string;
  readonly confirm: boolean;
  readonly enqueueJob?: (request: Stage1EnqueueRequest) => Promise<{
    readonly enqueuedJobId: string;
  }>;
}): Promise<ReclassifySalesforceTasksResult> {
  const connection = createDatabaseConnection({
    connectionString: input.connectionString
  });
  const sql = connection.sql as unknown as SqlRunner;

  try {
    const candidates = await loadCandidates(sql);
    const plan = planSalesforceTaskReclassifications(candidates);

    printPlanSummary(plan, input.confirm);
    printSampleChanges(plan.changes);

    if (!input.confirm) {
      console.log(
        "Dry run complete. Re-run with --confirm to persist these reclassifications."
      );
      return {
        confirm: false,
        scannedCount: plan.scannedCount,
        reclassifiedCount: plan.reclassifiedCount,
        affectedContactIds: plan.affectedContactIds,
        enqueuedJobIds: []
      };
    }

    if (plan.changes.length === 0) {
      console.log("No Salesforce Task rows needed changes.");
      return {
        confirm: true,
        scannedCount: plan.scannedCount,
        reclassifiedCount: 0,
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
      plan.affectedContactIds
    )) {
      const result = await enqueueJob(request);
      enqueuedJobIds.push(result.enqueuedJobId);
    }

    console.log("Reclassification complete.");
    console.log(`- updated canonical events: ${String(plan.reclassifiedCount)}`);
    console.log(
      `- enqueued projection rebuild jobs: ${String(enqueuedJobIds.length)}`
    );

    return {
      confirm: true,
      scannedCount: plan.scannedCount,
      reclassifiedCount: plan.reclassifiedCount,
      affectedContactIds: plan.affectedContactIds,
      enqueuedJobIds
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      confirm: { type: "boolean" }
    }
  });
  const connectionString =
    process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL or WORKER_DATABASE_URL is required.");
  }

  await runReclassifySalesforceTasks({
    connectionString,
    confirm: values.confirm ?? false
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "reclassify-salesforce-tasks failed."
    );
    process.exitCode = 1;
  });
}
