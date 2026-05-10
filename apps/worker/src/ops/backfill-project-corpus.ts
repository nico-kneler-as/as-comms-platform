#!/usr/bin/env tsx
/**
 * backfill-project-corpus
 *
 * Seeds the bulk EMAIL_CORPUS training signal for a project by sweeping
 * historical outbound Gmail replies and writing them as
 * `project_knowledge_entries` rows with `kind = 'corpus_example'`.
 *
 * Why this exists: PRD #366 Phase 3 made canonical_reply (operator-marked
 * "Send and save for AI") the primary tone-control surface, leaving the
 * EMAIL_CORPUS block of the synthesis prompt empty by default. With zero
 * approved canonical replies in any active project (platform pre-launch),
 * synthesis runs with no tone signal at all — the prompt's section 5
 * ("Common volunteer questions and approved answer patterns") collapses
 * to nothing useful. This script bootstraps that signal from history.
 *
 * Quality filters (keep them tight; bad backfills poison the AI):
 *   - direction = outbound, sent from the project's volunteer alias
 *   - body length 200..3000 chars (excludes one-liners and forwarded threads)
 *   - last 18 months (recent enough to reflect current voice)
 *   - PII masked through the shared maskKnowledgeExample primitive
 *
 * Idempotent: row id derived from source_evidence_id, so repeat runs upsert
 * the same id and overwrite (which catches mask-rule changes and drift).
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:backfill-project-corpus -- \
 *     --project=<salesforce_project_id> --alias=<alias_email> [--limit=200] [--execute]
 *
 * Dry-run by default. Pass --execute to actually upsert.
 */
import process from "node:process";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import {
  canonicalEventLedger,
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  gmailMessageDetails,
} from "@as-comms/db";
import { maskKnowledgeExample } from "@as-comms/domain";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readRequiredFlag,
} from "./helpers.js";

const DEFAULT_LIMIT = 200;
const MIN_BODY_LENGTH = 200;
const MAX_BODY_LENGTH = 3_000;
const RECENCY_MONTHS = 18;

interface OutboundCandidate {
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly occurredAt: Date;
  readonly subject: string | null;
  readonly bodyText: string;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString;
}

function deriveEntryId(sourceEvidenceId: string): string {
  // Stable id keyed on source_evidence_id so repeat runs upsert in place.
  // Shape mirrors the capture path's `project_knowledge:captured:<...>`
  // namespace but uses a `corpus:` discriminator to make audit/cleanup easy.
  return `project_knowledge:corpus:${sourceEvidenceId}`;
}

function buildQuestionSummary(subject: string | null, bodyText: string): string {
  const trimmedSubject = subject?.trim() ?? "";
  if (trimmedSubject.length > 0) {
    return trimmedSubject.slice(0, 200);
  }
  // Fall back to first line of body when the subject is empty/missing —
  // some Gmail captures lose the subject header on threading.
  const firstLine = bodyText.trim().split("\n").find((line) => line.trim().length > 0);
  return (firstLine ?? "(historical outbound reply)").slice(0, 200);
}

async function fetchOutboundCandidates(input: {
  readonly db: { readonly db: ReturnType<typeof createDatabaseConnection>["db"] };
  readonly alias: string;
  readonly limit: number;
}): Promise<readonly OutboundCandidate[]> {
  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - RECENCY_MONTHS);

  const rows = await input.db.db
    .select({
      sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
      canonicalEventId: canonicalEventLedger.id,
      occurredAt: canonicalEventLedger.occurredAt,
      subject: gmailMessageDetails.subject,
      bodyText: gmailMessageDetails.bodyTextPreview,
    })
    .from(gmailMessageDetails)
    .innerJoin(
      canonicalEventLedger,
      eq(canonicalEventLedger.sourceEvidenceId, gmailMessageDetails.sourceEvidenceId),
    )
    .where(
      and(
        eq(gmailMessageDetails.direction, "outbound"),
        eq(gmailMessageDetails.projectInboxAlias, input.alias),
        gte(canonicalEventLedger.occurredAt, sinceDate),
        sql`length(${gmailMessageDetails.bodyTextPreview}) BETWEEN ${MIN_BODY_LENGTH} AND ${MAX_BODY_LENGTH}`,
      ),
    )
    .orderBy(desc(canonicalEventLedger.occurredAt))
    .limit(input.limit);

  return rows.map((row) => ({
    sourceEvidenceId: row.sourceEvidenceId,
    canonicalEventId: row.canonicalEventId,
    occurredAt:
      row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
    subject: row.subject,
    bodyText: row.bodyText,
  }));
}

