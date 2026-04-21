import { readFile } from "node:fs/promises";

import {
  stage1JobVersion,
  type IdentityResolutionCase,
  type Provider,
  type SourceEvidenceRecord,
  type Stage1OrchestrationMode
} from "@as-comms/contracts";
import {
  createStage1RepositoryBundle,
  type Stage1Database
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  type Stage1RepositoryBundle
} from "@as-comms/domain";
import {
  importGmailMboxRecords,
  type GmailRecord,
  type MailchimpRecord,
  type SalesforceRecord,
  type SimpleTextingRecord
} from "@as-comms/integrations";

import {
  createStage1IngestService,
  type Stage1IngestResult,
  type Stage1IngestService
} from "../ingest/index.js";
import type { Stage1ProviderCapturePorts } from "../orchestration/index.js";
import { buildOperationId } from "./helpers.js";

const DEFAULT_BATCH_SIZE = 100;

type CapturedProviderRecord =
  | GmailRecord
  | SalesforceRecord
  | SimpleTextingRecord
  | MailchimpRecord;

interface GmailHistoricalReplayConfig {
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
}

interface ReconcileTarget {
  readonly caseRecord: IdentityResolutionCase;
  readonly sourceEvidence: SourceEvidenceRecord;
  readonly mode: Stage1OrchestrationMode;
}

export interface ReconcileError {
  readonly caseId: string;
  readonly sourceEvidenceId: string;
  readonly provider?: Provider;
  readonly providerRecordType?: string;
  readonly providerRecordId?: string;
  readonly message: string;
}

export interface ReconcileReport {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly resolved: number;
  readonly created: number;
  readonly skipped: number;
  readonly errors: readonly ReconcileError[];
}

interface ReconcileIdentityQueueInput {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly capture: Stage1ProviderCapturePorts;
  readonly gmailHistoricalReplay: GmailHistoricalReplayConfig;
  readonly dryRun: boolean;
  readonly limit?: number;
  readonly logger?: Pick<Console, "log">;
}

interface ParsedGmailHistoricalPayloadRef {
  readonly mboxPath: string;
  readonly messageNumber: number;
}

interface ReconcileExecutionResult {
  readonly ingestResult: Stage1IngestResult;
  readonly createdNewContact: boolean;
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run-rollback");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
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

function buildHistoricalReplayProjectInboxAliases(input: {
  readonly configuredAliases: readonly string[];
  readonly recordedProjectInboxAlias: string | null;
}): string[] {
  const aliases = new Set(
    input.configuredAliases
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0)
  );

  if (
    input.recordedProjectInboxAlias !== null &&
    input.recordedProjectInboxAlias.trim().length > 0
  ) {
    aliases.add(input.recordedProjectInboxAlias.trim());
  }

  return [...aliases];
}

function parseGmailHistoricalPayloadRef(
  payloadRef: string
): ParsedGmailHistoricalPayloadRef {
  if (!payloadRef.startsWith("mbox://")) {
    throw new Error(
      `Expected Gmail historical replay payloadRef to use the mbox:// scheme, received ${payloadRef}.`
    );
  }

  const hashIndex = payloadRef.indexOf("#");
  const encodedPath = payloadRef.slice(
    "mbox://".length,
    hashIndex === -1 ? undefined : hashIndex
  );

  if (encodedPath.trim().length === 0) {
    throw new Error(
      `Expected Gmail historical replay payloadRef to include an mbox path, received ${payloadRef}.`
    );
  }

  let mboxPath: string;

  try {
    mboxPath = decodeURIComponent(encodedPath);
  } catch {
    throw new Error(
      `Expected Gmail historical replay payloadRef to contain a valid encoded mbox path, received ${payloadRef}.`
    );
  }

  const searchParams = new URLSearchParams(
    hashIndex === -1 ? "" : payloadRef.slice(hashIndex + 1)
  );
  const messageValue = searchParams.get("message");
  const messageNumber =
    messageValue === null ? Number.NaN : Number.parseInt(messageValue, 10);

  if (!Number.isInteger(messageNumber) || messageNumber < 1) {
    throw new Error(
      `Expected Gmail historical replay payloadRef to include a positive message number, received ${payloadRef}.`
    );
  }

  return {
    mboxPath,
    messageNumber
  };
}

