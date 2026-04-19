#!/usr/bin/env tsx
/**
 * backfill-gmail-message-bodies
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:backfill-gmail-message-bodies
 *   pnpm --filter @as-comms/worker ops:backfill-gmail-message-bodies --dry-run
 *
 * Re-fetches suspicious Gmail message bodies through the existing live capture
 * service and upserts cleaned `gmail_message_details` rows. Historical `.mbox`
 * provider ids are reported and skipped because the capture service cannot
 * resolve `mbox:*` records.
 */
import { parseArgs } from "node:util";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { and, asc, gt, sql } from "drizzle-orm";

import {
  stage1JobVersion,
  type GmailMessageDetailRecord
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  gmailMessageDetails,
  type Stage1Database
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import {
  capturePortHttpConfigSchema,
  createGmailCapturePort,
  type GmailMessageRecord
} from "@as-comms/integrations";

import { buildOperationId } from "./helpers.js";

const DEFAULT_BATCH_SIZE = 200;

interface BackfillCandidateRow {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly gmailThreadId: string | null;
  readonly rfc822MessageId: string | null;
  readonly direction: "inbound" | "outbound";
  readonly subject: string | null;
  readonly snippetClean: string;
  readonly bodyTextPreview: string;
  readonly capturedMailbox: string | null;
  readonly projectInboxAlias: string | null;
}

export interface GmailMessageBodyBackfillResult {
  readonly dryRun: boolean;
  readonly batchSize: number;
  readonly batchesProcessed: number;
  readonly scannedCount: number;
  readonly eligibleCount: number;
  readonly skippedHistoricalCount: number;
  readonly missingCount: number;
  readonly unsupportedCount: number;
  readonly unchangedCount: number;
  readonly wouldUpdateCount: number;
  readonly updatedCount: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands."
    );
  }

  return connectionString;
}

function buildSuspiciousBodyPredicate() {
  return sql<boolean>`(
    ${gmailMessageDetails.bodyTextPreview} ~* ${"Content-Type:"}
    or ${gmailMessageDetails.bodyTextPreview} ~* ${"Content-Transfer-Encoding:"}
    or ${gmailMessageDetails.bodyTextPreview} ~ ${"--[0-9A-Za-z][0-9A-Za-z._:-]{8,}"}
    or ${gmailMessageDetails.bodyTextPreview} ~ ${"=[0-9A-F]{2}"}
  )`;
}

async function loadCandidateBatch(input: {
  readonly db: Stage1Database;
  readonly afterSourceEvidenceId: string | null;
  readonly batchSize: number;
}): Promise<readonly BackfillCandidateRow[]> {
  const rows = await input.db
    .select({
      sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
      providerRecordId: gmailMessageDetails.providerRecordId,
      gmailThreadId: gmailMessageDetails.gmailThreadId,
      rfc822MessageId: gmailMessageDetails.rfc822MessageId,
      direction: gmailMessageDetails.direction,
      subject: gmailMessageDetails.subject,
      snippetClean: gmailMessageDetails.snippetClean,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
      capturedMailbox: gmailMessageDetails.capturedMailbox,
      projectInboxAlias: gmailMessageDetails.projectInboxAlias
    })
    .from(gmailMessageDetails)
    .where(
      and(
        buildSuspiciousBodyPredicate(),
        input.afterSourceEvidenceId === null
          ? undefined
          : gt(gmailMessageDetails.sourceEvidenceId, input.afterSourceEvidenceId)
      )
    )
    .orderBy(asc(gmailMessageDetails.sourceEvidenceId))
    .limit(input.batchSize);

  return rows.map((row) => ({
    ...row,
    direction: row.direction === "inbound" ? "inbound" : "outbound"
  }));
}

function isLiveCaptureEligible(candidate: BackfillCandidateRow): boolean {
  return !candidate.providerRecordId.startsWith("mbox:");
}

function isGmailMessageRecord(
  record: { readonly recordType: string }
): record is GmailMessageRecord {
  return record.recordType === "message";
}

function mapLiveRecordToDetailRow(input: {
  readonly sourceEvidenceId: string;
  readonly record: GmailMessageRecord;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.record.recordId,
    gmailThreadId: input.record.threadId,
    rfc822MessageId: input.record.rfc822MessageId,
    direction: input.record.direction,
    subject: input.record.subject,
    snippetClean: input.record.snippetClean,
    bodyTextPreview: input.record.bodyTextPreview,
    capturedMailbox: input.record.capturedMailbox,
    projectInboxAlias: input.record.projectInboxAlias
  };
}

