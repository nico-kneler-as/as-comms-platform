#!/usr/bin/env tsx
/**
 * cleanup-gmail-draft-events
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:cleanup-gmail-draft-events
 *   pnpm --filter @as-comms/worker ops:cleanup-gmail-draft-events --limit 100
 *   pnpm --filter @as-comms/worker ops:cleanup-gmail-draft-events --execute --limit 100
 *
 * Dry-run by default. Re-checks outbound Gmail canonical events against Gmail
 * message labels and emits a JSONL audit trail to stdout for draft-only rows.
 *
 * Execute mode deletes the draft-backed canonical/source rows and rebuilds
 * projections for affected contacts. This intentionally rebuilds projections
 * instead of trying to null or repoint every FK in place because
 * `contact_timeline_projection.canonical_event_id` is a non-null 1:1 reference
 * and `contact_inbox_projection` also carries denormalized recency/snippet
 * fields that must stay consistent with canonical truth.
 */
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import { projectionRebuildBatchPayloadSchema, stage1JobVersion } from "@as-comms/contracts";
import {
  canonicalEventLedger,
  closeDatabaseConnection,
  contactInboxProjection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  gmailMessageDetails,
  identityResolutionQueue,
  routingReviewQueue,
  sourceEvidenceLog,
  contactTimelineProjection,
  type DatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
} from "@as-comms/domain";
import {
  createGmailMailboxApiClient,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
} from "@as-comms/integrations";

import { createStage1IngestService } from "../ingest/index.js";
import {
  createStage1WorkerOrchestrationService,
  type Stage1WorkerOrchestrationService,
} from "../orchestration/index.js";
import { readStage1LaunchScopeGmailConfig } from "./config.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";

const labelLookupChunkSize = 25;
const executeDeleteChunkSize = 500;
const projectionRebuildChunkSize = 250;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface AuditWriter {
  writeLine(line: string): void;
}

interface GmailDraftCleanupSeedRow {
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly providerRecordId: string;
  readonly gmailThreadId: string | null;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly persistedLabelIds: readonly string[] | null;
}

export interface GmailDraftCleanupAuditLine {
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly gmailThreadId: string | null;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly labels: readonly string[];
  readonly labelSource: "gmail_api" | "stored_detail";
}

export interface GmailDraftCleanupSummary {
  readonly scannedCount: number;
  readonly draftCandidateCount: number;
  readonly apiConfirmedCount: number;
  readonly storedFallbackCount: number;
  readonly apiGoneCount: number;
  readonly unknownCount: number;
  readonly affectedContactCount: number;
  readonly inboxProjectionContactCount: number;
  readonly timelineProjectionDeleteCount: number;
  readonly topContacts: readonly {
    readonly contactId: string;
    readonly draftCount: number;
  }[];
}

export interface GmailDraftCleanupResult extends GmailDraftCleanupSummary {
  readonly dryRun: boolean;
  readonly deletedCanonicalCount: number;
  readonly deletedGmailDetailCount: number;
  readonly deletedSourceEvidenceCount: number;
  readonly deletedInboxProjectionCount: number;
  readonly deletedTimelineProjectionCount: number;
  readonly deletedIdentityReviewCount: number;
  readonly deletedRoutingReviewCount: number;
  readonly rebuiltContactCount: number;
  readonly missingProjectionSeeds: readonly string[];
  readonly auditLines: readonly GmailDraftCleanupAuditLine[];
}

interface DeleteCounts {
  readonly deletedCanonicalCount: number;
  readonly deletedGmailDetailCount: number;
  readonly deletedSourceEvidenceCount: number;
  readonly deletedInboxProjectionCount: number;
  readonly deletedTimelineProjectionCount: number;
  readonly deletedIdentityReviewCount: number;
  readonly deletedRoutingReviewCount: number;
}