export interface BackfillProjectCorpusResult {
  readonly projectId: string;
  readonly alias: string;
  readonly dryRun: boolean;
  readonly candidatesScanned: number;
  readonly upserted: number;
  readonly skippedEmptyBody: number;
  readonly runtimeMs: number;
}

interface RunOptions {
  readonly projectId: string;
  readonly alias: string;
  readonly limit: number;
  readonly dryRun: boolean;
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
}

export async function runBackfillProjectCorpus(
  options: RunOptions,
): Promise<BackfillProjectCorpusResult> {
  const startedAt = Date.now();
  const logger = options.logger ?? console;
  const connectionString = readConnectionString(process.env);
  const connection = createDatabaseConnection({ connectionString });
  const repositories = createStage1RepositoryBundleFromConnection(connection);

  try {
    const candidates = await fetchOutboundCandidates({
      db: connection,
      alias: options.alias,
      limit: options.limit,
    });

    logger.info(
      `[backfill-project-corpus] project=${options.projectId} alias=${options.alias} ` +
        `scanned=${String(candidates.length)} dry-run=${String(options.dryRun)}`,
    );

    let upserted = 0;
    let skippedEmptyBody = 0;

    for (const candidate of candidates) {
      const trimmed = candidate.bodyText.trim();
      if (trimmed.length === 0) {
        skippedEmptyBody += 1;
        continue;
      }

      const masked = maskKnowledgeExample(trimmed);
      const occurredIso = candidate.occurredAt.toISOString();

      if (options.dryRun) {
        upserted += 1;
        continue;
      }

      await repositories.projectKnowledge.upsert({
        id: deriveEntryId(candidate.sourceEvidenceId),
        projectId: options.projectId,
        kind: "corpus_example",
        issueType: null,
        volunteerStage: null,
        questionSummary: buildQuestionSummary(candidate.subject, trimmed),
        replyStrategy: null,
        maskedExample: masked,
        sourceKind: "captured_from_send",
        approvedForAi: true,
        sourceEventId: candidate.canonicalEventId,
        metadataJson: {
          backfilledAt: new Date().toISOString(),
          backfillSource: "backfill-project-corpus",
          alias: options.alias,
          subject: candidate.subject,
          originalBodyLength: trimmed.length,
        },
        lastReviewedAt: null,
        createdAt: occurredIso,
        updatedAt: new Date().toISOString(),
      });
      upserted += 1;
    }

    return {
      projectId: options.projectId,
      alias: options.alias,
      dryRun: options.dryRun,
      candidatesScanned: candidates.length,
      upserted,
      skippedEmptyBody,
      runtimeMs: Date.now() - startedAt,
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv.slice(2));
  const projectId = readRequiredFlag(flags, "project");
  const alias = readRequiredFlag(flags, "alias");
  const limit = readOptionalIntegerFlag(flags, "limit", DEFAULT_LIMIT);
  const execute = readOptionalBooleanFlag(flags, "execute", false);

  if (limit <= 0 || limit > 1_000) {
    console.error("--limit must be between 1 and 1000.");
    process.exit(2);
  }

  const result = await runBackfillProjectCorpus({
    projectId,
    alias,
    limit,
    dryRun: !execute,
  });

  console.error(
    `[backfill-project-corpus] done project=${result.projectId} ` +
      `alias=${result.alias} ` +
      `scanned=${String(result.candidatesScanned)} ` +
      `upserted=${String(result.upserted)} ` +
      `skipped_empty=${String(result.skippedEmptyBody)} ` +
      `dry_run=${String(result.dryRun)} ` +
      `runtime_ms=${String(result.runtimeMs)}`,
  );

  if (result.dryRun) {
    console.error(
      "[backfill-project-corpus] dry-run: no rows written. Re-run with --execute to persist.",
    );
  }
}

if (process.argv[1]?.endsWith("backfill-project-corpus.ts")) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
