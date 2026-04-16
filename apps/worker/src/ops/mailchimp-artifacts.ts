import { access, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { ZodError, z } from "zod";

import {
  importMailchimpCampaignArtifactRecordsFromPath,
  mapMailchimpRecord,
  type MailchimpCampaignActivityRecord
} from "@as-comms/integrations";
import type { Stage1PersistenceService } from "@as-comms/domain";
import type { SyncStateRecord } from "@as-comms/contracts";

import type { Stage1IngestService } from "../ingest/index.js";
import type { Stage1IngestResult } from "../ingest/types.js";
import {
  buildMailchimpUnmatchedReport,
  writeMailchimpUnmatchedReport
} from "./mailchimp-unmatched.js";
import {
  Stage1NonRetryableJobError,
  Stage1RetryableJobError,
  type Stage1JobFailure
} from "../orchestration/index.js";
import { recordProjectionSeedOnce } from "../orchestration/projection-seed.js";
import { recordSyncFailureAudit } from "../orchestration/sync-failure-audit.js";
import type { Stage1SyncStateService } from "../orchestration/sync-state.js";

const mailchimpArtifactImportInputSchema = z.object({
  artifactPath: z.string().min(1),
  syncStateId: z.string().min(1),
  correlationId: z.string().min(1),
  traceId: z.string().min(1).nullable().default(null),
  receivedAt: z.string().datetime().nullable().default(null),
  limitCampaigns: z.number().int().positive().nullable().default(null),
  startAtCampaignId: z.string().min(1).nullable().default(null),
  unmatchedReportOutputRoot: z.string().min(1).nullable().default(null)
});

export type MailchimpArtifactImportInput = z.input<
  typeof mailchimpArtifactImportInputSchema
>;

export interface Stage1MailchimpArtifactImportResult {
  readonly outcome: "succeeded" | "failed";
  readonly artifactPath: string;
  readonly importedCampaignIds: readonly string[];
  readonly parsedCampaigns: number;
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
    readonly skippedUnmatched: number;
    readonly skippedUnmatchedRecipients: number;
  };
  readonly checkpoint: string | null;
  readonly syncStatus: SyncStateRecord["status"];
  readonly message?: string;
  readonly unmatchedReportJsonPath?: string;
  readonly unmatchedReportCsvPath?: string;
}

interface MailchimpKnownIdentityIndex {
  readonly knownEmails: ReadonlySet<string>;
  readonly knownVolunteerIds: ReadonlySet<string>;
}

interface MailchimpUnmatchedRecipientRow {
  readonly campaignId: string;
  readonly campaignName: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly email: string | null;
  readonly platformId: string | null;
  readonly activityTypes: readonly string[];
}

type ImportedMailchimpCampaignActivityRecord = MailchimpCampaignActivityRecord & {
  readonly campaignName: string | null;
};

interface Stage1MailchimpArtifactImportDependencies {
  readonly ingest: Pick<Stage1IngestService, "ingestMailchimpHistoricalRecord">;
  readonly persistence: Stage1PersistenceService;
  readonly syncState: Stage1SyncStateService;
  readonly mailchimpIdentityIndex?: MailchimpKnownIdentityIndex;
  readonly now?: () => Date;
}

const MAILCHIMP_RECORD_PROGRESS_INTERVAL = 25;
const emptyMailchimpKnownIdentityIndex: MailchimpKnownIdentityIndex = {
  knownEmails: new Set<string>(),
  knownVolunteerIds: new Set<string>()
};
const importMailchimpCampaignArtifactRecords =
  importMailchimpCampaignArtifactRecordsFromPath as (input: {
    readonly campaignPath: string;
    readonly receivedAt: string;
  }) => Promise<ImportedMailchimpCampaignActivityRecord[]>;
const buildTypedMailchimpUnmatchedReport =
  buildMailchimpUnmatchedReport as (input: {
    readonly generatedAt: string;
    readonly recipients: readonly MailchimpUnmatchedRecipientRow[];
    readonly knownIdentityIndex: MailchimpKnownIdentityIndex;
  }) => unknown;
const writeTypedMailchimpUnmatchedReport =
  writeMailchimpUnmatchedReport as (input: {
    readonly outputRoot: string;
    readonly reportId: string;
    readonly report: unknown;
  }) => Promise<{
    readonly jsonPath: string;
    readonly csvPath: string;
  }>;

