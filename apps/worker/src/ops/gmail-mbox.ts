import { z } from "zod";

import { mapGmailRecord, importGmailMboxRecords } from "@as-comms/integrations";
import type { Stage1PersistenceService } from "@as-comms/domain";
import type { SyncStateRecord } from "@as-comms/contracts";

import type { Stage1IngestService } from "../ingest/index.js";
import type { Stage1IngestResult } from "../ingest/types.js";
import { recordProjectionSeedOnce } from "../orchestration/projection-seed.js";
import type { Stage1SyncStateService } from "../orchestration/sync-state.js";

const emailSchema = z.string().email();

const gmailMboxImportInputSchema = z.object({
  mboxText: z.string().min(1),
  mboxPath: z.string().min(1),
  capturedMailbox: emailSchema,
  liveAccount: emailSchema,
  projectInboxAliases: z.array(emailSchema).default([]),
  projectInboxAliasOverride: emailSchema.nullable().default(null),
  syncStateId: z.string().min(1),
  correlationId: z.string().min(1),
  traceId: z.string().min(1).nullable().default(null),
  receivedAt: z.string().datetime().nullable().default(null),
  limit: z.number().int().positive().nullable().default(null)
});

export type GmailMboxImportInput = z.input<typeof gmailMboxImportInputSchema>;

export interface Stage1GmailMboxImportResult {
  readonly outcome: "succeeded" | "failed";
  readonly mboxPath: string;
  readonly capturedMailbox: string;
  readonly projectInboxAlias: string | null;
  readonly parsedRecords: number;
  readonly syncStateId: string;
  readonly correlationId: string;
  readonly summary: {
    readonly processed: number;
    readonly normalized: number;
    readonly duplicate: number;
    readonly reviewOpened: number;
    readonly quarantined: number;
    readonly deferred: number;
    readonly deadLetterCountIncrement: number;
  };
  readonly checkpoint: string | null;
  readonly syncStatus: SyncStateRecord["status"];
  readonly message?: string;
}

interface Stage1GmailMboxImportDependencies {
  readonly ingest: Pick<Stage1IngestService, "ingestGmailHistoricalRecord">;
  readonly persistence: Stage1PersistenceService;
  readonly syncState: Stage1SyncStateService;
  readonly now?: () => Date;
}

function summarizeIngestResults(results: readonly Stage1IngestResult[]) {
  return {
    processed: results.length,
    normalized: results.filter((result) => result.outcome === "normalized").length,
    duplicate: results.filter((result) => result.outcome === "duplicate").length,
    reviewOpened: results.filter((result) => result.outcome === "review_opened")
      .length,
    quarantined: results.filter((result) => result.outcome === "quarantined")
      .length,
    deferred: results.filter((result) => result.outcome === "deferred").length,
    deadLetterCountIncrement: results.filter(
      (result) => result.outcome === "quarantined"
    ).length
  };
}

function isOccurredAtRecord(
  record: unknown
): record is { readonly recordType: string; readonly occurredAt: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "recordType" in record &&
    "occurredAt" in record &&
    typeof record.recordType === "string" &&
    typeof record.occurredAt === "string"
  );
}

function calculateHistoricalWindow(
  records: readonly unknown[]
): {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly checkpoint: string | null;
} {
  const occurredAtValues = records
    .filter(isOccurredAtRecord)
    .map((record) => record.occurredAt)
    .sort((left, right) => left.localeCompare(right));
  const windowStart = occurredAtValues[0] ?? null;
  const checkpoint = occurredAtValues.at(-1) ?? null;

  return {
    windowStart,
    windowEnd: checkpoint,
    checkpoint
  };
}

function resolveProjectInboxAlias(records: readonly unknown[]): string | null {
  for (const record of records) {
    if (
      typeof record === "object" &&
      record !== null &&
      "recordType" in record &&
      record.recordType === "message" &&
      "projectInboxAlias" in record &&
      (typeof record.projectInboxAlias === "string" || record.projectInboxAlias === null)
    ) {
      return record.projectInboxAlias;
    }
  }

  return null;
}