function buildRecordKey(input: {
  readonly providerRecordType: string;
  readonly providerRecordId: string;
}): string {
  return `${input.providerRecordType}:${input.providerRecordId}`;
}

function inferReplayMode(
  sourceEvidence: SourceEvidenceRecord
): Stage1OrchestrationMode {
  switch (sourceEvidence.provider) {
    case "gmail":
      return sourceEvidence.payloadRef.startsWith("mbox://")
        ? "historical"
        : "live";
    case "salesforce":
      return "live";
    case "simpletexting":
      return sourceEvidence.payloadRef.startsWith("capture://simpletexting/")
        ? "live"
        : "historical";
    case "mailchimp":
      return sourceEvidence.payloadRef.startsWith("capture://mailchimp/")
        ? "transition_live"
        : "historical";
    case "manual":
      throw new Error(
        `Manual source evidence ${sourceEvidence.id} cannot be reconciled through the identity replay workflow.`
      );
  }
}

async function loadOpenIdentityMissingAnchorTargets(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly limit?: number;
}): Promise<{
  readonly targets: readonly ReconcileTarget[];
  readonly errors: readonly ReconcileError[];
}> {
  const cases = await input.repositories.identityResolutionQueue.listOpenByReasonCode(
    "identity_missing_anchor"
  );
  const selectedCases =
    input.limit === undefined ? cases : cases.slice(0, input.limit);
  const sourceEvidenceById = new Map(
    (
      await input.repositories.sourceEvidence.listByIds(
        uniqueStrings(selectedCases.map((caseRecord) => caseRecord.sourceEvidenceId))
      )
    ).map((record) => [record.id, record] as const)
  );
  const targets: ReconcileTarget[] = [];
  const errors: ReconcileError[] = [];

  for (const caseRecord of selectedCases) {
    const sourceEvidence = sourceEvidenceById.get(caseRecord.sourceEvidenceId);

    if (sourceEvidence === undefined) {
      errors.push({
        caseId: caseRecord.id,
        sourceEvidenceId: caseRecord.sourceEvidenceId,
        message: `Missing source evidence ${caseRecord.sourceEvidenceId} for open identity review case.`
      });
      continue;
    }

    targets.push({
      caseRecord,
      sourceEvidence,
      mode: inferReplayMode(sourceEvidence)
    });
  }

  return {
    targets,
    errors
  };
}