function summarizeIngestResults(
  results: readonly Stage1IngestResult[],
  input?: {
    readonly skippedUnmatched: number;
    readonly skippedUnmatchedRecipients: number;
  }
) {
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
    ).length,
    skippedUnmatched: input?.skippedUnmatched ?? 0,
    skippedUnmatchedRecipients: input?.skippedUnmatchedRecipients ?? 0
  };
}

function isOccurredAtRecord(
  record: unknown
): record is { readonly occurredAt: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "occurredAt" in record &&
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

function buildImportFailure(error: unknown): Stage1JobFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Stage1NonRetryableJobError || error instanceof ZodError) {
    return {
      disposition: "non_retryable",
      retryable: false,
      message
    };
  }

  return {
    disposition:
      error instanceof Stage1RetryableJobError ? "retryable" : "retryable",
    retryable: true,
    message
  };
}

function buildMailchimpRecordCursor(
  campaignId: string,
  nextRecordIndex: number
): string {
  return `${campaignId}:record:${String(nextRecordIndex)}`;
}

function parseMailchimpRecordCursor(
  cursor: string | null
): {
  readonly campaignId: string;
  readonly nextRecordIndex: number;
} | null {
  if (cursor === null) {
    return null;
  }

  const marker = ":record:";
  const markerIndex = cursor.lastIndexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const campaignId = cursor.slice(0, markerIndex).trim();
  const nextRecordIndexValue = cursor.slice(markerIndex + marker.length).trim();
  const nextRecordIndex = Number.parseInt(nextRecordIndexValue, 10);

  if (campaignId.length === 0 || Number.isNaN(nextRecordIndex) || nextRecordIndex < 0) {
    return null;
  }

  return {
    campaignId,
    nextRecordIndex
  };
}

function resolveMailchimpResumePlan(
  cursor: string | null,
  campaignIds: readonly string[]
): {
  readonly completedCampaignIds: ReadonlySet<string>;
  readonly resumeCampaignId: string | null;
  readonly resumeNextRecordIndex: number;
} {
  const recordCursor = parseMailchimpRecordCursor(cursor);

  if (recordCursor !== null) {
    const resumeCampaignIndex = campaignIds.indexOf(recordCursor.campaignId);

    if (resumeCampaignIndex !== -1) {
      return {
        completedCampaignIds: new Set(campaignIds.slice(0, resumeCampaignIndex)),
        resumeCampaignId: recordCursor.campaignId,
        resumeNextRecordIndex: recordCursor.nextRecordIndex
      };
    }
  }

  if (cursor !== null) {
    const completedCampaignIndex = campaignIds.indexOf(cursor);

    if (completedCampaignIndex !== -1) {
      return {
        completedCampaignIds: new Set(campaignIds.slice(0, completedCampaignIndex + 1)),
        resumeCampaignId: campaignIds[completedCampaignIndex + 1] ?? null,
        resumeNextRecordIndex: 0
      };
    }
  }

  return {
    completedCampaignIds: new Set<string>(),
    resumeCampaignId: campaignIds[0] ?? null,
    resumeNextRecordIndex: 0
  };
}