export function createStage1GmailMboxImportService(
  dependencies: Stage1GmailMboxImportDependencies
) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async importMbox(input: GmailMboxImportInput): Promise<Stage1GmailMboxImportResult> {
      const parsedInput = gmailMboxImportInputSchema.parse(input);
      const receivedAt = parsedInput.receivedAt ?? now().toISOString();
      const records = importGmailMboxRecords({
        mboxText: parsedInput.mboxText,
        mboxPath: parsedInput.mboxPath,
        capturedMailbox: parsedInput.capturedMailbox,
        liveAccount: parsedInput.liveAccount,
        projectInboxAliases: parsedInput.projectInboxAliases,
        projectInboxAliasOverride: parsedInput.projectInboxAliasOverride,
        receivedAt,
        limit: parsedInput.limit
      });
      const historicalWindow = calculateHistoricalWindow(records);
      const resolvedProjectInboxAlias = resolveProjectInboxAlias(records);

      await dependencies.syncState.startWindow({
        syncStateId: parsedInput.syncStateId,
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: historicalWindow.checkpoint,
        windowStart: historicalWindow.windowStart,
        windowEnd: historicalWindow.windowEnd
      });

      try {
        const ingestResults: Stage1IngestResult[] = [];

        for (const record of records) {
          const ingestResult =
            await dependencies.ingest.ingestGmailHistoricalRecord(record);
          ingestResults.push(ingestResult);

          if (
            ingestResult.outcome === "deferred" ||
            ingestResult.outcome === "quarantined" ||
            ingestResult.canonicalEventId === null
          ) {
            continue;
          }

          const mapped = mapGmailRecord(record);

          if (mapped.outcome === "command" && mapped.command.kind === "canonical_event") {
            await recordProjectionSeedOnce(dependencies.persistence, {
              canonicalEventId: mapped.command.input.canonicalEvent.id,
              summary: mapped.command.input.canonicalEvent.summary,
              snippet: mapped.command.input.canonicalEvent.snippet,
              occurredAt: mapped.command.input.sourceEvidence.receivedAt
            });
          }
        }

        const summary = summarizeIngestResults(ingestResults);
        await dependencies.syncState.recordBatchProgress({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "gmail",
          jobType: "historical_backfill",
          cursor: historicalWindow.checkpoint,
          checkpoint: historicalWindow.checkpoint,
          windowStart: historicalWindow.windowStart,
          windowEnd: historicalWindow.windowEnd,
          deadLetterCountIncrement: summary.deadLetterCountIncrement
        });
        const completedSyncState = await dependencies.syncState.completeWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "gmail",
          jobType: "historical_backfill",
          cursor: historicalWindow.checkpoint,
          checkpoint: historicalWindow.checkpoint,
          windowStart: historicalWindow.windowStart,
          windowEnd: historicalWindow.windowEnd,
          parityPercent: null,
          freshnessP95Seconds: null,
          freshnessP99Seconds: null,
          completedAt: now().toISOString()
        });

        return {
          outcome: "succeeded",
          mboxPath: parsedInput.mboxPath,
          capturedMailbox: parsedInput.capturedMailbox,
          projectInboxAlias: resolvedProjectInboxAlias,
          parsedRecords: records.length,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary,
          checkpoint: historicalWindow.checkpoint,
          syncStatus: completedSyncState.status
        };
      } catch (error) {
        const failedSyncState = await dependencies.syncState.failWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "gmail",
          jobType: "historical_backfill",
          cursor: historicalWindow.checkpoint,
          checkpoint: historicalWindow.checkpoint,
          windowStart: historicalWindow.windowStart,
          windowEnd: historicalWindow.windowEnd,
          deadLetterCountIncrement: 0,
          deadLettered: false
        });

        return {
          outcome: "failed",
          mboxPath: parsedInput.mboxPath,
          capturedMailbox: parsedInput.capturedMailbox,
          projectInboxAlias: resolvedProjectInboxAlias,
          parsedRecords: records.length,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary: {
            processed: 0,
            normalized: 0,
            duplicate: 0,
            reviewOpened: 0,
            quarantined: 0,
            deferred: 0,
            deadLetterCountIncrement: 0
          },
          checkpoint: historicalWindow.checkpoint,
          syncStatus: failedSyncState.status,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