async function loadHistoricalGmailRecords(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly targets: readonly ReconcileTarget[];
  readonly gmailHistoricalReplay: GmailHistoricalReplayConfig;
}): Promise<Map<string, GmailRecord>> {
  const sourceEvidenceIds = input.targets.map((target) => target.sourceEvidence.id);
  const gmailDetails = await input.repositories.gmailMessageDetails.listBySourceEvidenceIds(
    sourceEvidenceIds
  );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail] as const)
  );
  const mboxTextByPath = new Map<string, string>();
  const importedRecordsByCacheKey = new Map<string, readonly GmailRecord[]>();
  const recordsBySourceEvidenceId = new Map<string, GmailRecord>();

  for (const target of input.targets) {
    const gmailDetail = gmailDetailBySourceEvidenceId.get(target.sourceEvidence.id);

    if (gmailDetail === undefined) {
      throw new Error(
        `Expected gmail_message_details to exist for historical replay source evidence ${target.sourceEvidence.id}.`
      );
    }

    const parsedPayloadRef = parseGmailHistoricalPayloadRef(
      target.sourceEvidence.payloadRef
    );
    let mboxText = mboxTextByPath.get(parsedPayloadRef.mboxPath);

    if (mboxText === undefined) {
      mboxText = await readFile(parsedPayloadRef.mboxPath, "utf8");
      mboxTextByPath.set(parsedPayloadRef.mboxPath, mboxText);
    }

    const capturedMailbox =
      gmailDetail.capturedMailbox ?? input.gmailHistoricalReplay.liveAccount;
    const replayProjectInboxAliases = buildHistoricalReplayProjectInboxAliases({
      configuredAliases: input.gmailHistoricalReplay.projectInboxAliases,
      recordedProjectInboxAlias: gmailDetail.projectInboxAlias
    });
    const cacheKey = JSON.stringify({
      mboxPath: parsedPayloadRef.mboxPath,
      capturedMailbox,
      projectInboxAliases: replayProjectInboxAliases,
      projectInboxAliasOverride: gmailDetail.projectInboxAlias,
      receivedAt: target.sourceEvidence.receivedAt
    });
    let importedRecords = importedRecordsByCacheKey.get(cacheKey);

    if (importedRecords === undefined) {
      importedRecords = await importGmailMboxRecords({
        mboxText,
        mboxPath: parsedPayloadRef.mboxPath,
        capturedMailbox,
        liveAccount: input.gmailHistoricalReplay.liveAccount,
        projectInboxAliases: replayProjectInboxAliases,
        projectInboxAliasOverride: gmailDetail.projectInboxAlias,
        receivedAt: target.sourceEvidence.receivedAt
      });
      importedRecordsByCacheKey.set(cacheKey, importedRecords);
    }

    const replayedRecord = importedRecords[parsedPayloadRef.messageNumber - 1];

    if (
      replayedRecord?.recordType !== target.sourceEvidence.providerRecordType ||
      replayedRecord.recordId !== target.sourceEvidence.providerRecordId
    ) {
      throw new Error(
        `Unable to reconstruct Gmail historical replay record ${buildRecordKey(target.sourceEvidence)} from ${parsedPayloadRef.mboxPath}#message=${String(parsedPayloadRef.messageNumber)}.`
      );
    }

    recordsBySourceEvidenceId.set(target.sourceEvidence.id, replayedRecord);
  }

  return recordsBySourceEvidenceId;
}

async function captureReplayGroup(input: {
  readonly capture: Stage1ProviderCapturePorts;
  readonly provider: Provider;
  readonly mode: Stage1OrchestrationMode;
  readonly targets: readonly ReconcileTarget[];
}): Promise<Map<string, CapturedProviderRecord>> {
  const recordIds = uniqueStrings(
    input.targets.map((target) => target.sourceEvidence.providerRecordId)
  );
  const maxRecords = Math.max(1, Math.min(recordIds.length, 1000));
  const basePayload = {
    version: stage1JobVersion,
    jobId: buildOperationId("stage1:identity-reconcile:job"),
    correlationId: buildOperationId("stage1:identity-reconcile:correlation"),
    traceId: null,
    batchId: buildOperationId("stage1:identity-reconcile:batch"),
    syncStateId: buildOperationId("stage1:identity-reconcile:sync-state"),
    attempt: 1,
    maxAttempts: 1,
    cursor: null,
    checkpoint: null,
    windowStart: null,
    windowEnd: null,
    recordIds,
    maxRecords
  } as const;
  const response =
    input.provider === "gmail"
      ? await input.capture.gmail.captureLiveBatch({
          ...basePayload,
          provider: "gmail",
          mode: "live",
          jobType: "live_ingest"
        })
      : input.provider === "salesforce"
        ? input.mode === "historical"
          ? await input.capture.salesforce.captureHistoricalBatch({
              ...basePayload,
              provider: "salesforce",
              mode: "historical",
              jobType: "historical_backfill"
            })
          : await input.capture.salesforce.captureLiveBatch({
              ...basePayload,
              provider: "salesforce",
              mode: "live",
              jobType: "live_ingest"
            })
        : input.provider === "simpletexting"
          ? input.mode === "historical"
            ? await input.capture.simpleTexting.captureHistoricalBatch({
                ...basePayload,
                provider: "simpletexting",
                mode: "historical",
                jobType: "historical_backfill"
              })
            : await input.capture.simpleTexting.captureLiveBatch({
                ...basePayload,
                provider: "simpletexting",
                mode: "live",
                jobType: "live_ingest"
              })
          : input.mode === "historical"
            ? await input.capture.mailchimp.captureHistoricalBatch({
                ...basePayload,
                provider: "mailchimp",
                mode: "historical",
                jobType: "historical_backfill"
              })
            : await input.capture.mailchimp.captureTransitionBatch({
                ...basePayload,
                provider: "mailchimp",
                mode: "transition_live",
                jobType: "live_ingest"
              });

  return new Map(
    response.records.map((record) => [
      buildRecordKey({
        providerRecordType: record.recordType,
        providerRecordId: record.recordId
      }),
      record
    ])
  );
}