function shouldCheckpointMailchimpCampaignRecord(
  nextRecordIndex: number,
  recordCount: number
): boolean {
  return (
    nextRecordIndex === recordCount ||
    nextRecordIndex % MAILCHIMP_RECORD_PROGRESS_INTERVAL === 0
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCampaignArtifactPaths(input: {
  readonly artifactPath: string;
  readonly limitCampaigns: number | null;
  readonly startAtCampaignId: string | null;
}): Promise<string[]> {
  const resolvedArtifactPath = resolve(input.artifactPath);
  const summaryPath = resolve(resolvedArtifactPath, "summary.json");

  if (await pathExists(summaryPath)) {
    return [resolvedArtifactPath];
  }

  const entries = await readdir(resolvedArtifactPath, {
    withFileTypes: true
  });
  const campaignPaths: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const campaignPath = resolve(resolvedArtifactPath, entry.name);

    if (await pathExists(resolve(campaignPath, "summary.json"))) {
      campaignPaths.push(campaignPath);
    }
  }

  const startIndex =
    input.startAtCampaignId === null
      ? 0
      : campaignPaths.findIndex(
          (campaignPath) => basename(campaignPath) === input.startAtCampaignId
        );

  if (input.startAtCampaignId !== null && startIndex === -1) {
    throw new Error(
      `Could not find Mailchimp campaign artifact ${input.startAtCampaignId} under ${input.artifactPath}.`
    );
  }

  const resumedCampaignPaths = campaignPaths.slice(startIndex === -1 ? 0 : startIndex);

  return input.limitCampaigns === null
    ? resumedCampaignPaths
    : resumedCampaignPaths.slice(0, input.limitCampaigns);
}

async function findExistingDuplicateResult(
  persistence: Stage1PersistenceService,
  mapped: ReturnType<typeof mapMailchimpRecord>
): Promise<Stage1IngestResult | null> {
  if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
    return null;
  }

  const existingSourceEvidence = await persistence.findSourceEvidenceByIdempotencyKey(
    mapped.command.input.sourceEvidence.idempotencyKey
  );

  if (existingSourceEvidence === null) {
    return null;
  }

  const existingCanonicalEvent =
    await persistence.findCanonicalEventByIdempotencyKey(
      mapped.command.input.canonicalEvent.idempotencyKey
    );

  if (existingCanonicalEvent === null) {
    return null;
  }

  return {
    outcome: "duplicate",
    ingestMode: "historical",
    provider: "mailchimp",
    sourceRecordType: mapped.sourceRecordType,
    sourceRecordId: mapped.sourceRecordId,
    commandKind: "canonical_event",
    sourceEvidenceId: existingSourceEvidence.id,
    canonicalEventId: existingCanonicalEvent.id,
    contactId: existingCanonicalEvent.contactId
  };
}

function createMailchimpIdentityPresenceResolver(
  dependencies: Stage1MailchimpArtifactImportDependencies
) {
  const emailCache = new Map<string, Promise<boolean>>();
  const volunteerIdCache = new Map<string, Promise<boolean>>();
  const knownIdentityIndex = dependencies.mailchimpIdentityIndex;

  const hasKnownEmail = (normalizedEmail: string): Promise<boolean> => {
    const cached = emailCache.get(normalizedEmail);

    if (cached !== undefined) {
      return cached;
    }

    const lookup =
      knownIdentityIndex !== undefined
        ? Promise.resolve(knownIdentityIndex.knownEmails.has(normalizedEmail))
        : dependencies.persistence.repositories.contactIdentities
            .listByNormalizedValue({
              kind: "email",
              normalizedValue: normalizedEmail
            })
            .then((rows) => rows.length > 0);
    emailCache.set(normalizedEmail, lookup);

    return lookup;
  };

  const hasKnownVolunteerId = (volunteerId: string): Promise<boolean> => {
    const cached = volunteerIdCache.get(volunteerId);

    if (cached !== undefined) {
      return cached;
    }

    const lookup =
      knownIdentityIndex !== undefined
        ? Promise.resolve(knownIdentityIndex.knownVolunteerIds.has(volunteerId))
        : dependencies.persistence.repositories.contactIdentities
            .listByNormalizedValue({
              kind: "volunteer_id_plain",
              normalizedValue: volunteerId
            })
            .then((rows) => rows.length > 0);
    volunteerIdCache.set(volunteerId, lookup);

    return lookup;
  };

  return {
    async hasKnownIdentity(record: MailchimpCampaignActivityRecord) {
      if (record.salesforceContactId !== null) {
        return true;
      }

      if (await hasKnownEmail(record.normalizedEmail)) {
        return true;
      }

      for (const volunteerId of record.volunteerIdPlainValues) {
        if (await hasKnownVolunteerId(volunteerId)) {
          return true;
        }
      }

      return false;
    }
  };
}

