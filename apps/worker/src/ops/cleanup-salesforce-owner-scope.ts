#!/usr/bin/env tsx
/**
 * cleanup-salesforce-owner-scope
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops cleanup-salesforce-owner-scope
 *   pnpm --filter @as-comms/worker ops cleanup-salesforce-owner-scope --execute
 *
 * Dry-run by default. Looks up the current Salesforce Task owner for every
 * Salesforce outbound email canonical event in the DB and removes the rows
 * whose Task owner is explicitly not Nim Admin. Tasks that Salesforce does not
 * currently resolve are skipped and reported rather than deleted.
 */
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { inArray } from "drizzle-orm";
import { z } from "zod";

import {
  projectionRebuildBatchPayloadSchema,
  stage1JobVersion,
} from "@as-comms/contracts";
import {
  canonicalEventLedger,
  closeDatabaseConnection,
  contactInboxProjection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  identityResolutionQueue,
  routingReviewQueue,
  sourceEvidenceLog,
  type DatabaseConnection,
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
} from "@as-comms/domain";

import { createStage1IngestService } from "../ingest/index.js";
import {
  createStage1WorkerOrchestrationService,
  type Stage1WorkerOrchestrationService,
} from "../orchestration/index.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

const execFileAsync = promisify(execFile);

const defaultTargetOrg = "as-production";
const nimAdminUsername = "admin+1@adventurescientists.org";
const queryChunkSize = 200;
const deleteChunkSize = 500;
const projectionChunkSize = 250;
const sampleLimit = 10;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface CleanupCandidateRow {
  readonly canonical_event_id: string;
  readonly contact_id: string;
  readonly source_evidence_id: string;
  readonly provider_record_id: string;
  readonly subject: string | null;
}

export interface SalesforceOwnerScopeCleanupCandidate {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly subject: string | null;
}

export interface SalesforceOwnerScopeCleanupChange {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly subject: string | null;
  readonly ownerUsername: string | null;
  readonly removalReason: "non_nim_admin_owner" | "unresolved_owner";
}

export interface SalesforceOwnerScopeCleanupPlan {
  readonly scannedCount: number;
  readonly resolvedCount: number;
  readonly keepCount: number;
  readonly removeCount: number;
  readonly unresolvedCount: number;
  readonly affectedContactIds: readonly string[];
  readonly changes: readonly SalesforceOwnerScopeCleanupChange[];
  readonly unresolvedProviderRecordIds: readonly string[];
}

export interface CleanupSalesforceOwnerScopeResult {
  readonly dryRun: boolean;
  readonly targetOrg: string;
  readonly scannedCount: number;
  readonly resolvedCount: number;
  readonly keepCount: number;
  readonly removeCount: number;
  readonly unresolvedCount: number;
  readonly affectedContactIds: readonly string[];
  readonly unresolvedProviderRecordIds: readonly string[];
  readonly deletedCanonicalCount: number;
  readonly deletedSourceEvidenceCount: number;
  readonly deletedInboxProjectionCount: number;
  readonly deletedIdentityReviewCount: number;
  readonly deletedRoutingReviewCount: number;
  readonly rebuiltContactCount: number;
  readonly missingProjectionSeeds: readonly string[];
}

interface DeleteCounts {
  readonly deletedCanonicalCount: number;
  readonly deletedSourceEvidenceCount: number;
  readonly deletedInboxProjectionCount: number;
  readonly deletedIdentityReviewCount: number;
  readonly deletedRoutingReviewCount: number;
}