async function loadCapturedRecordsForTargets(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly capture: Stage1ProviderCapturePorts;
  readonly targets: readonly ReconcileTarget[];
  readonly gmailHistoricalReplay: GmailHistoricalReplayConfig;
}): Promise<{
  readonly recordsBySourceEvidenceId: ReadonlyMap<string, CapturedProviderRecord>;
  readonly errors: readonly ReconcileError[];
}> {
  const recordsBySourceEvidenceId = new Map<string, CapturedProviderRecord>();
  const errors: ReconcileError[] = [];
  const gmailHistoricalTargets = input.targets.filter(
    (target) =>
      target.sourceEvidence.provider === "gmail" && target.mode === "historical"
  );

  if (gmailHistoricalTargets.length > 0) {
    try {
      const historicalRecords = await loadHistoricalGmailRecords({
        repositories: input.repositories,
        targets: gmailHistoricalTargets,
        gmailHistoricalReplay: input.gmailHistoricalReplay
      });

      for (const [sourceEvidenceId, record] of historicalRecords.entries()) {
        recordsBySourceEvidenceId.set(sourceEvidenceId, record);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      for (const target of gmailHistoricalTargets) {
        errors.push({
          caseId: target.caseRecord.id,
          sourceEvidenceId: target.sourceEvidence.id,
          provider: target.sourceEvidence.provider,
          providerRecordType: target.sourceEvidence.providerRecordType,
          providerRecordId: target.sourceEvidence.providerRecordId,
          message
        });
      }
    }
  }

  const groupedTargets = new Map<string, ReconcileTarget[]>();

  for (const target of input.targets) {
    if (
      target.sourceEvidence.provider === "gmail" &&
      target.mode === "historical"
    ) {
      continue;
    }

    const key = `${target.sourceEvidence.provider}:${target.mode}`;
    const existing = groupedTargets.get(key) ?? [];
    existing.push(target);
    groupedTargets.set(key, existing);
  }

  for (const groupTargets of groupedTargets.values()) {
    const groupLead = groupTargets[0];

    if (groupLead === undefined) {
      continue;
    }

    try {
      const recordsByRecordKey = await captureReplayGroup({
        capture: input.capture,
        provider: groupLead.sourceEvidence.provider,
        mode: groupLead.mode,
        targets: groupTargets
      });

      for (const target of groupTargets) {
        const record = recordsByRecordKey.get(buildRecordKey(target.sourceEvidence));

        if (record === undefined) {
          errors.push({
            caseId: target.caseRecord.id,
            sourceEvidenceId: target.sourceEvidence.id,
            provider: target.sourceEvidence.provider,
            providerRecordType: target.sourceEvidence.providerRecordType,
            providerRecordId: target.sourceEvidence.providerRecordId,
            message:
              "Replay capture did not return the expected provider-close record."
          });
          continue;
        }

        recordsBySourceEvidenceId.set(target.sourceEvidence.id, record);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      for (const target of groupTargets) {
        errors.push({
          caseId: target.caseRecord.id,
          sourceEvidenceId: target.sourceEvidence.id,
          provider: target.sourceEvidence.provider,
          providerRecordType: target.sourceEvidence.providerRecordType,
          providerRecordId: target.sourceEvidence.providerRecordId,
          message
        });
      }
    }
  }

  return {
    recordsBySourceEvidenceId,
    errors
  };
}

async function ingestCapturedRecord(input: {
  readonly ingest: Stage1IngestService;
  readonly target: ReconcileTarget;
  readonly record: CapturedProviderRecord;
}): Promise<Stage1IngestResult> {
  switch (input.target.sourceEvidence.provider) {
    case "gmail":
      return input.target.mode === "historical"
        ? input.ingest.ingestGmailHistoricalRecord(input.record as GmailRecord)
        : input.ingest.ingestGmailLiveRecord(input.record as GmailRecord);
    case "salesforce":
      return input.target.mode === "historical"
        ? input.ingest.ingestSalesforceHistoricalRecord(
            input.record as SalesforceRecord
          )
        : input.ingest.ingestSalesforceLiveRecord(input.record as SalesforceRecord);
    case "simpletexting":
      return input.target.mode === "historical"
        ? input.ingest.ingestSimpleTextingHistoricalRecord(
            input.record as SimpleTextingRecord
          )
        : input.ingest.ingestSimpleTextingLiveRecord(
            input.record as SimpleTextingRecord
          );
    case "mailchimp":
      return input.target.mode === "historical"
        ? input.ingest.ingestMailchimpHistoricalRecord(
            input.record as MailchimpRecord
          )
        : input.ingest.ingestMailchimpTransitionRecord(
            input.record as MailchimpRecord
          );
    case "manual":
      throw new Error("Manual source evidence cannot be re-ingested here.");
  }
}

function ingestedCanonicalEvent(
  result: Stage1IngestResult
): result is Extract<
  Stage1IngestResult,
  { readonly canonicalEventId: string; readonly contactId: string }
> {
  return (
    (result.outcome === "normalized" || result.outcome === "duplicate") &&
    result.commandKind === "canonical_event" &&
    result.canonicalEventId !== null &&
    result.contactId !== null
  );
}

function replayCreatedCanonicalEvent(
  result: Stage1IngestResult
): result is Extract<
  Stage1IngestResult,
  {
    readonly outcome: "review_opened";
    readonly canonicalEventId: string;
    readonly contactId: string;
  }
> {
  return (
    result.outcome === "review_opened" &&
    result.canonicalEventId !== null &&
    result.contactId !== null
  );
}

function shouldCloseOriginalCase(result: Stage1IngestResult): boolean {
  if (ingestedCanonicalEvent(result) || replayCreatedCanonicalEvent(result)) {
    return true;
  }

  if (result.outcome !== "review_opened") {
    return false;
  }

  return result.reviewCases.some(
    (reviewCase) =>
      reviewCase.queue === "identity" &&
      reviewCase.reasonCode !== "identity_missing_anchor"
  );
}

async function markIdentityCaseResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: IdentityResolutionCase;
  readonly resolvedAt: string;
}): Promise<void> {
  await input.repositories.identityResolutionQueue.upsert({
    ...input.caseRecord,
    status: "resolved",
    resolvedAt: input.resolvedAt,
    explanation: `${input.caseRecord.explanation} Reconciled by replay.`
  });
}