export function createStage1MailchimpArtifactImportService(
  dependencies: Stage1MailchimpArtifactImportDependencies
) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async importArtifacts(
      input: MailchimpArtifactImportInput
    ): Promise<Stage1MailchimpArtifactImportResult> {
      const parsedInput = mailchimpArtifactImportInputSchema.parse(input);
      const receivedAt = parsedInput.receivedAt ?? now().toISOString();
      const campaignPaths = await resolveCampaignArtifactPaths({
        artifactPath: parsedInput.artifactPath,
        limitCampaigns: parsedInput.limitCampaigns,
        startAtCampaignId: parsedInput.startAtCampaignId
      });
      const importedCampaignIds = campaignPaths.map((campaignPath) =>
        basename(campaignPath)
      );

      if (campaignPaths.length === 0) {
        throw new Error(
          `No Mailchimp campaign artifacts were found under ${parsedInput.artifactPath}.`
        );
      }

      const startedSyncState = await dependencies.syncState.startWindow({
        syncStateId: parsedInput.syncStateId,
        scope: "provider",
        provider: "mailchimp",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: null,
        windowStart: null,
        windowEnd: null
      });
      const resumePlan = resolveMailchimpResumePlan(
        startedSyncState.cursor,
        importedCampaignIds
      );

      let parsedRecords = 0;
      const ingestResults: Stage1IngestResult[] = [];
      let windowStart: string | null = startedSyncState.windowStart;
      let checkpoint: string | null = startedSyncState.windowEnd;
      let unmatchedReportPaths:
        | {
            readonly jsonPath: string;
            readonly csvPath: string;
          }
        | null = null;
      let skippedUnmatched = 0;
      const skippedRecipients = new Map<
        string,
        {
          campaignId: string;
          campaignName: string | null;
          audienceId: string | null;
          memberId: string;
          email: string | null;
          platformId: string | null;
          activityTypes: Set<string>;
        }
      >();
      const identityPresenceResolver =
        createMailchimpIdentityPresenceResolver(dependencies);
      let pendingDeadLetterCountIncrement = 0;
      let latestCursor = startedSyncState.cursor;

      try {
        for (const campaignPath of campaignPaths) {
          const campaignId = basename(campaignPath);

          if (resumePlan.completedCampaignIds.has(campaignId)) {
            continue;
          }

          const records = await importMailchimpCampaignArtifactRecords({
            campaignPath,
            receivedAt
          });
          parsedRecords += records.length;
          const campaignWindow = calculateHistoricalWindow(records);

          if (
            campaignWindow.windowStart !== null &&
            (windowStart === null || campaignWindow.windowStart < windowStart)
          ) {
            windowStart = campaignWindow.windowStart;
          }

          if (
            campaignWindow.checkpoint !== null &&
            (checkpoint === null || campaignWindow.checkpoint > checkpoint)
          ) {
            checkpoint = campaignWindow.checkpoint;
          }

          const resumeNextRecordIndex =
            resumePlan.resumeCampaignId === campaignId
              ? Math.min(resumePlan.resumeNextRecordIndex, records.length)
              : 0;

          for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
            const record = records[recordIndex];

            if (record === undefined) {
              continue;
            }

            const hasKnownIdentity =
              await identityPresenceResolver.hasKnownIdentity(record);
            const nextRecordIndex = recordIndex + 1;

            if (!hasKnownIdentity) {
              skippedUnmatched += 1;
              const skippedKey = `${record.campaignId}:${record.memberId}`;
              const existingSkippedRecipient = skippedRecipients.get(skippedKey);

              if (existingSkippedRecipient === undefined) {
                skippedRecipients.set(skippedKey, {
                  campaignId: record.campaignId,
                  campaignName: record.campaignName,
                  audienceId:
                    record.audienceId.trim().length === 0
                      ? null
                      : record.audienceId,
                  memberId: record.memberId,
                  email: record.normalizedEmail,
                  platformId: record.volunteerIdPlainValues[0] ?? null,
                  activityTypes: new Set([record.activityType])
                });
              } else {
                existingSkippedRecipient.activityTypes.add(record.activityType);
              }
            } else if (recordIndex >= resumeNextRecordIndex) {
              const mapped = mapMailchimpRecord(record);
              const duplicateResult = await findExistingDuplicateResult(
                dependencies.persistence,
                mapped
              );
              const ingestResult =
                duplicateResult ??
                (await dependencies.ingest.ingestMailchimpHistoricalRecord(record));
              ingestResults.push(ingestResult);
              if (ingestResult.outcome === "quarantined") {
                pendingDeadLetterCountIncrement += 1;
              }

              if (
                ingestResult.outcome === "deferred" ||
                ingestResult.outcome === "quarantined" ||
                ingestResult.canonicalEventId === null
              ) {
              } else if (
                duplicateResult === null &&
                mapped.outcome === "command" &&
                mapped.command.kind === "canonical_event"
              ) {
                await recordProjectionSeedOnce(dependencies.persistence, {
                  canonicalEventId: mapped.command.input.canonicalEvent.id,
                  summary: mapped.command.input.canonicalEvent.summary,
                  snippet: mapped.command.input.canonicalEvent.snippet ?? "",
                  occurredAt: mapped.command.input.sourceEvidence.receivedAt
                });
              }
            }

            if (
              recordIndex >= resumeNextRecordIndex &&
              shouldCheckpointMailchimpCampaignRecord(nextRecordIndex, records.length)
            ) {
              latestCursor =
                nextRecordIndex === records.length
                  ? campaignId
                  : buildMailchimpRecordCursor(campaignId, nextRecordIndex);
              await dependencies.syncState.recordBatchProgress({
                syncStateId: parsedInput.syncStateId,
                scope: "provider",
                provider: "mailchimp",
                jobType: "historical_backfill",
                cursor: latestCursor,
                checkpoint,
                windowStart,
                windowEnd: checkpoint,
                deadLetterCountIncrement: pendingDeadLetterCountIncrement
              });
              pendingDeadLetterCountIncrement = 0;
            }
          }

          if (records.length === 0) {
            latestCursor = campaignId;
            await dependencies.syncState.recordBatchProgress({
              syncStateId: parsedInput.syncStateId,
              scope: "provider",
              provider: "mailchimp",
              jobType: "historical_backfill",
              cursor: latestCursor,
              checkpoint,
              windowStart,
              windowEnd: checkpoint,
              deadLetterCountIncrement: pendingDeadLetterCountIncrement
            });
            pendingDeadLetterCountIncrement = 0;
          }
        }

        if (skippedRecipients.size > 0) {
          const unmatchedRecipients: MailchimpUnmatchedRecipientRow[] = Array.from(
            skippedRecipients.values()
          ).map((recipient) => ({
            campaignId: recipient.campaignId,
            campaignName: recipient.campaignName,
            audienceId: recipient.audienceId,
            memberId: recipient.memberId,
            email: recipient.email,
            platformId: recipient.platformId,
            activityTypes: Array.from(recipient.activityTypes).sort()
          }));
          const report = buildTypedMailchimpUnmatchedReport({
            generatedAt: now().toISOString(),
            recipients: unmatchedRecipients,
            knownIdentityIndex:
              dependencies.mailchimpIdentityIndex ?? emptyMailchimpKnownIdentityIndex
          });

          unmatchedReportPaths = await writeTypedMailchimpUnmatchedReport({
            outputRoot:
              parsedInput.unmatchedReportOutputRoot ??
              resolve(parsedInput.artifactPath, "..", "unmatched-reports"),
            reportId: parsedInput.syncStateId,
            report
          });
        }

        const summary = summarizeIngestResults(ingestResults, {
          skippedUnmatched,
          skippedUnmatchedRecipients: skippedRecipients.size
        });
        const completedSyncState = await dependencies.syncState.completeWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          cursor: importedCampaignIds.at(-1) ?? null,
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          parityPercent: null,
          freshnessP95Seconds: null,
          freshnessP99Seconds: null,
          completedAt: now().toISOString()
        });

        return {
          outcome: "succeeded",
          artifactPath: parsedInput.artifactPath,
          importedCampaignIds,
          parsedCampaigns: campaignPaths.length,
          parsedRecords,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary,
          checkpoint,
          syncStatus: completedSyncState.status,
          ...(unmatchedReportPaths === null
            ? {}
            : {
                unmatchedReportJsonPath: unmatchedReportPaths.jsonPath,
                unmatchedReportCsvPath: unmatchedReportPaths.csvPath
              })
        };
      } catch (error) {
        const failure = buildImportFailure(error);
        const failedSyncState = await dependencies.syncState.failWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          cursor: latestCursor,
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          deadLetterCountIncrement: pendingDeadLetterCountIncrement,
          deadLettered: false
        });
        await recordSyncFailureAudit(dependencies.persistence, {
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          failure,
          occurredAt: now().toISOString(),
          actorId: "stage1-mailchimp-artifact-import"
        });

        return {
          outcome: "failed",
          artifactPath: parsedInput.artifactPath,
          importedCampaignIds,
          parsedCampaigns: campaignPaths.length,
          parsedRecords,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary: {
            ...summarizeIngestResults(ingestResults, {
              skippedUnmatched,
              skippedUnmatchedRecipients: skippedRecipients.size
            })
          },
          checkpoint,
          syncStatus: failedSyncState.status,
          message: failure.message,
          ...(unmatchedReportPaths === null
            ? {}
            : {
                unmatchedReportJsonPath: unmatchedReportPaths.jsonPath,
                unmatchedReportCsvPath: unmatchedReportPaths.csvPath
              })
        };
      }
    }
  };
}
