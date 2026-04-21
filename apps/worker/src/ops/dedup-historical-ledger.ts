#!/usr/bin/env tsx
/**
 * dedup-historical-ledger
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops dedup-historical-ledger
 *   pnpm --filter @as-comms/worker ops dedup-historical-ledger --limit 100
 *   pnpm --filter @as-comms/worker ops dedup-historical-ledger --execute --limit 100
 *
 * Dry-run by default. Finds historical outbound-email duplicates using the same
 * 15 minute fingerprint heuristic as live normalization, emits a JSONL audit
 * trail to stdout, and can optionally merge the surviving ledger rows in-place.
 */
import process from "node:process";

import {
  asc,
  eq,
  inArray
} from "drizzle-orm";

import {
  canonicalEventSchema,
  type CanonicalEventRecord
} from "@as-comms/contracts";
import {
  createDatabaseConnection,
  closeDatabaseConnection,
  createStage1RepositoryBundle,
  createStage1RepositoryBundleFromConnection,
  canonicalEventLedger,
  contactInboxProjection,
  contactTimelineProjection,
  type Stage1Database
} from "@as-comms/db";
import {
  buildOutboundEmailDuplicateFingerprint,
  buildPersistedOutboundEmailFingerprintSource,
  isWithinOutboundEmailFingerprintWindow,
  resolveOutboundEmailMergedWinnerDecision,
  selectOutboundEmailDuplicateWinner
} from "@as-comms/domain";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag
} from "./helpers.js";

const executeBatchLoserLimit = 500;

type Stage1Repositories = ReturnType<typeof createStage1RepositoryBundle>;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface AuditWriter {
  writeLine(line: string): void;
}

interface CanonicalEventReference {
  readonly table: "contact_inbox_projection" | "contact_timeline_projection";
  readonly column: "last_canonical_event_id" | "canonical_event_id";
  readonly action: "repoint_to_winner" | "delete_loser_projection_row";
}

interface HistoricalOutboundEmailCandidate {
  readonly event: CanonicalEventRecord;
  readonly fingerprint: string;
}

interface HistoricalDedupClusterPlan {
  winner: HistoricalOutboundEmailCandidate;
  losers: HistoricalOutboundEmailCandidate[];
}

interface HistoricalDedupAuditLine {
  readonly winnerId: string;
  readonly loserId: string;
  readonly winnerProvider: CanonicalEventRecord["provenance"]["primaryProvider"];
  readonly loserProvider: CanonicalEventRecord["provenance"]["primaryProvider"];
  readonly contactId: string;
  readonly occurredAt: string;
  readonly operation: "would_merge" | "merged" | "skipped_already_merged";
}