export type GmailLabelLookupResult =
  | { readonly status: "found"; readonly labels: readonly string[] }
  | { readonly status: "not_found" }
  | { readonly status: "unknown" };

type GmailLabelLookup = (input: {
  readonly mailbox: string;
  readonly providerRecordId: string;
}) => Promise<GmailLabelLookupResult>;

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString;
}

function readRequiredStringEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required for Gmail draft cleanup.`);
  }

  return value.trim();
}

function buildGmailApiClientFromEnv(
  env: NodeJS.ProcessEnv,
): {
  readonly mailbox: string;
  readonly client: GmailMailboxApiClient;
} {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "ops-cleanup-gmail-drafts",
    liveAccount: gmailConfig.liveAccount,
    projectInboxAliases: [...gmailConfig.projectInboxAliases],
    oauthClientId: readRequiredStringEnv(env, "GMAIL_GOOGLE_OAUTH_CLIENT_ID"),
    oauthClientSecret: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_CLIENT_SECRET",
    ),
    oauthRefreshToken: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN",
    ),
    tokenUri:
      env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
    timeoutMs:
      env.GMAIL_CAPTURE_TIMEOUT_MS === undefined
        ? 15_000
        : Number.parseInt(env.GMAIL_CAPTURE_TIMEOUT_MS, 10),
  };

  return {
    mailbox: gmailConfig.liveAccount,
    client: createGmailMailboxApiClient(clientConfig),
  };
}

function buildUnexpectedCapturePorts() {
  const unexpectedUse = (): Promise<never> => {
    return Promise.reject(
      new Error(
        "This ops runtime only supports projection rebuilds after Gmail draft cleanup.",
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

function normalizeLabelIds(
  labelIds: readonly string[] | null | undefined,
): readonly string[] | null {
  if (labelIds === null || labelIds === undefined) {
    return null;
  }

  const normalized = Array.from(
    new Set(
      labelIds
        .map((labelId) => labelId.trim())
        .filter((labelId) => labelId.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return normalized;
}

function isDraftOnlyLabelSet(labelIds: readonly string[]): boolean {
  return labelIds.includes("DRAFT") && !labelIds.includes("SENT");
}

async function loadCleanupSeedRows(input: {
  readonly db: Stage1Database;
}): Promise<readonly GmailDraftCleanupSeedRow[]> {
  const labelIdsColumnResult: unknown = await input.db.execute(sql<{
    readonly exists: boolean;
  }>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gmail_message_details'
        and column_name = 'label_ids'
    ) as "exists"
  `);
  const labelIdsColumnRows = Array.isArray(labelIdsColumnResult)
    ? (labelIdsColumnResult as readonly { readonly exists: boolean }[])
    : ((labelIdsColumnResult as { readonly rows: readonly { readonly exists: boolean }[] }).rows);
  const hasPersistedLabelIds = labelIdsColumnRows[0]?.exists === true;
  const persistedLabelIdsSelection = hasPersistedLabelIds
    ? gmailMessageDetails.labelIds
    : sql<readonly string[] | null>`null`;

  const rows = await input.db
    .select({
      sourceEvidenceId: canonicalEventLedger.sourceEvidenceId,
      canonicalEventId: canonicalEventLedger.id,
      contactId: canonicalEventLedger.contactId,
      providerRecordId: sourceEvidenceLog.providerRecordId,
      gmailThreadId: gmailMessageDetails.gmailThreadId,
      subject: gmailMessageDetails.subject,
      occurredAt: canonicalEventLedger.occurredAt,
      persistedLabelIds: persistedLabelIdsSelection,
    })
    .from(canonicalEventLedger)
    .innerJoin(
      sourceEvidenceLog,
      eq(sourceEvidenceLog.id, canonicalEventLedger.sourceEvidenceId),
    )
    .leftJoin(
      gmailMessageDetails,
      eq(gmailMessageDetails.sourceEvidenceId, canonicalEventLedger.sourceEvidenceId),
    )
    .where(
      and(
        eq(canonicalEventLedger.eventType, "communication.email.outbound"),
        eq(sourceEvidenceLog.provider, "gmail"),
        eq(sourceEvidenceLog.providerRecordType, "message"),
        sql<boolean>`${canonicalEventLedger.provenance} ->> 'primaryProvider' = 'gmail'`,
      ),
    )
    .orderBy(asc(canonicalEventLedger.occurredAt), asc(canonicalEventLedger.id));

  return rows.map((row) => ({
    sourceEvidenceId: row.sourceEvidenceId,
    canonicalEventId: row.canonicalEventId,
    contactId: row.contactId,
    providerRecordId: row.providerRecordId,
    gmailThreadId: row.gmailThreadId,
    subject: row.subject,
    occurredAt:
      row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
    persistedLabelIds: normalizeLabelIds(row.persistedLabelIds),
  }));
}