interface SfQueryRunner {
  queryTaskOwnerUsernames(input: {
    readonly targetOrg: string;
    readonly taskIds: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
}

const sfTaskOwnerQueryResultSchema = z.object({
  status: z.number().int(),
  result: z.object({
    records: z.array(
      z.object({
        Id: z.string().min(1),
        Owner: z
          .object({
            Username: z.string().min(1).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
  }),
});

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString;
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function quoteSoqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function normalizeOwnerUsername(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function buildSalesforceTaskOwnerQuery(taskIds: readonly string[]): string {
  return `SELECT Id, Owner.Username FROM Task WHERE Id IN (${taskIds.map((taskId) => quoteSoqlString(taskId)).join(", ")})`;
}

function buildUnexpectedCapturePorts() {
  const unexpectedUse = (): Promise<never> => {
    return Promise.reject(
      new Error(
        "This ops runtime only supports projection rebuilds after owner-scoped cleanup.",
      ),
    );
  };

  return {
    gmail: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse,
    },
    salesforce: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse,
    },
    simpleTexting: {
      captureHistoricalBatch: unexpectedUse,
      captureLiveBatch: unexpectedUse,
    },
    mailchimp: {
      captureHistoricalBatch: unexpectedUse,
      captureTransitionBatch: unexpectedUse,
    },
  };
}

function createProjectionRebuildOrchestration(
  connection: DatabaseConnection,
): Pick<Stage1WorkerOrchestrationService, "runProjectionRebuildBatch"> {
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);

  return createStage1WorkerOrchestrationService({
    capture: buildUnexpectedCapturePorts(),
    ingest,
    normalization,
    persistence,
    gmailHistoricalReplay: {
      liveAccount: "unused@example.org",
      projectInboxAliases: [],
    },
  });
}

function createSfCliQueryRunner(): SfQueryRunner {
  return {
    async queryTaskOwnerUsernames(input) {
      const ownerUsernameByTaskId = new Map<string, string | null>();

      for (const chunk of chunkValues(
        uniqueSortedStrings(input.taskIds),
        queryChunkSize,
      )) {
        const query = buildSalesforceTaskOwnerQuery(chunk);

        let stdout: string;

        try {
          ({ stdout } = await execFileAsync(
            "sf",
            [
              "data",
              "query",
              "--target-org",
              input.targetOrg,
              "--query",
              query,
              "--json",
            ],
            {
              cwd: process.cwd(),
              maxBuffer: 10 * 1024 * 1024,
            },
          ));
        } catch (error) {
          const message =
            error instanceof Error && "stdout" in error
              ? ((error as { stdout?: string }).stdout ?? error.message)
              : error instanceof Error
                ? error.message
                : String(error);

          throw new Error(
            `Salesforce CLI owner lookup failed for ${String(chunk.length)} Task ids: ${message}`,
          );
        }

        const parsed = sfTaskOwnerQueryResultSchema.parse(JSON.parse(stdout));

        for (const record of parsed.result.records) {
          ownerUsernameByTaskId.set(
            record.Id,
            normalizeOwnerUsername(record.Owner?.Username ?? null),
          );
        }
      }

      return ownerUsernameByTaskId;
    },
  };
}

async function loadCleanupCandidates(
  sql: SqlRunner,
  input?: { readonly limit?: number | null },
): Promise<readonly SalesforceOwnerScopeCleanupCandidate[]> {
  const rows = await sql.unsafe<readonly CleanupCandidateRow[]>(`
    select
      canonical_event_ledger.id as canonical_event_id,
      canonical_event_ledger.contact_id,
      canonical_event_ledger.source_evidence_id,
      source_evidence_log.provider_record_id,
      salesforce_communication_details.subject
    from canonical_event_ledger
    join source_evidence_log
      on source_evidence_log.id = canonical_event_ledger.source_evidence_id
    left join salesforce_communication_details
      on salesforce_communication_details.source_evidence_id = canonical_event_ledger.source_evidence_id
    where canonical_event_ledger.event_type = 'communication.email.outbound'
      and canonical_event_ledger.provenance ->> 'primaryProvider' = 'salesforce'
      and source_evidence_log.provider = 'salesforce'
      and source_evidence_log.provider_record_type = 'task_communication'
    order by canonical_event_ledger.occurred_at asc, canonical_event_ledger.id asc
  `);

  const candidates = rows.map((row) => ({
    canonicalEventId: row.canonical_event_id,
    contactId: row.contact_id,
    sourceEvidenceId: row.source_evidence_id,
    providerRecordId: row.provider_record_id,
    subject: row.subject,
  }));

  return input?.limit === null || input?.limit === undefined
    ? candidates
    : candidates.slice(0, input.limit);
}

export function planSalesforceOwnerScopeCleanup(input: {
  readonly candidates: readonly SalesforceOwnerScopeCleanupCandidate[];
  readonly ownerUsernameByTaskId: ReadonlyMap<string, string | null>;
  readonly includeUnresolved?: boolean;
}): SalesforceOwnerScopeCleanupPlan {
  const includeUnresolved = input.includeUnresolved ?? false;
  const changes: SalesforceOwnerScopeCleanupChange[] = [];
  const affectedContactIds = new Set<string>();
  const unresolvedProviderRecordIds = new Set<string>();
  let resolvedCount = 0;
  let keepCount = 0;

  for (const candidate of input.candidates) {
    if (!input.ownerUsernameByTaskId.has(candidate.providerRecordId)) {
      unresolvedProviderRecordIds.add(candidate.providerRecordId);

      if (includeUnresolved) {
        affectedContactIds.add(candidate.contactId);
        changes.push({
          canonicalEventId: candidate.canonicalEventId,
          contactId: candidate.contactId,
          sourceEvidenceId: candidate.sourceEvidenceId,
          providerRecordId: candidate.providerRecordId,
          subject: candidate.subject,
          ownerUsername: null,
          removalReason: "unresolved_owner",
        });
      }

      continue;
    }

    const ownerUsername =
      input.ownerUsernameByTaskId.get(candidate.providerRecordId) ?? null;

    if (ownerUsername === null) {
      unresolvedProviderRecordIds.add(candidate.providerRecordId);

      if (includeUnresolved) {
        affectedContactIds.add(candidate.contactId);
        changes.push({
          canonicalEventId: candidate.canonicalEventId,
          contactId: candidate.contactId,
          sourceEvidenceId: candidate.sourceEvidenceId,
          providerRecordId: candidate.providerRecordId,
          subject: candidate.subject,
          ownerUsername: null,
          removalReason: "unresolved_owner",
        });
      }

      continue;
    }

    resolvedCount += 1;

    if (ownerUsername === nimAdminUsername) {
      keepCount += 1;
      continue;
    }

    affectedContactIds.add(candidate.contactId);
    changes.push({
      canonicalEventId: candidate.canonicalEventId,
      contactId: candidate.contactId,
      sourceEvidenceId: candidate.sourceEvidenceId,
      providerRecordId: candidate.providerRecordId,
      subject: candidate.subject,
      ownerUsername,
      removalReason: "non_nim_admin_owner",
    });
  }

  return {
    scannedCount: input.candidates.length,
    resolvedCount,
    keepCount,
    removeCount: changes.length,
    unresolvedCount: unresolvedProviderRecordIds.size,
    affectedContactIds: Array.from(affectedContactIds).sort((left, right) =>
      left.localeCompare(right),
    ),
    changes,
    unresolvedProviderRecordIds: Array.from(unresolvedProviderRecordIds).sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}

function printPlanSummary(
  plan: SalesforceOwnerScopeCleanupPlan,
  input: {
    readonly dryRun: boolean;
    readonly targetOrg: string;
    readonly includeUnresolved: boolean;
  },
): void {
  console.log("cleanup-salesforce-owner-scope");
  console.log(`Mode: ${input.dryRun ? "dry-run" : "execute"}`);
  console.log(`- Salesforce target org: ${input.targetOrg}`);
  console.log(
    `- scanned Salesforce outbound email rows: ${String(plan.scannedCount)}`,
  );
  console.log(`- owner-resolved Task ids: ${String(plan.resolvedCount)}`);
  console.log(`- Nim Admin rows kept: ${String(plan.keepCount)}`);
  console.log(`- non-Nim Admin rows to remove: ${String(plan.removeCount)}`);
  console.log(
    `- unresolved Task ids ${input.includeUnresolved ? "to remove" : "skipped"}: ${String(plan.unresolvedCount)}`,
  );
  console.log(
    `- affected contacts for projection rebuild: ${String(plan.affectedContactIds.length)}`,
  );
}

function printSampleChanges(
  changes: readonly SalesforceOwnerScopeCleanupChange[],
): void {
  if (changes.length === 0) {
    console.log(
      "No non-Nim Admin Salesforce email rows are currently in scope.",
    );
    return;
  }

  console.log("Sample removals (first 10):");
  for (const change of changes.slice(0, sampleLimit)) {
    console.log(
      `- ${JSON.stringify({
        canonicalEventId: change.canonicalEventId,
        contactId: change.contactId,
        providerRecordId: change.providerRecordId,
        ownerUsername: change.ownerUsername,
        removalReason: change.removalReason,
        subject: change.subject,
      })}`,
    );
  }
}

function printSampleUnresolved(providerRecordIds: readonly string[]): void {
  if (providerRecordIds.length === 0) {
    return;
  }

  console.log("Sample unresolved Task ids (first 10):");
  for (const providerRecordId of providerRecordIds.slice(0, sampleLimit)) {
    console.log(`- ${providerRecordId}`);
  }
}

async function deleteRowsForPlan(input: {
  readonly connection: DatabaseConnection;
  readonly plan: SalesforceOwnerScopeCleanupPlan;
}): Promise<DeleteCounts> {
  const affectedContactIds = input.plan.affectedContactIds;
  const canonicalEventIds = input.plan.changes.map(
    (change) => change.canonicalEventId,
  );
  const sourceEvidenceIds = input.plan.changes.map(
    (change) => change.sourceEvidenceId,
  );

  let deletedInboxProjectionCount = 0;
  let deletedIdentityReviewCount = 0;
  let deletedRoutingReviewCount = 0;
  let deletedCanonicalCount = 0;
  let deletedSourceEvidenceCount = 0;

  await input.connection.db.transaction(async (tx) => {
    for (const chunk of chunkValues(affectedContactIds, deleteChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const deletedInboxRows = await tx
        .delete(contactInboxProjection)
        .where(inArray(contactInboxProjection.contactId, chunk))
        .returning({
          contactId: contactInboxProjection.contactId,
        });

      deletedInboxProjectionCount += deletedInboxRows.length;
    }

    for (const chunk of chunkValues(sourceEvidenceIds, deleteChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const deletedIdentityRows = await tx
        .delete(identityResolutionQueue)
        .where(inArray(identityResolutionQueue.sourceEvidenceId, chunk))
        .returning({
          id: identityResolutionQueue.id,
        });
      deletedIdentityReviewCount += deletedIdentityRows.length;

      const deletedRoutingRows = await tx
        .delete(routingReviewQueue)
        .where(inArray(routingReviewQueue.sourceEvidenceId, chunk))
        .returning({
          id: routingReviewQueue.id,
        });
      deletedRoutingReviewCount += deletedRoutingRows.length;
    }

    for (const chunk of chunkValues(canonicalEventIds, deleteChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const deletedCanonicalRows = await tx
        .delete(canonicalEventLedger)
        .where(inArray(canonicalEventLedger.id, chunk))
        .returning({
          id: canonicalEventLedger.id,
        });

      deletedCanonicalCount += deletedCanonicalRows.length;
    }

    for (const chunk of chunkValues(sourceEvidenceIds, deleteChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const deletedSourceEvidenceRows = await tx
        .delete(sourceEvidenceLog)
        .where(inArray(sourceEvidenceLog.id, chunk))
        .returning({
          id: sourceEvidenceLog.id,
        });

      deletedSourceEvidenceCount += deletedSourceEvidenceRows.length;
    }
  });

  return {
    deletedCanonicalCount,
    deletedSourceEvidenceCount,
    deletedInboxProjectionCount,
    deletedIdentityReviewCount,
    deletedRoutingReviewCount,
  };
}

async function rebuildProjectionsForContacts(
  orchestration: Pick<
    Stage1WorkerOrchestrationService,
    "runProjectionRebuildBatch"
  >,
  contactIds: readonly string[],
  logger: Logger,
): Promise<{
  readonly rebuiltContactCount: number;
  readonly missingProjectionSeeds: readonly string[];
}> {
  const sortedContactIds = uniqueSortedStrings(contactIds);
  const missingProjectionSeeds = new Set<string>();
  let rebuiltContactCount = 0;

  for (const [index, chunk] of chunkValues(
    sortedContactIds,
    projectionChunkSize,
  ).entries()) {
    const result = await orchestration.runProjectionRebuildBatch(
      projectionRebuildBatchPayloadSchema.parse({
        version: stage1JobVersion,
        jobId: buildOperationId("stage1:projection-rebuild:job"),
        correlationId: buildOperationId(
          "stage1:projection-rebuild:correlation",
        ),
        traceId: null,
        batchId: buildOperationId("stage1:projection-rebuild:batch"),
        syncStateId: buildOperationId("stage1:projection-rebuild:sync-state"),
        attempt: 1,
        maxAttempts: 1,
        jobType: "projection_rebuild",
        projection: "all",
        contactIds: chunk,
        includeReviewOverlayRefresh: true,
      }),
    );

    if (result.outcome !== "succeeded") {
      const failureMessage = result.failure?.message ?? "unknown failure";
      throw new Error(
        `Projection rebuild batch ${String(index + 1)} failed: ${failureMessage}`,
      );
    }

    rebuiltContactCount += result.rebuiltContactIds.length;
    for (const canonicalEventId of result.missingProjectionSeeds) {
      missingProjectionSeeds.add(canonicalEventId);
    }

    logger.log(
      `- rebuilt projections for ${String(rebuiltContactCount)} / ${String(sortedContactIds.length)} contacts`,
    );
  }

  return {
    rebuiltContactCount,
    missingProjectionSeeds: Array.from(missingProjectionSeeds).sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}

export async function runCleanupSalesforceOwnerScope(input: {
  readonly connectionString: string;
  readonly targetOrg: string;
  readonly dryRun: boolean;
  readonly includeUnresolved?: boolean;
  readonly limit?: number | null;
  readonly logger?: Logger;
  readonly queryRunner?: SfQueryRunner;
}): Promise<CleanupSalesforceOwnerScopeResult> {
  const logger = input.logger ?? console;
  const connection = createDatabaseConnection({
    connectionString: input.connectionString,
  });

  try {
    const sql = connection.sql as unknown as SqlRunner;
    const candidates = await loadCleanupCandidates(sql, {
      limit: input.limit ?? null,
    });
    const queryRunner = input.queryRunner ?? createSfCliQueryRunner();
    const ownerUsernameByTaskId = await queryRunner.queryTaskOwnerUsernames({
      targetOrg: input.targetOrg,
      taskIds: candidates.map((candidate) => candidate.providerRecordId),
    });
    const plan = planSalesforceOwnerScopeCleanup({
      candidates,
      ownerUsernameByTaskId,
      includeUnresolved: input.includeUnresolved ?? false,
    });

    printPlanSummary(plan, {
      dryRun: input.dryRun,
      targetOrg: input.targetOrg,
      includeUnresolved: input.includeUnresolved ?? false,
    });
    printSampleChanges(plan.changes);
    printSampleUnresolved(plan.unresolvedProviderRecordIds);

    if (input.dryRun) {
      logger.log(
        `Dry run complete. Re-run with --execute${input.includeUnresolved ? " --delete-unresolved" : ""} to delete the current in-scope rows.`,
      );
      return {
        dryRun: true,
        targetOrg: input.targetOrg,
        scannedCount: plan.scannedCount,
        resolvedCount: plan.resolvedCount,
        keepCount: plan.keepCount,
        removeCount: plan.removeCount,
        unresolvedCount: plan.unresolvedCount,
        affectedContactIds: plan.affectedContactIds,
        unresolvedProviderRecordIds: plan.unresolvedProviderRecordIds,
        deletedCanonicalCount: 0,
        deletedSourceEvidenceCount: 0,
        deletedInboxProjectionCount: 0,
        deletedIdentityReviewCount: 0,
        deletedRoutingReviewCount: 0,
        rebuiltContactCount: 0,
        missingProjectionSeeds: [],
      };
    }

    if (plan.changes.length === 0) {
      logger.log("No Salesforce rows matched the current cleanup scope.");
      return {
        dryRun: false,
        targetOrg: input.targetOrg,
        scannedCount: plan.scannedCount,
        resolvedCount: plan.resolvedCount,
        keepCount: plan.keepCount,
        removeCount: 0,
        unresolvedCount: plan.unresolvedCount,
        affectedContactIds: [],
        unresolvedProviderRecordIds: plan.unresolvedProviderRecordIds,
        deletedCanonicalCount: 0,
        deletedSourceEvidenceCount: 0,
        deletedInboxProjectionCount: 0,
        deletedIdentityReviewCount: 0,
        deletedRoutingReviewCount: 0,
        rebuiltContactCount: 0,
        missingProjectionSeeds: [],
      };
    }

    const deleteCounts = await deleteRowsForPlan({
      connection,
      plan,
    });
    logger.log(
      `- deleted canonical events: ${String(deleteCounts.deletedCanonicalCount)}`,
    );
    logger.log(
      `- deleted source evidence rows: ${String(deleteCounts.deletedSourceEvidenceCount)}`,
    );
    logger.log(
      `- deleted inbox projection rows: ${String(deleteCounts.deletedInboxProjectionCount)}`,
    );

    const orchestration = createProjectionRebuildOrchestration(connection);
    const rebuildResult = await rebuildProjectionsForContacts(
      orchestration,
      plan.affectedContactIds,
      logger,
    );

    return {
      dryRun: false,
      targetOrg: input.targetOrg,
      scannedCount: plan.scannedCount,
      resolvedCount: plan.resolvedCount,
      keepCount: plan.keepCount,
      removeCount: plan.removeCount,
      unresolvedCount: plan.unresolvedCount,
      affectedContactIds: plan.affectedContactIds,
      unresolvedProviderRecordIds: plan.unresolvedProviderRecordIds,
      deletedCanonicalCount: deleteCounts.deletedCanonicalCount,
      deletedSourceEvidenceCount: deleteCounts.deletedSourceEvidenceCount,
      deletedInboxProjectionCount: deleteCounts.deletedInboxProjectionCount,
      deletedIdentityReviewCount: deleteCounts.deletedIdentityReviewCount,
      deletedRoutingReviewCount: deleteCounts.deletedRoutingReviewCount,
      rebuiltContactCount: rebuildResult.rebuiltContactCount,
      missingProjectionSeeds: rebuildResult.missingProjectionSeeds,
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

export async function runCleanupSalesforceOwnerScopeCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CleanupSalesforceOwnerScopeResult> {
  const flags = parseCliFlags(args);
  const targetOrg =
    readOptionalStringFlag(flags, "target-org") ?? defaultTargetOrg;
  const limit = readOptionalIntegerFlag(flags, "limit", 0);
  const includeUnresolved = readOptionalBooleanFlag(
    flags,
    "delete-unresolved",
    false,
  );

  return runCleanupSalesforceOwnerScope({
    connectionString: readConnectionString(env),
    targetOrg,
    dryRun: !readOptionalBooleanFlag(flags, "execute", false),
    includeUnresolved,
    limit: limit === 0 ? null : limit,
  });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runCleanupSalesforceOwnerScopeCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "cleanup-salesforce-owner-scope failed.";

      console.error(message);
      process.exitCode = 1;
    },
  );
}