export interface HistoricalLedgerDedupResult {
  readonly dryRun: boolean;
  readonly referenceTargets: readonly CanonicalEventReference[];
  readonly scannedCandidateCount: number;
  readonly plannedClusterCount: number;
  readonly plannedLoserCount: number;
  readonly deletedCanonicalCount: number;
  readonly deletedTimelineCount: number;
  readonly repointedInboxCount: number;
  readonly skippedAlreadyMergedCount: number;
  readonly auditLines: readonly HistoricalDedupAuditLine[];
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

function normalizeOccurredAt(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mergeReviewState(
  left: CanonicalEventRecord["reviewState"],
  right: CanonicalEventRecord["reviewState"]
): CanonicalEventRecord["reviewState"] {
  if (left === "quarantined" || right === "quarantined") {
    return "quarantined";
  }

  if (
    left === "needs_identity_review" ||
    right === "needs_identity_review"
  ) {
    return "needs_identity_review";
  }

  if (left === "needs_routing_review" || right === "needs_routing_review") {
    return "needs_routing_review";
  }

  return "clear";
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

function compareCandidates(
  left: HistoricalOutboundEmailCandidate,
  right: HistoricalOutboundEmailCandidate
): number {
  if (left.event.contactId !== right.event.contactId) {
    return left.event.contactId.localeCompare(right.event.contactId);
  }

  if (left.event.occurredAt !== right.event.occurredAt) {
    return left.event.occurredAt.localeCompare(right.event.occurredAt);
  }

  return left.event.id.localeCompare(right.event.id);
}

function knownCanonicalEventReferences(): readonly CanonicalEventReference[] {
  return [
    {
      table: "contact_inbox_projection",
      column: "last_canonical_event_id",
      action: "repoint_to_winner"
    },
    {
      table: "contact_timeline_projection",
      column: "canonical_event_id",
      action: "delete_loser_projection_row"
    }
  ];
}

function buildHistoricalMergedWinnerEvent(input: {
  readonly winner: CanonicalEventRecord;
  readonly losers: readonly CanonicalEventRecord[];
}): CanonicalEventRecord {
  const supportingSourceEvidenceIds = uniqueSortedStrings([
    ...input.winner.provenance.supportingSourceEvidenceIds,
    ...input.losers.flatMap((loser) => [
      loser.sourceEvidenceId,
      ...loser.provenance.supportingSourceEvidenceIds
    ])
  ]).filter((sourceEvidenceId) => sourceEvidenceId !== input.winner.sourceEvidenceId);
  const supportingProviders = new Set<
    CanonicalEventRecord["provenance"]["primaryProvider"]
  >(input.losers.map((loser) => loser.provenance.primaryProvider));

  if (
    input.winner.provenance.winnerReason === "gmail_wins_duplicate_collapse"
  ) {
    supportingProviders.add("salesforce");
  }

  if (
    input.winner.provenance.winnerReason ===
    "earliest_gmail_wins_duplicate_collapse"
  ) {
    supportingProviders.add("gmail");
  }

  const winnerDecision = resolveOutboundEmailMergedWinnerDecision({
    primaryProvider: input.winner.provenance.primaryProvider,
    supportingProviders: [...supportingProviders],
    fallback: {
      winnerReason: input.winner.provenance.winnerReason,
      notes: input.winner.provenance.notes ?? null
    }
  });

  return canonicalEventSchema.parse({
    ...input.winner,
    provenance: {
      ...input.winner.provenance,
      supportingSourceEvidenceIds,
      winnerReason: winnerDecision.winnerReason,
      notes: winnerDecision.notes ?? undefined
    },
    reviewState: input.losers.reduce(
      (current, loser) => mergeReviewState(current, loser.reviewState),
      input.winner.reviewState
    )
  });
}

function applyLimitToPlans(
  plans: readonly HistoricalDedupClusterPlan[],
  limit: number | null
): readonly HistoricalDedupClusterPlan[] {
  if (limit === null) {
    return plans;
  }

  const limitedPlans: HistoricalDedupClusterPlan[] = [];
  let remaining = limit;

  for (const plan of plans) {
    if (remaining <= 0) {
      break;
    }

    if (plan.losers.length <= remaining) {
      limitedPlans.push(plan);
      remaining -= plan.losers.length;
      continue;
    }

    limitedPlans.push({
      winner: plan.winner,
      losers: plan.losers.slice(0, remaining)
    });
    break;
  }

  return limitedPlans;
}

function chunkPlansByLoserCount(
  plans: readonly HistoricalDedupClusterPlan[],
  limit: number
): HistoricalDedupClusterPlan[][] {
  const chunks: HistoricalDedupClusterPlan[][] = [];
  let currentChunk: HistoricalDedupClusterPlan[] = [];
  let currentLoserCount = 0;

  for (const plan of plans) {
    const loserCount = plan.losers.length;

    if (
      currentChunk.length > 0 &&
      currentLoserCount + loserCount > limit
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLoserCount = 0;
    }

    currentChunk.push(plan);
    currentLoserCount += loserCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function loadHistoricalOutboundEmailCandidates(input: {
  readonly db: Stage1Database;
  readonly repositories: Stage1Repositories;
}): Promise<readonly HistoricalOutboundEmailCandidate[]> {
  const canonicalRows = await input.db
    .select()
    .from(canonicalEventLedger)
    .where(eq(canonicalEventLedger.eventType, "communication.email.outbound"))
    .orderBy(
      asc(canonicalEventLedger.contactId),
      asc(canonicalEventLedger.occurredAt),
      asc(canonicalEventLedger.id)
    );
  const sourceEvidenceIds = uniqueSortedStrings(
    canonicalRows.map((row) => row.sourceEvidenceId)
  );
  const [gmailMessageDetails, salesforceCommunicationDetails] = await Promise.all([
    input.repositories.gmailMessageDetails.listBySourceEvidenceIds(sourceEvidenceIds),
    input.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    )
  ]);
  const gmailMessageDetailBySourceEvidenceId = new Map(
    gmailMessageDetails.map((detail) => [detail.sourceEvidenceId, detail] as const)
  );
  const salesforceCommunicationDetailBySourceEvidenceId = new Map(
    salesforceCommunicationDetails.map((detail) => [
      detail.sourceEvidenceId,
      detail
    ] as const)
  );
  const candidates: HistoricalOutboundEmailCandidate[] = [];

  for (const row of canonicalRows) {
    const event = canonicalEventSchema.parse({
      id: row.id,
      contactId: row.contactId,
      eventType: row.eventType,
      channel: row.channel,
      occurredAt: normalizeOccurredAt(row.occurredAt),
      sourceEvidenceId: row.sourceEvidenceId,
      idempotencyKey: row.idempotencyKey,
      provenance: row.provenance,
      reviewState: row.reviewState
    });

    if (
      event.provenance.primaryProvider !== "gmail" &&
      event.provenance.primaryProvider !== "salesforce"
    ) {
      continue;
    }

    const source = buildPersistedOutboundEmailFingerprintSource({
      event,
      gmailMessageDetailBySourceEvidenceId,
      salesforceCommunicationDetailBySourceEvidenceId
    });

    if (source === null) {
      continue;
    }

    const fingerprint = buildOutboundEmailDuplicateFingerprint({
      subject: source.subject,
      body: source.body
    });

    if (fingerprint === null) {
      continue;
    }

    candidates.push({
      event,
      fingerprint
    });
  }

  return candidates.sort(compareCandidates);
}

export function planHistoricalLedgerDedup(
  candidates: readonly HistoricalOutboundEmailCandidate[],
  input?: {
    readonly limit?: number | null;
  }
): readonly HistoricalDedupClusterPlan[] {
  const clustersByContactAndFingerprint = new Map<
    string,
    HistoricalDedupClusterPlan[]
  >();

  for (const candidate of candidates) {
    const clusterKey = `${candidate.event.contactId}::${candidate.fingerprint}`;
    const clusters = clustersByContactAndFingerprint.get(clusterKey) ?? [];
    let matchedCluster: HistoricalDedupClusterPlan | null = null;

    for (let index = clusters.length - 1; index >= 0; index -= 1) {
      const cluster = clusters[index];

      if (cluster === undefined) {
        continue;
      }

      if (
        !isWithinOutboundEmailFingerprintWindow({
          leftOccurredAt: cluster.winner.event.occurredAt,
          rightOccurredAt: candidate.event.occurredAt
        })
      ) {
        break;
      }

      const winnerSelection = selectOutboundEmailDuplicateWinner({
        incoming: {
          provider: candidate.event.provenance.primaryProvider,
          occurredAt: candidate.event.occurredAt
        },
        existing: {
          provider: cluster.winner.event.provenance.primaryProvider,
          occurredAt: cluster.winner.event.occurredAt
        }
      });

      if (winnerSelection === null) {
        continue;
      }

      matchedCluster = cluster;

      if (winnerSelection.winner === "incoming") {
        cluster.losers = [...cluster.losers, cluster.winner];
        cluster.winner = candidate;
      } else {
        cluster.losers = [...cluster.losers, candidate];
      }

      break;
    }

    if (matchedCluster !== null) {
      continue;
    }

    clusters.push({
      winner: candidate,
      losers: []
    });
    clustersByContactAndFingerprint.set(clusterKey, clusters);
  }

  const plans = Array.from(clustersByContactAndFingerprint.values())
    .flat()
    .filter((plan) => plan.losers.length > 0)
    .sort((left, right) => compareCandidates(left.winner, right.winner));

  return applyLimitToPlans(plans, input?.limit ?? null);
}

function buildAuditLinesForPlans(
  plans: readonly HistoricalDedupClusterPlan[],
  operation: HistoricalDedupAuditLine["operation"]
): HistoricalDedupAuditLine[] {
  return plans.flatMap((plan) =>
    plan.losers.map((loser) => ({
      winnerId: plan.winner.event.id,
      loserId: loser.event.id,
      winnerProvider: plan.winner.event.provenance.primaryProvider,
      loserProvider: loser.event.provenance.primaryProvider,
      contactId: plan.winner.event.contactId,
      occurredAt: loser.event.occurredAt,
      operation
    }))
  );
}

async function applyDedupPlans(input: {
  readonly db: Stage1Database;
  readonly repositories: Stage1Repositories;
  readonly plans: readonly HistoricalDedupClusterPlan[];
  readonly auditWriter: AuditWriter;
}): Promise<{
  readonly deletedCanonicalCount: number;
  readonly deletedTimelineCount: number;
  readonly repointedInboxCount: number;
  readonly skippedAlreadyMergedCount: number;
  readonly auditLines: readonly HistoricalDedupAuditLine[];
}> {
  const auditLines: HistoricalDedupAuditLine[] = [];
  let deletedCanonicalCount = 0;
  let deletedTimelineCount = 0;
  let repointedInboxCount = 0;
  let skippedAlreadyMergedCount = 0;

  for (const batch of chunkPlansByLoserCount(input.plans, executeBatchLoserLimit)) {
    await input.db.transaction(async (tx) => {
      const txRepositories = createStage1RepositoryBundle(tx as Stage1Database);

      for (const plan of batch) {
        const winner = await txRepositories.canonicalEvents.findById(
          plan.winner.event.id
        );

        if (winner === null) {
          for (const loser of plan.losers) {
            const auditLine: HistoricalDedupAuditLine = {
              winnerId: plan.winner.event.id,
              loserId: loser.event.id,
              winnerProvider: plan.winner.event.provenance.primaryProvider,
              loserProvider: loser.event.provenance.primaryProvider,
              contactId: plan.winner.event.contactId,
              occurredAt: loser.event.occurredAt,
              operation: "skipped_already_merged"
            };
            auditLines.push(auditLine);
            input.auditWriter.writeLine(JSON.stringify(auditLine));
            skippedAlreadyMergedCount += 1;
          }

          continue;
        }

        const loserIds = plan.losers.map((loser) => loser.event.id);
        const presentLosers =
          loserIds.length === 0
            ? []
            : await txRepositories.canonicalEvents.listByIds(loserIds);
        const presentLoserIdSet = new Set(
          presentLosers.map((loser) => loser.id)
        );
        const missingLosers = plan.losers.filter(
          (loser) => !presentLoserIdSet.has(loser.event.id)
        );

        for (const loser of missingLosers) {
          const auditLine: HistoricalDedupAuditLine = {
            winnerId: winner.id,
            loserId: loser.event.id,
            winnerProvider: winner.provenance.primaryProvider,
            loserProvider: loser.event.provenance.primaryProvider,
            contactId: winner.contactId,
            occurredAt: loser.event.occurredAt,
            operation: "skipped_already_merged"
          };
          auditLines.push(auditLine);
          input.auditWriter.writeLine(JSON.stringify(auditLine));
          skippedAlreadyMergedCount += 1;
        }

        if (presentLosers.length === 0) {
          continue;
        }

        const mergedWinner = buildHistoricalMergedWinnerEvent({
          winner,
          losers: presentLosers
        });
        await txRepositories.canonicalEvents.upsert(mergedWinner);

        const presentLoserIds = presentLosers.map((loser) => loser.id);
        const updatedInboxRows = await tx
          .update(contactInboxProjection)
          .set({
            lastCanonicalEventId: mergedWinner.id,
            updatedAt: new Date()
          })
          .where(inArray(contactInboxProjection.lastCanonicalEventId, presentLoserIds))
          .returning({
            contactId: contactInboxProjection.contactId
          });
        repointedInboxCount += updatedInboxRows.length;

        const deletedTimelineRows = await tx
          .delete(contactTimelineProjection)
          .where(inArray(contactTimelineProjection.canonicalEventId, presentLoserIds))
          .returning({
            id: contactTimelineProjection.id
          });
        deletedTimelineCount += deletedTimelineRows.length;

        const deletedCanonicalRows = await tx
          .delete(canonicalEventLedger)
          .where(inArray(canonicalEventLedger.id, presentLoserIds))
          .returning({
            id: canonicalEventLedger.id
          });
        deletedCanonicalCount += deletedCanonicalRows.length;

        for (const loser of presentLosers) {
          const auditLine: HistoricalDedupAuditLine = {
            winnerId: mergedWinner.id,
            loserId: loser.id,
            winnerProvider: mergedWinner.provenance.primaryProvider,
            loserProvider: loser.provenance.primaryProvider,
            contactId: mergedWinner.contactId,
            occurredAt: loser.occurredAt,
            operation: "merged"
          };
          auditLines.push(auditLine);
          input.auditWriter.writeLine(JSON.stringify(auditLine));
        }
      }
    });
  }

  return {
    deletedCanonicalCount,
    deletedTimelineCount,
    repointedInboxCount,
    skippedAlreadyMergedCount,
    auditLines
  };
}

export async function dedupHistoricalLedger(input: {
  readonly db: Stage1Database;
  readonly repositories: Stage1Repositories;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: Logger;
  readonly auditWriter?: AuditWriter;
}): Promise<HistoricalLedgerDedupResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;
  const auditWriter = input.auditWriter ?? {
    writeLine(line: string) {
      process.stdout.write(`${line}\n`);
    }
  };
  const referenceTargets = knownCanonicalEventReferences();
  const candidates = await loadHistoricalOutboundEmailCandidates({
    db: input.db,
    repositories: input.repositories
  });
  const plans = planHistoricalLedgerDedup(candidates, {
    limit: input.limit ?? null
  });

  logger.error("dedup-historical-ledger");
  logger.error(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  logger.error(
    `References: ${referenceTargets.map((reference) => `${reference.table}.${reference.column}:${reference.action}`).join(", ")}`
  );
  logger.error(`- scanned candidates: ${String(candidates.length)}`);
  logger.error(`- duplicate clusters: ${String(plans.length)}`);
  logger.error(
    `- loser rows in scope: ${String(plans.reduce((total, plan) => total + plan.losers.length, 0))}`
  );

  if (dryRun) {
    const auditLines = buildAuditLinesForPlans(plans, "would_merge");

    for (const auditLine of auditLines) {
      auditWriter.writeLine(JSON.stringify(auditLine));
    }

    return {
      dryRun: true,
      referenceTargets,
      scannedCandidateCount: candidates.length,
      plannedClusterCount: plans.length,
      plannedLoserCount: auditLines.length,
      deletedCanonicalCount: 0,
      deletedTimelineCount: 0,
      repointedInboxCount: 0,
      skippedAlreadyMergedCount: 0,
      auditLines
    };
  }

  const applied = await applyDedupPlans({
    db: input.db,
    repositories: input.repositories,
    plans,
    auditWriter
  });

  return {
    dryRun: false,
    referenceTargets,
    scannedCandidateCount: candidates.length,
    plannedClusterCount: plans.length,
    plannedLoserCount: plans.reduce(
      (total, plan) => total + plan.losers.length,
      0
    ),
    deletedCanonicalCount: applied.deletedCanonicalCount,
    deletedTimelineCount: applied.deletedTimelineCount,
    repointedInboxCount: applied.repointedInboxCount,
    skippedAlreadyMergedCount: applied.skippedAlreadyMergedCount,
    auditLines: applied.auditLines
  };
}

export async function runDedupHistoricalLedgerCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<HistoricalLedgerDedupResult> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env)
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);

    return await dedupHistoricalLedger({
      db: connection.db,
      repositories,
      dryRun: !readOptionalBooleanFlag(flags, "execute", false),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runDedupHistoricalLedgerCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "dedup-historical-ledger failed.";

      console.error(message);
      process.exitCode = 1;
    }
  );
}