function classifyExecution(input: {
  readonly report: ReconcileReport;
  readonly execution: ReconcileExecutionResult;
}): ReconcileReport {
  const { report, execution } = input;
  const { ingestResult } = execution;

  if (
    ingestedCanonicalEvent(ingestResult) ||
    replayCreatedCanonicalEvent(ingestResult)
  ) {
    return {
      ...report,
      resolved: report.resolved + (execution.createdNewContact ? 0 : 1),
      created: report.created + (execution.createdNewContact ? 1 : 0)
    };
  }

  return {
    ...report,
    skipped: report.skipped + 1
  };
}

async function executeTarget(input: {
  readonly db: Stage1Database;
  readonly target: ReconcileTarget;
  readonly record: CapturedProviderRecord;
  readonly dryRun: boolean;
}): Promise<ReconcileExecutionResult> {
  const processedAt = new Date().toISOString();
  let execution: ReconcileExecutionResult | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const ingest = createStage1IngestService(normalization);
    const beforeContactCount = (await repositories.contacts.listAll()).length;
    const ingestResult = await ingestCapturedRecord({
      ingest,
      target: input.target,
      record: input.record
    });
    const afterContactCount = (await repositories.contacts.listAll()).length;

    if (shouldCloseOriginalCase(ingestResult)) {
      await markIdentityCaseResolved({
        repositories,
        caseRecord: input.target.caseRecord,
        resolvedAt: processedAt
      });
    }

    execution = {
      ingestResult,
      createdNewContact: afterContactCount > beforeContactCount
    };

    if (input.dryRun) {
      throw new DryRunRollback();
    }
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }
  } else {
    await input.db.transaction(runInTransaction);
  }

  // TS can't narrow through the closure assignment in runInTransaction, so this
  // check looks unnecessary to the linter even though it's a real runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (execution === null) {
    throw new Error(
      `Expected reconcile execution result for source evidence ${input.target.sourceEvidence.id}.`
    );
  }

  return execution;
}

