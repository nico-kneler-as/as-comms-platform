#!/usr/bin/env tsx
/**
 * backfill-content-fingerprint
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops backfill-content-fingerprint
 *   pnpm --filter @as-comms/worker ops backfill-content-fingerprint --limit 100
 *   pnpm --filter @as-comms/worker ops backfill-content-fingerprint --execute
 *
 * Dry-run by default. Recomputes canonical_event_ledger.content_fingerprint
 * using the current persisted fingerprint-source builder plus the current
 * computeContentFingerprint algorithm. Emits JSONL audit rows to stdout and
 * writes summary counts to stderr.
 */
import process from "node:process";

import { asc, eq, inArray } from "drizzle-orm";

import {
  canonicalEventSchema,
  type CanonicalEventRecord,
} from "@as-comms/contracts";
import {
  canonicalEventLedger,
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type Stage1Database,
} from "@as-comms/db";
import type { createStage1RepositoryBundle } from "@as-comms/db";
import {
  buildPersistedContentFingerprintSource,
  computeContentFingerprint,
} from "@as-comms/domain";
import { toIsoTimestamp } from "@as-comms/integrations";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringArrayFlag,
} from "./helpers.js";

const detailBatchSize = 500;
const updateBatchSize = 500;
const defaultEventTypes = [
  "communication.email.outbound",
  "communication.email.inbound",
] as const satisfies readonly CanonicalEventRecord["eventType"][];

type Stage1Repositories = ReturnType<typeof createStage1RepositoryBundle>;

interface Logger {
  error(...args: readonly unknown[]): void;
}

interface AuditWriter {
  writeLine(line: string): void;
}

type SupportedFingerprintProvider = "gmail" | "salesforce";
type BackfillCategory = "unchanged" | "new_value" | "cleared" | "still_null";

interface BackfillContentFingerprintAuditLine {
  readonly id: string;
  readonly contactId: string;
  readonly provider: SupportedFingerprintProvider;
  readonly oldFingerprint: string | null;
  readonly newFingerprint: string | null;
  readonly occurredAt: string;
  readonly eventType: CanonicalEventRecord["eventType"];
}

interface BackfillContentFingerprintCandidate {
  readonly id: string;
  readonly contactId: string;
  readonly provider: SupportedFingerprintProvider;
  readonly eventType: CanonicalEventRecord["eventType"];
  readonly occurredAt: string;
  readonly oldFingerprint: string | null;
  readonly newFingerprint: string | null;
  readonly category: BackfillCategory;
}

export interface BackfillContentFingerprintResult {
  readonly dryRun: boolean;
  readonly eventTypes: readonly CanonicalEventRecord["eventType"][];
  readonly scannedCount: number;
  readonly categoryCounts: Readonly<Record<BackfillCategory, number>>;
  readonly updatedCount: number;
  readonly runtimeMs: number;
  readonly warningCount: number;
  readonly auditLines: readonly BackfillContentFingerprintAuditLine[];
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

function parseBackfillEventTypes(
  args: readonly CanonicalEventRecord["eventType"][],
): CanonicalEventRecord["eventType"][] {
  const allowed = new Set<CanonicalEventRecord["eventType"]>([
    "communication.email.outbound",
    "communication.email.inbound",
  ]);
  const eventTypes = args.length === 0 ? [...defaultEventTypes] : [...new Set(args)];

  for (const eventType of eventTypes) {
    if (!allowed.has(eventType)) {
      throw new Error(
        `Unsupported --event-types value "${eventType}". Allowed values: communication.email.outbound, communication.email.inbound.`,
      );
    }
  }

  return eventTypes;
}

function normalizeOccurredAt(value: Date | string): string {
  const normalized = toIsoTimestamp(value);

  if (normalized === null) {
    throw new Error("Expected canonical_event_ledger.occurred_at to be a valid timestamp.");
  }

  return normalized;
}

function toCanonicalEventRecord(row: typeof canonicalEventLedger.$inferSelect): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: row.id,
    contactId: row.contactId,
    eventType: row.eventType,
    channel: row.channel,
    occurredAt: normalizeOccurredAt(row.occurredAt),
    contentFingerprint: row.contentFingerprint,
    sourceEvidenceId: row.sourceEvidenceId,
    idempotencyKey: row.idempotencyKey,
    provenance: row.provenance,
    reviewState: row.reviewState,
  });
}