function hasDetailChanged(
  current: BackfillCandidateRow,
  next: GmailMessageDetailRecord
): boolean {
  return (
    current.providerRecordId !== next.providerRecordId ||
    current.gmailThreadId !== next.gmailThreadId ||
    current.rfc822MessageId !== next.rfc822MessageId ||
    current.direction !== next.direction ||
    current.subject !== next.subject ||
    current.snippetClean !== next.snippetClean ||
    current.bodyTextPreview !== next.bodyTextPreview ||
    current.capturedMailbox !== next.capturedMailbox ||
    current.projectInboxAlias !== next.projectInboxAlias
  );
}

function buildCapturePayload(
  recordIds: readonly string[],
  batchSize: number
) {
  return {
    version: stage1JobVersion,
    jobId: buildOperationId("stage1:gmail:body-backfill:job"),
    correlationId: buildOperationId("stage1:gmail:body-backfill:correlation"),
    traceId: null,
    batchId: buildOperationId("stage1:gmail:body-backfill:batch"),
    syncStateId: buildOperationId("stage1:gmail:body-backfill:sync-state"),
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
    maxRecords: batchSize
  };
}

export async function backfillGmailMessageBodies(input: {
  readonly db: Stage1Database;
  readonly repositories: Pick<Stage1RepositoryBundle, "gmailMessageDetails">;
  readonly capture: Pick<
    ReturnType<typeof createGmailCapturePort>,
    "captureLiveBatch"
  >;
  readonly dryRun?: boolean;
  readonly batchSize?: number;
}): Promise<GmailMessageBodyBackfillResult> {
  const dryRun = input.dryRun ?? false;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  let afterSourceEvidenceId: string | null = null;
  let batchesProcessed = 0;
  let scannedCount = 0;
  let eligibleCount = 0;
  let skippedHistoricalCount = 0;
  let missingCount = 0;
  let unsupportedCount = 0;
  let unchangedCount = 0;
  let wouldUpdateCount = 0;
  let updatedCount = 0;

  for (;;) {
    const candidates = await loadCandidateBatch({
      db: input.db,
      afterSourceEvidenceId,
      batchSize
    });

    if (candidates.length === 0) {
      break;
    }

    batchesProcessed += 1;
    scannedCount += candidates.length;
    afterSourceEvidenceId = candidates.at(-1)?.sourceEvidenceId ?? afterSourceEvidenceId;

    const eligibleCandidates = candidates.filter(isLiveCaptureEligible);
    skippedHistoricalCount += candidates.length - eligibleCandidates.length;
    eligibleCount += eligibleCandidates.length;

    if (eligibleCandidates.length === 0) {
      continue;
    }

    const fetchedBatch = await input.capture.captureLiveBatch(
      buildCapturePayload(
        Array.from(
          new Set(eligibleCandidates.map((candidate) => candidate.providerRecordId))
        ),
        batchSize
      )
    );
    const fetchedRecordsById = new Map<string, GmailMessageRecord>();

    for (const record of fetchedBatch.records) {
      if (!isGmailMessageRecord(record)) {
        unsupportedCount += 1;
        continue;
      }

      fetchedRecordsById.set(record.recordId, record);
    }

    for (const candidate of eligibleCandidates) {
      const fetchedRecord = fetchedRecordsById.get(candidate.providerRecordId);

      if (fetchedRecord === undefined) {
        missingCount += 1;
        continue;
      }

      const nextDetail = mapLiveRecordToDetailRow({
        sourceEvidenceId: candidate.sourceEvidenceId,
        record: fetchedRecord
      });

      if (!hasDetailChanged(candidate, nextDetail)) {
        unchangedCount += 1;
        continue;
      }

      wouldUpdateCount += 1;

      if (dryRun) {
        continue;
      }

      await input.repositories.gmailMessageDetails.upsert(nextDetail);
      updatedCount += 1;
    }
  }

  return {
    dryRun,
    batchSize,
    batchesProcessed,
    scannedCount,
    eligibleCount,
    skippedHistoricalCount,
    missingCount,
    unsupportedCount,
    unchangedCount,
    wouldUpdateCount,
    updatedCount
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": {
        type: "boolean",
        default: false
      }
    }
  });
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const captureConfig = capturePortHttpConfigSchema.parse({
      baseUrl: process.env.GMAIL_CAPTURE_BASE_URL,
      bearerToken: process.env.GMAIL_CAPTURE_TOKEN
    });
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const capture = createGmailCapturePort(captureConfig);
    const result = await backfillGmailMessageBodies({
      db: connection.db,
      repositories,
      capture,
      dryRun: values["dry-run"]
    });

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (process.argv[1] !== undefined) {
  const entrypointUrl = pathToFileURL(process.argv[1]).href;

  if (entrypointUrl === import.meta.url) {
    void main().catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Gmail message body backfill failed."
      );
      process.exitCode = 1;
    });
  }
}