async function classifyDraftCandidates(input: {
  readonly rows: readonly GmailDraftCleanupSeedRow[];
  readonly mailbox: string;
  readonly labelLookup: GmailLabelLookup;
  readonly limit?: number | null;
}): Promise<{
  readonly auditLines: readonly GmailDraftCleanupAuditLine[];
  readonly summary: GmailDraftCleanupSummary;
}> {
  const auditLines: GmailDraftCleanupAuditLine[] = [];
  let apiConfirmedCount = 0;
  let storedFallbackCount = 0;
  let apiGoneCount = 0;
  let unknownCount = 0;
  const threadsWithLiveSent = new Set<string>();

  type ResolvedRow =
    | {
        readonly row: GmailDraftCleanupSeedRow;
        readonly kind: "labels";
        readonly labels: readonly string[];
        readonly labelSource: "gmail_api" | "stored_detail";
      }
    | {
        readonly row: GmailDraftCleanupSeedRow;
        readonly kind: "not_found";
      }
    | {
        readonly row: GmailDraftCleanupSeedRow;
        readonly kind: "unknown";
      };

  const resolved: ResolvedRow[] = [];

  for (const chunk of chunkValues(input.rows, labelLookupChunkSize)) {
    const resolvedChunk = await Promise.all(
      chunk.map(async (row): Promise<ResolvedRow> => {
        const apiResult = await input.labelLookup({
          mailbox: input.mailbox,
          providerRecordId: row.providerRecordId,
        });

        if (apiResult.status === "found") {
          const labels = normalizeLabelIds(apiResult.labels);
          if (labels !== null) {
            return { row, kind: "labels", labels, labelSource: "gmail_api" };
          }
        }

        if (apiResult.status === "not_found") {
          return { row, kind: "not_found" };
        }

        if (row.persistedLabelIds !== null) {
          return {
            row,
            kind: "labels",
            labels: row.persistedLabelIds,
            labelSource: "stored_detail",
          };
        }

        return { row, kind: "unknown" };
      }),
    );

    for (const item of resolvedChunk) {
      if (
        item.kind === "labels" &&
        item.labels.includes("SENT") &&
        !item.labels.includes("DRAFT") &&
        item.row.gmailThreadId !== null
      ) {
        threadsWithLiveSent.add(item.row.gmailThreadId);
      }
    }

    resolved.push(...resolvedChunk);
  }

  for (const item of resolved) {
    if (item.kind === "unknown") {
      unknownCount += 1;
      continue;
    }

    if (item.kind === "labels") {
      if (!isDraftOnlyLabelSet(item.labels)) {
        continue;
      }

      if (item.labelSource === "gmail_api") {
        apiConfirmedCount += 1;
      } else {
        storedFallbackCount += 1;
      }

      auditLines.push({
        sourceEvidenceId: item.row.sourceEvidenceId,
        canonicalEventId: item.row.canonicalEventId,
        contactId: item.row.contactId,
        gmailThreadId: item.row.gmailThreadId,
        subject: item.row.subject,
        occurredAt: item.row.occurredAt,
        labels: item.labels,
        labelSource: item.labelSource,
      });
      continue;
    }

    // item.kind === "not_found"
    // Option B: only treat 404'd rows as drafts if the same thread
    // has at least one live SENT message. Isolated 404s stay as
    // "unknown/keep" so we never delete a legitimately-deleted email
    // that was the only member of its thread.
    if (
      item.row.gmailThreadId !== null &&
      threadsWithLiveSent.has(item.row.gmailThreadId)
    ) {
      apiGoneCount += 1;
      auditLines.push({
        sourceEvidenceId: item.row.sourceEvidenceId,
        canonicalEventId: item.row.canonicalEventId,
        contactId: item.row.contactId,
        gmailThreadId: item.row.gmailThreadId,
        subject: item.row.subject,
        occurredAt: item.row.occurredAt,
        labels: ["__GMAIL_404__"],
        labelSource: "gmail_api",
      });
      continue;
    }

    unknownCount += 1;
  }

  const limitedAuditLines =
    input.limit === null || input.limit === undefined
      ? auditLines
      : auditLines.slice(0, input.limit);
  const affectedContactIds = uniqueSortedStrings(
    limitedAuditLines.map((line) => line.contactId),
  );
  const topContacts = Array.from(
    limitedAuditLines.reduce((counts, line) => {
      counts.set(line.contactId, (counts.get(line.contactId) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  )
    .map(([contactId, draftCount]) => ({
      contactId,
      draftCount,
    }))
    .sort((left, right) => {
      if (left.draftCount !== right.draftCount) {
        return right.draftCount - left.draftCount;
      }

      return left.contactId.localeCompare(right.contactId);
    })
    .slice(0, 20);

  return {
    auditLines: limitedAuditLines,
    summary: {
      scannedCount: input.rows.length,
      draftCandidateCount: limitedAuditLines.length,
      apiConfirmedCount,
      storedFallbackCount,
      apiGoneCount,
      unknownCount,
      affectedContactCount: affectedContactIds.length,
      inboxProjectionContactCount: affectedContactIds.length,
      timelineProjectionDeleteCount: limitedAuditLines.length,
      topContacts,
    },
  };
}

async function deleteDraftCandidates(input: {
  readonly db: Stage1Database;
  readonly auditLines: readonly GmailDraftCleanupAuditLine[];
}): Promise<DeleteCounts> {
  const deletedContactIds = new Set<string>();
  let deletedCanonicalCount = 0;
  let deletedGmailDetailCount = 0;
  let deletedSourceEvidenceCount = 0;
  let deletedInboxProjectionCount = 0;
  let deletedTimelineProjectionCount = 0;
  let deletedIdentityReviewCount = 0;
  let deletedRoutingReviewCount = 0;

  for (const chunk of chunkValues(input.auditLines, executeDeleteChunkSize)) {
    const contactIds = uniqueSortedStrings(chunk.map((line) => line.contactId));
    const canonicalEventIds = chunk.map((line) => line.canonicalEventId);
    const sourceEvidenceIds = chunk.map((line) => line.sourceEvidenceId);

    await input.db.transaction(async (tx) => {
      const inboxRows = await tx
        .delete(contactInboxProjection)
        .where(inArray(contactInboxProjection.contactId, contactIds))
        .returning({
          contactId: contactInboxProjection.contactId,
        });
      deletedInboxProjectionCount += inboxRows.length;
      for (const row of inboxRows) {
        deletedContactIds.add(row.contactId);
      }

      const timelineRows = await tx
        .delete(contactTimelineProjection)
        .where(inArray(contactTimelineProjection.canonicalEventId, canonicalEventIds))
        .returning({
          id: contactTimelineProjection.id,
        });
      deletedTimelineProjectionCount += timelineRows.length;

      const identityRows = await tx
        .delete(identityResolutionQueue)
        .where(inArray(identityResolutionQueue.sourceEvidenceId, sourceEvidenceIds))
        .returning({
          id: identityResolutionQueue.id,
        });
      deletedIdentityReviewCount += identityRows.length;

      const routingRows = await tx
        .delete(routingReviewQueue)
        .where(inArray(routingReviewQueue.sourceEvidenceId, sourceEvidenceIds))
        .returning({
          id: routingReviewQueue.id,
        });
      deletedRoutingReviewCount += routingRows.length;

      const canonicalRows = await tx
        .delete(canonicalEventLedger)
        .where(inArray(canonicalEventLedger.id, canonicalEventIds))
        .returning({
          id: canonicalEventLedger.id,
        });
      deletedCanonicalCount += canonicalRows.length;

      const gmailDetailRows = await tx
        .delete(gmailMessageDetails)
        .where(inArray(gmailMessageDetails.sourceEvidenceId, sourceEvidenceIds))
        .returning({
          sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
        });
      deletedGmailDetailCount += gmailDetailRows.length;

      const sourceEvidenceRows = await tx
        .delete(sourceEvidenceLog)
        .where(inArray(sourceEvidenceLog.id, sourceEvidenceIds))
        .returning({
          id: sourceEvidenceLog.id,
        });
      deletedSourceEvidenceCount += sourceEvidenceRows.length;
    });
  }

  return {
    deletedCanonicalCount,
    deletedGmailDetailCount,
    deletedSourceEvidenceCount,
    deletedInboxProjectionCount,
    deletedTimelineProjectionCount,
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
    projectionRebuildChunkSize,
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
    missingProjectionSeeds: Array.from(missingProjectionSeeds).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function createStdoutAuditWriter(): AuditWriter {
  return {
    writeLine(line) {
      process.stdout.write(`${line}\n`);
    },
  };
}

function createGmailApiLabelLookup(client: GmailMailboxApiClient): GmailLabelLookup {
  return async (input) => {
    if (input.providerRecordId.startsWith("mbox:")) {
      return { status: "unknown" };
    }

    try {
      const message = await client.getMessage({
        mailbox: input.mailbox,
        messageId: input.providerRecordId,
      });

      if (message === null) {
        return { status: "not_found" };
      }

      return { status: "found", labels: message.labelIds };
    } catch {
      return { status: "unknown" };
    }
  };
}

export async function cleanupGmailDraftEvents(input: {
  readonly db: Stage1Database;
  readonly mailbox: string;
  readonly labelLookup: GmailLabelLookup;
  readonly execute?: boolean;
  readonly orchestration?: Pick<
    Stage1WorkerOrchestrationService,
    "runProjectionRebuildBatch"
  >;
  readonly limit?: number | null;
  readonly writer?: AuditWriter;
  readonly logger?: Logger;
}): Promise<GmailDraftCleanupResult> {
  const logger = input.logger ?? console;
  const writer = input.writer ?? createStdoutAuditWriter();
  const rows = await loadCleanupSeedRows({
    db: input.db,
  });
  const classified = await classifyDraftCandidates({
    rows,
    mailbox: input.mailbox,
    labelLookup: input.labelLookup,
    limit: input.limit ?? null,
  });

  for (const line of classified.auditLines) {
    writer.writeLine(JSON.stringify(line));
  }

  if (input.execute !== true) {
    return {
      dryRun: true,
      ...classified.summary,
      deletedCanonicalCount: 0,
      deletedGmailDetailCount: 0,
      deletedSourceEvidenceCount: 0,
      deletedInboxProjectionCount: 0,
      deletedTimelineProjectionCount: 0,
      deletedIdentityReviewCount: 0,
      deletedRoutingReviewCount: 0,
      rebuiltContactCount: 0,
      missingProjectionSeeds: [],
      auditLines: classified.auditLines,
    };
  }

  if (input.orchestration === undefined) {
    throw new Error("Projection rebuild orchestration is required for execute mode.");
  }

  const deleteCounts = await deleteDraftCandidates({
    db: input.db,
    auditLines: classified.auditLines,
  });
  const rebuildResult = await rebuildProjectionsForContacts(
    input.orchestration,
    classified.auditLines.map((line) => line.contactId),
    logger,
  );

  return {
    dryRun: false,
    ...classified.summary,
    ...deleteCounts,
    rebuiltContactCount: rebuildResult.rebuiltContactCount,
    missingProjectionSeeds: rebuildResult.missingProjectionSeeds,
    auditLines: classified.auditLines,
  };
}

function printSummary(result: GmailDraftCleanupResult): void {
  console.error("cleanup-gmail-draft-events");
  console.error(`Mode: ${result.dryRun ? "dry-run" : "execute"}`);
  console.error(`- scanned outbound Gmail canonical rows: ${String(result.scannedCount)}`);
  console.error(`- draft-only candidates: ${String(result.draftCandidateCount)}`);
  console.error(`- Gmail API confirmed DRAFT: ${String(result.apiConfirmedCount)}`);
  console.error(`- stored-label fallback DRAFT: ${String(result.storedFallbackCount)}`);
  console.error(`- Gmail 404'd in SENT thread: ${String(result.apiGoneCount)}`);
  console.error(`- unknown/kept rows: ${String(result.unknownCount)}`);
  console.error(`- affected contacts: ${String(result.affectedContactCount)}`);
  console.error(
    `- inbox projections to rebuild: ${String(result.inboxProjectionContactCount)}`,
  );
  console.error(
    `- timeline projection rows to delete: ${String(result.timelineProjectionDeleteCount)}`,
  );

  if (result.topContacts.length > 0) {
    console.error("- top contacts by draft count:");
    for (const entry of result.topContacts) {
      console.error(
        `  ${entry.contactId}: ${String(entry.draftCount)}`,
      );
    }
  }

  if (!result.dryRun) {
    console.error(`- deleted canonical rows: ${String(result.deletedCanonicalCount)}`);
    console.error(`- deleted Gmail detail rows: ${String(result.deletedGmailDetailCount)}`);
    console.error(
      `- deleted source evidence rows: ${String(result.deletedSourceEvidenceCount)}`,
    );
    console.error(
      `- deleted inbox projection rows: ${String(result.deletedInboxProjectionCount)}`,
    );
    console.error(
      `- deleted timeline projection rows: ${String(result.deletedTimelineProjectionCount)}`,
    );
    console.error(
      `- deleted identity review rows: ${String(result.deletedIdentityReviewCount)}`,
    );
    console.error(
      `- deleted routing review rows: ${String(result.deletedRoutingReviewCount)}`,
    );
    console.error(`- rebuilt contacts: ${String(result.rebuiltContactCount)}`);
  }
}

export async function runCleanupGmailDraftEventsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 0) || null;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const { mailbox, client } = buildGmailApiClientFromEnv(env);
    const orchestration = execute
      ? createProjectionRebuildOrchestration(connection)
      : undefined;
    const result = await cleanupGmailDraftEvents({
      db: connection.db,
      mailbox,
      labelLookup: createGmailApiLabelLookup(client),
      execute,
      limit,
      ...(orchestration === undefined ? {} : { orchestration }),
    });

    printSummary(result);
  } finally {
    await closeDatabaseConnection(connection);
  }
}

function wasInvokedAsCli(): boolean {
  const invokedPath = process.argv[1];
  if (invokedPath === undefined) {
    return false;
  }

  try {
    const moduleRealPath = realpathSync(fileURLToPath(import.meta.url));
    const invokedRealPath = realpathSync(invokedPath);
    return moduleRealPath === invokedRealPath;
  } catch {
    return false;
  }
}

if (wasInvokedAsCli()) {
  runCleanupGmailDraftEventsCommand(
    process.argv.slice(2),
    process.env,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