function categorizeFingerprintChange(input: {
  readonly oldFingerprint: string | null;
  readonly newFingerprint: string | null;
}): BackfillCategory {
  if (input.oldFingerprint === input.newFingerprint) {
    return input.oldFingerprint === null ? "still_null" : "unchanged";
  }

  if (input.newFingerprint === null) {
    return "cleared";
  }

  return "new_value";
}

async function loadCandidates(input: {
  readonly db: Stage1Database;
  readonly repositories: Stage1Repositories;
  readonly eventTypes: readonly CanonicalEventRecord["eventType"][];
  readonly limit: number | null;
}): Promise<readonly BackfillContentFingerprintCandidate[]> {
  const rows = await input.db
    .select()
    .from(canonicalEventLedger)
    .where(inArray(canonicalEventLedger.eventType, [...input.eventTypes]))
    .orderBy(
      asc(canonicalEventLedger.contactId),
      asc(canonicalEventLedger.occurredAt),
      asc(canonicalEventLedger.id),
    );
  const limitedRows =
    input.limit === null ? rows : rows.slice(0, input.limit);
  const parsedEvents = limitedRows.map(toCanonicalEventRecord);
  const sourceEvidenceIds = Array.from(
    new Set(parsedEvents.map((event) => event.sourceEvidenceId)),
  ).sort((left, right) => left.localeCompare(right));

  const gmailMessageDetailBySourceEvidenceId = new Map();
  const salesforceCommunicationDetailBySourceEvidenceId = new Map();

  for (const sourceEvidenceIdChunk of chunkValues(sourceEvidenceIds, detailBatchSize)) {
    const [gmailDetails, salesforceDetails] = await Promise.all([
      input.repositories.gmailMessageDetails.listBySourceEvidenceIds(
        sourceEvidenceIdChunk,
      ),
      input.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
        sourceEvidenceIdChunk,
      ),
    ]);

    for (const detail of gmailDetails) {
      gmailMessageDetailBySourceEvidenceId.set(detail.sourceEvidenceId, detail);
    }

    for (const detail of salesforceDetails) {
      salesforceCommunicationDetailBySourceEvidenceId.set(
        detail.sourceEvidenceId,
        detail,
      );
    }
  }

  const candidates: BackfillContentFingerprintCandidate[] = [];

  for (const event of parsedEvents) {
    const provider = event.provenance.primaryProvider;

    if (provider !== "gmail" && provider !== "salesforce") {
      continue;
    }

    const fingerprintSource = buildPersistedContentFingerprintSource({
      event,
      sourceEvidenceId: event.sourceEvidenceId,
      gmailMessageDetailBySourceEvidenceId,
      salesforceCommunicationDetailBySourceEvidenceId,
    });
    const newFingerprint =
      fingerprintSource === null
        ? null
        : computeContentFingerprint(fingerprintSource);

    candidates.push({
      id: event.id,
      contactId: event.contactId,
      provider,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      oldFingerprint: event.contentFingerprint ?? null,
      newFingerprint,
      category: categorizeFingerprintChange({
        oldFingerprint: event.contentFingerprint ?? null,
        newFingerprint,
      }),
    });
  }

  return candidates;
}

async function applyUpdates(input: {
  readonly db: Stage1Database;
  readonly candidates: readonly BackfillContentFingerprintCandidate[];
}): Promise<number> {
  let updatedCount = 0;

  for (const batch of chunkValues(input.candidates, updateBatchSize)) {
    await input.db.transaction(async (tx) => {
      for (const candidate of batch) {
        await tx
          .update(canonicalEventLedger)
          .set({
            contentFingerprint: candidate.newFingerprint,
            updatedAt: new Date(),
          })
          .where(eq(canonicalEventLedger.id, candidate.id));
      }
    });
    updatedCount += batch.length;
  }

  return updatedCount;
}