export async function reconcileIdentityQueue(
  input: ReconcileIdentityQueueInput
): Promise<ReconcileReport> {
  const logger = input.logger ?? console;
  const initialTargets = await loadOpenIdentityMissingAnchorTargets({
    repositories: input.repositories,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });
  let report: ReconcileReport = {
    dryRun: input.dryRun,
    scanned: initialTargets.targets.length,
    resolved: 0,
    created: 0,
    skipped: 0,
    errors: initialTargets.errors
  };
  const batches = chunkValues(initialTargets.targets, DEFAULT_BATCH_SIZE);

  for (const [batchIndex, batch] of batches.entries()) {
    const captured = await loadCapturedRecordsForTargets({
      repositories: input.repositories,
      capture: input.capture,
      targets: batch,
      gmailHistoricalReplay: input.gmailHistoricalReplay
    });

    report = {
      ...report,
      errors: [...report.errors, ...captured.errors]
    };

    const erroredSourceEvidenceIds = new Set(
      captured.errors.map((error) => error.sourceEvidenceId)
    );

    for (const target of batch) {
      if (erroredSourceEvidenceIds.has(target.sourceEvidence.id)) {
        continue;
      }

      const record = captured.recordsBySourceEvidenceId.get(target.sourceEvidence.id);

      if (record === undefined) {
        report = {
          ...report,
          errors: [
            ...report.errors,
            {
              caseId: target.caseRecord.id,
              sourceEvidenceId: target.sourceEvidence.id,
              provider: target.sourceEvidence.provider,
              providerRecordType: target.sourceEvidence.providerRecordType,
              providerRecordId: target.sourceEvidence.providerRecordId,
              message:
                "Replay preparation finished without a captured provider-close record."
            }
          ]
        };
        continue;
      }

      try {
        const execution = await executeTarget({
          db: input.db,
          target,
          record,
          dryRun: input.dryRun
        });

        report = classifyExecution({
          report,
          execution
        });
      } catch (error) {
        report = {
          ...report,
          errors: [
            ...report.errors,
            {
              caseId: target.caseRecord.id,
              sourceEvidenceId: target.sourceEvidence.id,
              provider: target.sourceEvidence.provider,
              providerRecordType: target.sourceEvidence.providerRecordType,
              providerRecordId: target.sourceEvidence.providerRecordId,
              message: error instanceof Error ? error.message : String(error)
            }
          ]
        };
      }
    }

    logger.log(
      JSON.stringify({
        batchIndex: batchIndex + 1,
        batchSize: batch.length,
        scanned: report.scanned,
        resolved: report.resolved,
        created: report.created,
        skipped: report.skipped,
        errors: report.errors.length,
        dryRun: report.dryRun
      })
    );
  }

  return report;
}