export async function backfillContentFingerprint(input: {
  readonly db: Stage1Database;
  readonly repositories: Stage1Repositories;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly eventTypes?: readonly CanonicalEventRecord["eventType"][];
  readonly logger?: Logger;
  readonly auditWriter?: AuditWriter;
}): Promise<BackfillContentFingerprintResult> {
  const startedAt = Date.now();
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;
  const auditWriter = input.auditWriter ?? {
    writeLine(line: string) {
      process.stdout.write(`${line}\n`);
    },
  };
  const eventTypes = parseBackfillEventTypes([
    ...(input.eventTypes ?? defaultEventTypes),
  ]);
  const candidates = await loadCandidates({
    db: input.db,
    repositories: input.repositories,
    eventTypes,
    limit: input.limit ?? null,
  });
  const categoryCounts: Record<BackfillCategory, number> = {
    unchanged: 0,
    new_value: 0,
    cleared: 0,
    still_null: 0,
  };
  const auditLines: BackfillContentFingerprintAuditLine[] = [];
  const updates = candidates.filter(
    (candidate) =>
      candidate.category === "new_value" || candidate.category === "cleared",
  );

  for (const candidate of candidates) {
    categoryCounts[candidate.category] += 1;

    if (candidate.category !== "new_value" && candidate.category !== "cleared") {
      continue;
    }

    const auditLine: BackfillContentFingerprintAuditLine = {
      id: candidate.id,
      contactId: candidate.contactId,
      provider: candidate.provider,
      oldFingerprint: candidate.oldFingerprint,
      newFingerprint: candidate.newFingerprint,
      occurredAt: candidate.occurredAt,
      eventType: candidate.eventType,
    };
    auditLines.push(auditLine);
    auditWriter.writeLine(JSON.stringify(auditLine));
  }

  const updatedCount = dryRun ? 0 : await applyUpdates({ db: input.db, candidates: updates });
  const runtimeMs = Date.now() - startedAt;
  const warningCount = categoryCounts.cleared;

  logger.error("backfill-content-fingerprint");
  logger.error(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  logger.error(`Event types: ${eventTypes.join(", ")}`);
  logger.error(`- scanned rows: ${String(candidates.length)}`);
  logger.error(`- unchanged: ${String(categoryCounts.unchanged)}`);
  logger.error(`- new_value: ${String(categoryCounts.new_value)}`);
  logger.error(`- cleared: ${String(categoryCounts.cleared)}`);
  logger.error(`- still_null: ${String(categoryCounts.still_null)}`);
  logger.error(`- updated: ${String(updatedCount)}`);
  logger.error(`- runtime_ms: ${String(runtimeMs)}`);

  if (warningCount > 0) {
    logger.error(
      `WARNING: ${String(warningCount)} rows would clear or cleared content_fingerprint. Investigate normalization regressions before trusting this run.`,
    );
  }

  return {
    dryRun,
    eventTypes,
    scannedCount: candidates.length,
    categoryCounts,
    updatedCount,
    runtimeMs,
    warningCount,
    auditLines,
  };
}

export async function runBackfillContentFingerprintCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<BackfillContentFingerprintResult> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const result = await backfillContentFingerprint({
      db: connection.db,
      repositories,
      dryRun: !readOptionalBooleanFlag(flags, "execute", false),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null,
      eventTypes: parseBackfillEventTypes(
        readOptionalStringArrayFlag(flags, "event-types") as CanonicalEventRecord["eventType"][],
      ),
    });

    if (!result.dryRun && result.categoryCounts.cleared > 0) {
      throw new Error(
        `backfill-content-fingerprint completed with ${String(result.categoryCounts.cleared)} cleared rows.`,
      );
    }

    return result;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runBackfillContentFingerprintCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "backfill-content-fingerprint failed.";

      console.error(message);
      process.exitCode = 1;
    },
  );
}
