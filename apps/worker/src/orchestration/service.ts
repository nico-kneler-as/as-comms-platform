import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { ZodError, type infer as ZodInfer } from "zod";

import {
  cutoverCheckpointBatchPayloadSchema,
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchPayloadSchema,
  identityResolutionReasonCodeValues,
  mailchimpHistoricalCaptureBatchPayloadSchema,
  mailchimpTransitionCaptureBatchPayloadSchema,
  parityCheckBatchPayloadSchema,
  projectionRebuildBatchPayloadSchema,
  replayBatchPayloadSchema,
  routingReviewReasonCodeValues,
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  simpleTextingHistoricalCaptureBatchPayloadSchema,
  simpleTextingLiveCaptureBatchPayloadSchema,
  stage1JobVersion,
  type CanonicalEventRecord,
  type CutoverCheckpointBatchPayload,
  type GmailLiveCaptureBatchPayload,
  type ParityCheckBatchPayload,
  type ProjectionRebuildBatchPayload,
  type Provider,
  type ReplayBatchPayload,
  type SalesforceLiveCaptureBatchPayload,
  type SyncJobType
} from "@as-comms/contracts";
import {
  ProviderCaptureError,
  gmailMessageRecordSchema,
  importGmailMboxRecords,
  mapGmailRecord,
  mapMailchimpRecord,
  mapSalesforceRecord,
  mapSimpleTextingRecord
} from "@as-comms/integrations";
import type {
  GmailRecord,
  MailchimpRecord,
  ProviderMappingResult,
  SalesforceRecord,
  SimpleTextingRecord
} from "@as-comms/integrations";
import type {
  Stage1NormalizationService,
  Stage1PersistenceService
} from "@as-comms/domain";
import { isInboxDrivingCanonicalEvent } from "@as-comms/domain";

import type { Stage1IngestService } from "../ingest/service.js";
import type { Stage1IngestResult } from "../ingest/types.js";
import {
  Stage1NonRetryableJobError,
  Stage1RetryableJobError
} from "./errors.js";
import { projectionSeedPolicyCode, recordProjectionSeedOnce } from "./projection-seed.js";
import { recordSyncFailureAudit } from "./sync-failure-audit.js";
import { createStage1SyncStateService } from "./sync-state.js";
import type {
  Stage1CaptureJobOutcome,
  Stage1CutoverCheckpointJobOutcome,
  Stage1CutoverSyncSnapshot,
  Stage1IngestBatchSummary,
  Stage1JobFailure,
  Stage1OperationalDiscrepancy,
  Stage1ParityCheckJobOutcome,
  Stage1ParityMetricByProvider,
  Stage1ParityMetrics,
  Stage1ProjectionRebuildJobOutcome,
  Stage1ProjectionSeed,
  Stage1ProviderCapturePorts,
  Stage1SampledParityContact,
  Stage1WorkerOrchestrationService
} from "./types.js";

const paritySnapshotPolicyCode = "stage1.parity.snapshot";
const cutoverCheckpointPolicyCode = "stage1.cutover.checkpoint";
const gmailAndSimpleTextingP95ThresholdSeconds = 120;
const gmailAndSimpleTextingP99ThresholdSeconds = 300;
const salesforceLifecycleP95ThresholdSeconds = 600;
const defaultGmailLivePollIntervalSeconds = 60;
const defaultSalesforceLivePollIntervalSeconds = 300;
const CONSECUTIVE_FAILURE_DEAD_LETTER_THRESHOLD = 5;
export const gmailLiveWindowLookbackMs = 10 * 60 * 1000;
const livePollMaxRecords = 1000;

type CapturedProviderRecord =
  | GmailRecord
  | SalesforceRecord
  | SimpleTextingRecord
  | MailchimpRecord;

interface Stage1FreshnessMetrics {
  readonly p95Seconds: number | null;
  readonly p99Seconds: number | null;
}

interface Stage1GmailHistoricalReplayConfig {
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
}

interface Stage1LivePollingConfig {
  readonly gmailPollIntervalSeconds: number;
  readonly salesforcePollIntervalSeconds: number;
}

interface ParsedGmailHistoricalPayloadRef {
  readonly mboxPath: string;
  readonly messageNumber: number;
}

const instrumentedSalesforceDeferredTaskPolicyCodeByRecordType = {
  task_unmapped_channel: "stage1.skip.task_unmapped_channel",
  task_missing_id: "stage1.skip.task_missing_id",
  task_missing_occurred_at: "stage1.skip.task_missing_occurred_at"
} as const;

type InstrumentedSalesforceDeferredTaskRecordType =
  keyof typeof instrumentedSalesforceDeferredTaskPolicyCodeByRecordType;

interface InstrumentedSalesforceDeferredTaskRecord {
  readonly recordType: InstrumentedSalesforceDeferredTaskRecordType;
  readonly recordId: string;
  readonly taskSubtype?: string | null;
  readonly subject?: string | null;
  readonly ownerUsername?: string | null;
  readonly whoId?: string | null;
  readonly relatedMembershipPresent?: boolean;
  readonly createdDate?: string | null;
  readonly lastModifiedDate?: string | null;
}

function buildHistoricalReplayProjectInboxAliases(input: {
  readonly configuredAliases: readonly string[];
  readonly recordedProjectInboxAlias: string | null;
}): string[] {
  const aliases = new Set(
    input.configuredAliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0)
  );

  if (
    input.recordedProjectInboxAlias !== null &&
    input.recordedProjectInboxAlias.trim().length > 0
  ) {
    aliases.add(input.recordedProjectInboxAlias.trim());
  }

  return [...aliases];
}

function compareEventOrder(
  left: CanonicalEventRecord,
  right: CanonicalEventRecord
): number {
  if (left.occurredAt < right.occurredAt) {
    return -1;
  }

  if (left.occurredAt > right.occurredAt) {
    return 1;
  }

  return left.id.localeCompare(right.id);
}

function buildWorkerOperationId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

function isInstrumentedSalesforceDeferredTaskRecord(
  record: SalesforceRecord
): record is InstrumentedSalesforceDeferredTaskRecord {
  return (
    record.recordType === "task_unmapped_channel" ||
    record.recordType === "task_missing_id" ||
    record.recordType === "task_missing_occurred_at"
  );
}

function truncateAuditSubject(subject: string | null | undefined): string | null {
  if (typeof subject !== "string") {
    return null;
  }

  return subject.length <= 200 ? subject : subject.slice(0, 200);
}

async function recordDeferredSalesforceTaskAuditIfNeeded(
  persistence: Stage1PersistenceService,
  input: {
    readonly record: SalesforceRecord;
    readonly ingestResult: Stage1IngestResult;
  }
): Promise<void> {
  if (
    input.ingestResult.outcome !== "deferred" ||
    input.ingestResult.provider !== "salesforce" ||
    !isInstrumentedSalesforceDeferredTaskRecord(input.record)
  ) {
    return;
  }

  const policyCode =
    instrumentedSalesforceDeferredTaskPolicyCodeByRecordType[
      input.record.recordType
    ];
  const auditId = `audit:salesforce_task:${input.record.recordId}:${policyCode}`;
  const existingRecords = await persistence.repositories.auditEvidence.listByEntity({
    entityType: "salesforce_task",
    entityId: input.record.recordId
  });

  if (existingRecords.some((record) => record.policyCode === policyCode)) {
    return;
  }

  await persistence.recordAuditEvidence({
    id: auditId,
    actorType: "system",
    actorId: "salesforce_capture",
    action: "skipped_unmapped_task",
    entityType: "salesforce_task",
    entityId: input.record.recordId,
    occurredAt: new Date().toISOString(),
    result: "recorded",
    policyCode,
    metadataJson: {
      taskSubtype: input.record.taskSubtype ?? null,
      subject: truncateAuditSubject(input.record.subject),
      ownerUsername: input.record.ownerUsername ?? null,
      whoId: input.record.whoId ?? null,
      relatedMembershipPresent: input.record.relatedMembershipPresent ?? false,
      createdDate: input.record.createdDate ?? null,
      lastModifiedDate: input.record.lastModifiedDate ?? null
    }
  });
}

function subtractSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

function resolveLivePollCheckpoint(input: {
  readonly syncState: {
    readonly status: string;
    readonly cursor: string | null;
    readonly lastSuccessfulAt: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  } | null;
  readonly fallbackWindowStart: string;
}): string {
  if (input.syncState === null) {
    return input.fallbackWindowStart;
  }

  if (input.syncState.status === "failed" || input.syncState.status === "quarantined") {
    return (
      input.syncState.cursor ??
      input.syncState.windowStart ??
      input.syncState.lastSuccessfulAt ??
      input.syncState.windowEnd ??
      input.fallbackWindowStart
    );
  }

  return (
    input.syncState.lastSuccessfulAt ??
    input.syncState.windowEnd ??
    input.syncState.cursor ??
    input.fallbackWindowStart
  );
}

function isInboxDrivingEvent(
  event: Pick<CanonicalEventRecord, "eventType" | "provenance">
): boolean {
  return isInboxDrivingCanonicalEvent(event);
}

function buildDefaultProjectionSeed(
  eventType: CanonicalEventRecord["eventType"]
): Stage1ProjectionSeed {
  switch (eventType) {
    case "communication.email.inbound":
      return {
        summary: "Inbound email received",
        snippet: "",
        source: "fallback"
      };
    case "communication.email.outbound":
      return {
        summary: "Outbound email sent",
        snippet: "",
        source: "fallback"
      };
    case "communication.sms.inbound":
      return {
        summary: "Inbound SMS received",
        snippet: "",
        source: "fallback"
      };
    case "communication.sms.outbound":
      return {
        summary: "Outbound SMS sent",
        snippet: "",
        source: "fallback"
      };
    case "communication.sms.opt_in":
      return {
        summary: "SMS opt-in received",
        snippet: "",
        source: "fallback"
      };
    case "communication.sms.opt_out":
      return {
        summary: "SMS opt-out received",
        snippet: "",
        source: "fallback"
      };
    case "lifecycle.signed_up":
      return {
        summary: "Volunteer signed up",
        snippet: "",
        source: "fallback"
      };
    case "lifecycle.received_training":
      return {
        summary: "Volunteer received training",
        snippet: "",
        source: "fallback"
      };
    case "lifecycle.completed_training":
      return {
        summary: "Volunteer completed training",
        snippet: "",
        source: "fallback"
      };
    case "lifecycle.submitted_first_data":
      return {
        summary: "Volunteer submitted first data",
        snippet: "",
        source: "fallback"
      };
    case "campaign.email.sent":
      return {
        summary: "Campaign email sent",
        snippet: "",
        source: "fallback"
      };
    case "campaign.email.opened":
      return {
        summary: "Campaign email opened",
        snippet: "",
        source: "fallback"
      };
    case "campaign.email.clicked":
      return {
        summary: "Campaign email clicked",
        snippet: "",
        source: "fallback"
      };
    case "campaign.email.unsubscribed":
      return {
        summary: "Campaign email unsubscribed",
        snippet: "",
        source: "fallback"
      };
    case "note.internal.created":
      return {
        summary: "Internal note added",
        snippet: "",
        source: "fallback"
      };
  }
}

function summarizeIngestResults(
  results: readonly Stage1IngestResult[]
): Stage1IngestBatchSummary {
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

function calculateParityPercent(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 100;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function formatPercent(value: number): string {
  return value.toFixed(2);
}

function calculatePercentileSeconds(
  values: readonly number[],
  percentile: number
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1)
  );
  const value = sorted[index];

  if (value === undefined) {
    throw new Error("Expected percentile value to exist.");
  }

  return value;
}

function toFreshnessSeconds(
  occurredAt: string,
  receivedAt: string
): number | null {
  const occurredAtMs = Date.parse(occurredAt);
  const receivedAtMs = Date.parse(receivedAt);

  if (Number.isNaN(occurredAtMs) || Number.isNaN(receivedAtMs)) {
    return null;
  }

  return Math.max(0, Math.round((receivedAtMs - occurredAtMs) / 1000));
}

function hasTimedTimestamps(
  record: CapturedProviderRecord
): record is Extract<
  CapturedProviderRecord,
  {
    readonly occurredAt: string;
    readonly receivedAt: string;
  }
> {
  return "occurredAt" in record && "receivedAt" in record;
}

function extractFreshnessSample(
  provider: Provider,
  jobType: SyncJobType,
  record: CapturedProviderRecord
): number | null {
  if (jobType !== "live_ingest") {
    return null;
  }

  switch (provider) {
    case "gmail":
      return record.recordType === "message" && hasTimedTimestamps(record)
        ? toFreshnessSeconds(record.occurredAt, record.receivedAt)
        : null;
    case "salesforce":
      return (
        record.recordType === "lifecycle_milestone" && hasTimedTimestamps(record)
      )
        ? toFreshnessSeconds(record.occurredAt, record.receivedAt)
        : null;
    case "simpletexting":
      return record.recordType === "message" && hasTimedTimestamps(record)
        ? toFreshnessSeconds(record.occurredAt, record.receivedAt)
        : null;
    case "mailchimp":
    case "manual":
      return null;
  }
}

function calculateFreshnessMetrics(
  provider: Provider,
  jobType: SyncJobType,
  records: readonly CapturedProviderRecord[]
): Stage1FreshnessMetrics {
  const samples = records
    .map((record) => extractFreshnessSample(provider, jobType, record))
    .filter((value): value is number => value !== null);

  return {
    p95Seconds: calculatePercentileSeconds(samples, 0.95),
    p99Seconds: calculatePercentileSeconds(samples, 0.99)
  };
}

function buildJobFailure(
  error: unknown,
  attempt: number,
  maxAttempts: number
): Stage1JobFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Stage1NonRetryableJobError || error instanceof ZodError) {
    return {
      disposition: "non_retryable",
      retryable: false,
      message
    };
  }

  if (error instanceof ProviderCaptureError) {
    return {
      disposition: error.retryable
        ? attempt >= maxAttempts
          ? "dead_letter"
          : "retryable"
        : "non_retryable",
      retryable: error.retryable && attempt < maxAttempts,
      message
    };
  }

  if (attempt >= maxAttempts) {
    return {
      disposition: "dead_letter",
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

async function loadProjectionSeed(
  persistence: Stage1PersistenceService,
  event: CanonicalEventRecord
): Promise<Stage1ProjectionSeed> {
  const existingRecords = await persistence.repositories.auditEvidence.listByEntity({
    entityType: "canonical_event",
    entityId: event.id
  });
  const projectionSeedRecord = existingRecords.find(
    (record) => record.policyCode === projectionSeedPolicyCode
  );

  if (projectionSeedRecord !== undefined) {
    const summaryValue = projectionSeedRecord.metadataJson.summary;
    const snippetValue = projectionSeedRecord.metadataJson.snippet;

    if (typeof summaryValue === "string" && typeof snippetValue === "string") {
      return {
        summary: summaryValue,
        snippet: snippetValue,
        source: "audit"
      };
    }
  }

  return buildDefaultProjectionSeed(event.eventType);
}

function getMappedResultForRecord(
  provider: Provider,
  record: GmailRecord | SalesforceRecord | SimpleTextingRecord | MailchimpRecord
): ProviderMappingResult {
  switch (provider) {
    case "gmail":
      return mapGmailRecord(record as GmailRecord);
    case "salesforce":
      return mapSalesforceRecord(record as SalesforceRecord);
    case "simpletexting":
      return mapSimpleTextingRecord(record as SimpleTextingRecord);
    case "mailchimp":
      return mapMailchimpRecord(record as MailchimpRecord);
    case "manual":
      throw new Stage1NonRetryableJobError(
        "Manual note provider records are not mapped through worker orchestration."
      );
  }
}

function prioritizeCapturedRecordsForIngest<TRecord>(
  records: readonly TRecord[],
  mapRecord: (record: TRecord) => ProviderMappingResult
): {
  readonly record: TRecord;
  readonly mapped: ProviderMappingResult;
}[] {
  const contactGraphRecords: {
    readonly record: TRecord;
    readonly mapped: ProviderMappingResult;
  }[] = [];
  const remainingRecords: {
    readonly record: TRecord;
    readonly mapped: ProviderMappingResult;
  }[] = [];

  for (const record of records) {
    const mapped = mapRecord(record);
    const entry = { record, mapped };

    if (mapped.outcome === "command" && mapped.command.kind === "contact_graph") {
      contactGraphRecords.push(entry);
      continue;
    }

    remainingRecords.push(entry);
  }

  return [...contactGraphRecords, ...remainingRecords];
}

async function captureRecordsForReplay(
  capture: Stage1ProviderCapturePorts,
  persistence: Stage1PersistenceService,
  gmailHistoricalReplay: Stage1GmailHistoricalReplayConfig,
  payload: ReplayBatchPayload
): Promise<{
  readonly records: readonly (
    | GmailRecord
    | SalesforceRecord
    | SimpleTextingRecord
    | MailchimpRecord
  )[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
}> {
  const replayMaxRecords =
    payload.provider === "salesforce" ? 1000 : payload.items.length;

  switch (payload.provider) {
    case "gmail":
      return payload.mode === "historical"
        ? captureHistoricalGmailRecordsForReplay(
            persistence,
            gmailHistoricalReplay,
            gmailHistoricalCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "gmail",
              mode: "historical",
              jobType: "historical_backfill",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          )
        : capture.gmail.captureLiveBatch(
            gmailLiveCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "gmail",
              mode: "live",
              jobType: "live_ingest",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          );
    case "salesforce":
      return payload.mode === "historical"
        ? capture.salesforce.captureHistoricalBatch(
            salesforceHistoricalCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "salesforce",
              mode: "historical",
              jobType: "historical_backfill",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          )
        : capture.salesforce.captureLiveBatch(
            salesforceLiveCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "salesforce",
              mode: "live",
              jobType: "live_ingest",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          );
    case "simpletexting":
      return payload.mode === "historical"
        ? capture.simpleTexting.captureHistoricalBatch(
            simpleTextingHistoricalCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "simpletexting",
              mode: "historical",
              jobType: "historical_backfill",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          )
        : capture.simpleTexting.captureLiveBatch(
            simpleTextingLiveCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "simpletexting",
              mode: "live",
              jobType: "live_ingest",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          );
    case "mailchimp":
      return payload.mode === "historical"
        ? capture.mailchimp.captureHistoricalBatch(
            mailchimpHistoricalCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "mailchimp",
              mode: "historical",
              jobType: "historical_backfill",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          )
        : capture.mailchimp.captureTransitionBatch(
            mailchimpTransitionCaptureBatchPayloadSchema.parse({
              ...payload,
              provider: "mailchimp",
              mode: "transition_live",
              jobType: "live_ingest",
              cursor: null,
              checkpoint: null,
              windowStart: null,
              windowEnd: null,
              recordIds: payload.items.map((item) => item.providerRecordId),
              maxRecords: replayMaxRecords
            })
          );
    case "manual":
      throw new Stage1NonRetryableJobError(
        "Manual note provider is not supported for replay capture batches."
      );
  }
}

function parseGmailHistoricalPayloadRef(
  payloadRef: string
): ParsedGmailHistoricalPayloadRef {
  if (!payloadRef.startsWith("mbox://")) {
    throw new Stage1NonRetryableJobError(
      `Expected Gmail historical replay payloadRef to use the mbox:// scheme, received ${payloadRef}.`
    );
  }

  const hashIndex = payloadRef.indexOf("#");
  const encodedPath = payloadRef.slice(
    "mbox://".length,
    hashIndex === -1 ? undefined : hashIndex
  );

  if (encodedPath.trim().length === 0) {
    throw new Stage1NonRetryableJobError(
      `Expected Gmail historical replay payloadRef to include an mbox path, received ${payloadRef}.`
    );
  }

  let mboxPath: string;

  try {
    mboxPath = decodeURIComponent(encodedPath);
  } catch {
    throw new Stage1NonRetryableJobError(
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
    throw new Stage1NonRetryableJobError(
      `Expected Gmail historical replay payloadRef to include a positive message number, received ${payloadRef}.`
    );
  }

  return {
    mboxPath,
    messageNumber
  };
}

async function captureHistoricalGmailRecordsForReplay(
  persistence: Stage1PersistenceService,
  gmailHistoricalReplay: Stage1GmailHistoricalReplayConfig,
  payload: ZodInfer<typeof gmailHistoricalCaptureBatchPayloadSchema>
): Promise<{
  readonly records: readonly GmailRecord[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
}> {
  const sourceEvidenceRecords = await Promise.all(
    payload.recordIds.map(async (recordId: string) => {
      const matches = await persistence.repositories.sourceEvidence.listByProviderRecord({
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: recordId
      });

      return matches.at(-1) ?? null;
    })
  );
  const gmailDetails = await persistence.repositories.gmailMessageDetails.listBySourceEvidenceIds(
    sourceEvidenceRecords
      .filter(
        (
          record: (typeof sourceEvidenceRecords)[number]
        ): record is NonNullable<(typeof sourceEvidenceRecords)[number]> =>
          record !== null
      )
      .map(
        (record: NonNullable<(typeof sourceEvidenceRecords)[number]>) => record.id
      )
  );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail])
  );
  const mboxTextByPath = new Map<string, string>();
  const importedRecordsByCacheKey = new Map<string, readonly GmailRecord[]>();
  const records: GmailRecord[] = [];

  for (const [index, recordId] of payload.recordIds.entries()) {
    const sourceEvidence = sourceEvidenceRecords[index];

    if (sourceEvidence === null || sourceEvidence === undefined) {
      continue;
    }

    const gmailDetail = gmailDetailBySourceEvidenceId.get(sourceEvidence.id);

    if (gmailDetail === undefined) {
      throw new Stage1NonRetryableJobError(
        `Expected gmail_message_details to exist for historical replay source evidence ${sourceEvidence.id}.`
      );
    }

    const parsedPayloadRef = parseGmailHistoricalPayloadRef(sourceEvidence.payloadRef);
    let mboxText = mboxTextByPath.get(parsedPayloadRef.mboxPath);

    if (mboxText === undefined) {
      try {
        mboxText = await readFile(parsedPayloadRef.mboxPath, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        throw new Stage1NonRetryableJobError(
          `Unable to read Gmail historical replay payload file ${parsedPayloadRef.mboxPath}: ${message}`
        );
      }

      mboxTextByPath.set(parsedPayloadRef.mboxPath, mboxText);
    }

    const capturedMailbox =
      gmailDetail.capturedMailbox ?? gmailHistoricalReplay.liveAccount;
    const replayProjectInboxAliases = buildHistoricalReplayProjectInboxAliases({
      configuredAliases: gmailHistoricalReplay.projectInboxAliases,
      recordedProjectInboxAlias: gmailDetail.projectInboxAlias
    });
    const importedRecordCacheKey = JSON.stringify({
      mboxPath: parsedPayloadRef.mboxPath,
      capturedMailbox,
      projectInboxAliases: replayProjectInboxAliases,
      projectInboxAliasOverride: gmailDetail.projectInboxAlias,
      receivedAt: sourceEvidence.receivedAt
    });
    let importedRecords = importedRecordsByCacheKey.get(importedRecordCacheKey);

    if (importedRecords === undefined) {
      importedRecords = await importGmailMboxRecords({
        mboxText,
        mboxPath: parsedPayloadRef.mboxPath,
        capturedMailbox,
        liveAccount: gmailHistoricalReplay.liveAccount,
        projectInboxAliases: replayProjectInboxAliases,
        projectInboxAliasOverride: gmailDetail.projectInboxAlias,
        receivedAt: sourceEvidence.receivedAt
      });
      importedRecordsByCacheKey.set(importedRecordCacheKey, importedRecords);
    }

    const replayedRecord = importedRecords[parsedPayloadRef.messageNumber - 1];

    if (
      replayedRecord?.recordType !== "message" ||
      replayedRecord.recordId !== recordId
    ) {
      throw new Stage1NonRetryableJobError(
        `Unable to reconstruct Gmail historical replay record message:${recordId} from ${parsedPayloadRef.mboxPath}#message=${String(parsedPayloadRef.messageNumber)}.`
      );
    }

    records.push(replayedRecord);
  }

  return {
    records,
    nextCursor: null,
    checkpoint: payload.recordIds.at(-1) ?? null
  };
}

export function createStage1WorkerOrchestrationService(input: {
  readonly capture: Stage1ProviderCapturePorts;
  readonly ingest: Stage1IngestService;
  readonly normalization: Pick<
    Stage1NormalizationService,
    "applyInboxProjection" | "applyTimelineProjection" | "refreshInboxReviewOverlay"
  >;
  readonly persistence: Stage1PersistenceService;
  readonly gmailHistoricalReplay: Stage1GmailHistoricalReplayConfig;
  readonly livePolling?: Partial<Stage1LivePollingConfig>;
  readonly revalidateInboxViews?: (input: {
    readonly contactIds: readonly string[];
  }) => Promise<void>;
  readonly logger?: Pick<Console, "info">;
}): Stage1WorkerOrchestrationService {
  const syncState = createStage1SyncStateService(input.persistence);
  const logger = input.logger ?? console;
  const livePolling: Stage1LivePollingConfig = {
    gmailPollIntervalSeconds:
      input.livePolling?.gmailPollIntervalSeconds ??
      defaultGmailLivePollIntervalSeconds,
    salesforcePollIntervalSeconds:
      input.livePolling?.salesforcePollIntervalSeconds ??
      defaultSalesforceLivePollIntervalSeconds
  };

  async function planGmailLiveCaptureBatch(
    now = new Date()
  ): Promise<GmailLiveCaptureBatchPayload | null> {
    const latestSyncState = await input.persistence.repositories.syncState.findLatest({
      scope: "provider",
      provider: "gmail",
      jobType: "live_ingest"
    });

    if (latestSyncState?.status === "running") {
      return null;
    }

    const windowEnd = now.toISOString();
    const checkpoint = resolveLivePollCheckpoint({
      syncState: latestSyncState,
      fallbackWindowStart: subtractSeconds(
        now,
        livePolling.gmailPollIntervalSeconds
      )
    });
    const windowStart = new Date(
      now.getTime() - gmailLiveWindowLookbackMs
    ).toISOString();

    return gmailLiveCaptureBatchPayloadSchema.parse({
      version: stage1JobVersion,
      jobId: buildWorkerOperationId("stage1:gmail:live:job"),
      correlationId: buildWorkerOperationId("stage1:gmail:live:correlation"),
      batchId: buildWorkerOperationId("stage1:gmail:live:batch"),
      syncStateId: buildWorkerOperationId("stage1:gmail:live:sync-state"),
      provider: "gmail",
      mode: "live",
      jobType: "live_ingest",
      checkpoint,
      windowStart,
      windowEnd,
      maxRecords: livePollMaxRecords
    });
  }

  async function planSalesforceLiveCaptureBatch(
    now = new Date()
  ): Promise<SalesforceLiveCaptureBatchPayload | null> {
    const latestSyncState = await input.persistence.repositories.syncState.findLatest(
      {
        scope: "provider",
        provider: "salesforce",
        jobType: "live_ingest"
      }
    );

    if (latestSyncState?.status === "running") {
      return null;
    }

    const windowEnd = now.toISOString();
    const windowStart = resolveLivePollCheckpoint({
      syncState: latestSyncState,
      fallbackWindowStart: subtractSeconds(
        now,
        livePolling.salesforcePollIntervalSeconds
      )
    });

    return salesforceLiveCaptureBatchPayloadSchema.parse({
      version: stage1JobVersion,
      jobId: buildWorkerOperationId("stage1:salesforce:live:job"),
      correlationId: buildWorkerOperationId("stage1:salesforce:live:correlation"),
      batchId: buildWorkerOperationId("stage1:salesforce:live:batch"),
      syncStateId: buildWorkerOperationId("stage1:salesforce:live:sync-state"),
      provider: "salesforce",
      mode: "live",
      jobType: "live_ingest",
      checkpoint: windowStart,
      windowStart,
      windowEnd,
      maxRecords: livePollMaxRecords
    });
  }

  async function runCapturedBatch<TPayload, TRecord>(params: {
    readonly payload: TPayload;
    readonly parse: (payload: TPayload) => {
      readonly syncStateId: string;
      readonly provider: Provider;
      readonly jobType: SyncJobType;
      readonly cursor: string | null;
      readonly checkpoint: string | null;
      readonly windowStart: string | null;
      readonly windowEnd: string | null;
      readonly attempt: number;
      readonly maxAttempts: number;
    };
    readonly capture: (
      payload: TPayload
    ) => Promise<{
      readonly records: readonly TRecord[];
      readonly nextCursor: string | null;
      readonly checkpoint: string | null;
    }>;
    readonly ingestRecord: (record: TRecord) => Promise<Stage1IngestResult>;
    readonly mapRecord: (record: TRecord) => ProviderMappingResult;
  }): Promise<Stage1CaptureJobOutcome> {
    const payload = params.parse(params.payload);
    await syncState.startWindow({
      syncStateId: payload.syncStateId,
      scope: "provider",
      provider: payload.provider,
      jobType: payload.jobType,
      cursor: payload.cursor,
      checkpoint: payload.checkpoint,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd
    });

    try {
      const captured = await params.capture(params.payload);
      const ingestResults: Stage1IngestResult[] = [];
      const prioritizedRecords = prioritizeCapturedRecordsForIngest(
        captured.records,
        params.mapRecord
      );

      for (const { record, mapped } of prioritizedRecords) {
        const ingestResult = await params.ingestRecord(record);
        ingestResults.push(ingestResult);

        if (payload.provider === "salesforce") {
          await recordDeferredSalesforceTaskAuditIfNeeded(input.persistence, {
            record: record as SalesforceRecord,
            ingestResult
          });
        }

        if (
          payload.provider === "gmail" &&
          payload.jobType === "live_ingest" &&
          ingestResult.outcome === "duplicate"
        ) {
          logger.info({
            event: "gmail_live.duplicate_skip",
            messageId: ingestResult.sourceRecordId,
            windowStart: payload.windowStart,
            windowEnd: payload.windowEnd
          });
        }

        if (
          payload.provider === "gmail" &&
          ingestResult.outcome === "deferred" &&
          ingestResult.reason === "gmail_dsn"
        ) {
          const gmailRecord = gmailMessageRecordSchema.safeParse(record);

          if (gmailRecord.success) {
            try {
              const evidenceId = `source-evidence:gmail:gmail.dsn:${gmailRecord.data.recordId}`;
              await input.persistence.repositories.sourceEvidence.append({
                id: evidenceId,
                provider: "gmail",
                providerRecordType: "gmail.dsn",
                providerRecordId: gmailRecord.data.recordId,
                receivedAt: gmailRecord.data.receivedAt,
                occurredAt: gmailRecord.data.occurredAt,
                payloadRef: gmailRecord.data.payloadRef,
                idempotencyKey: `gmail:gmail.dsn:${gmailRecord.data.recordId}`,
                checksum: gmailRecord.data.checksum
              });
            } catch {
              // Replay-safe duplicate evidence writes can be ignored.
            }

            const dsnOriginalMessageId = gmailRecord.data.dsnOriginalMessageId;

            if (
              dsnOriginalMessageId !== null &&
              dsnOriginalMessageId.length > 0
            ) {
              const pending =
                await input.persistence.repositories.pendingOutbounds.findBySentRfc822MessageId(
                  dsnOriginalMessageId
                );

              if (pending !== null && pending.status === "pending") {
                await input.persistence.repositories.pendingOutbounds.markFailed(
                  pending.id,
                  {
                    reason: "bounce",
                    detail: gmailRecord.data.bodyTextPreview.slice(0, 500)
                  }
                );
                logger.info({
                  event: "composer.bounce.matched",
                  pendingOutboundId: pending.id,
                  dsnOriginalMessageId,
                  dsnGmailMessageId: gmailRecord.data.recordId
                });
              } else if (pending === null) {
                logger.info({
                  event: "composer.bounce.unmatched",
                  dsnOriginalMessageId,
                  dsnGmailMessageId: gmailRecord.data.recordId
                });
              }
            }
          }
        }

        if (
          ingestResult.outcome !== "deferred" &&
          ingestResult.outcome !== "quarantined" &&
          ingestResult.canonicalEventId !== null
        ) {
          if (mapped.outcome === "command" && mapped.command.kind === "canonical_event") {
            await recordProjectionSeedOnce(input.persistence, {
              canonicalEventId: mapped.command.input.canonicalEvent.id,
              summary: mapped.command.input.canonicalEvent.summary,
              snippet: mapped.command.input.canonicalEvent.snippet ?? "",
              occurredAt: mapped.command.input.sourceEvidence.receivedAt
            });
          }
        }
      }

      const summary = summarizeIngestResults(ingestResults);
      const freshnessMetrics = calculateFreshnessMetrics(
        payload.provider,
        payload.jobType,
        captured.records as readonly CapturedProviderRecord[]
      );
      await syncState.recordBatchProgress({
        syncStateId: payload.syncStateId,
        scope: "provider",
        provider: payload.provider,
        jobType: payload.jobType,
        cursor: captured.nextCursor,
        checkpoint: captured.checkpoint,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        deadLetterCountIncrement: summary.deadLetterCountIncrement
      });
      const completedSyncState = await syncState.completeWindow({
        syncStateId: payload.syncStateId,
        scope: "provider",
        provider: payload.provider,
        jobType: payload.jobType,
        cursor: captured.nextCursor,
        checkpoint: captured.checkpoint,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        parityPercent: null,
        freshnessP95Seconds: freshnessMetrics.p95Seconds,
        freshnessP99Seconds: freshnessMetrics.p99Seconds,
        completedAt: payload.windowEnd ?? new Date().toISOString()
      });
      const touchedContactIds = Array.from(
        new Set(
          ingestResults.reduce<string[]>((contactIds, result) => {
            if ("contactId" in result && typeof result.contactId === "string") {
              contactIds.push(result.contactId);
            }

            return contactIds;
          }, [])
        )
      );

      if (
        input.revalidateInboxViews !== undefined &&
        touchedContactIds.length > 0
      ) {
        try {
          await input.revalidateInboxViews({
            contactIds: touchedContactIds
          });
        } catch {
          // Revalidation is best effort; the worker should not fail after ingest succeeds.
        }
      }

      return {
        outcome: "succeeded",
        jobType: payload.jobType,
        syncState: completedSyncState,
        summary,
        ingestResults,
        nextCursor: captured.nextCursor,
        checkpoint: captured.checkpoint
      };
    } catch (error) {
      const failure = buildJobFailure(error, payload.attempt, payload.maxAttempts);
      const existingSyncState = await input.persistence.repositories.syncState.findById(
        payload.syncStateId
      );
      const nextConsecutiveFailures =
        (existingSyncState?.consecutiveFailureCount ?? 0) + 1;
      const finalFailure =
        payload.provider === "salesforce" &&
        payload.jobType === "live_ingest" &&
        nextConsecutiveFailures >= CONSECUTIVE_FAILURE_DEAD_LETTER_THRESHOLD
          ? {
              ...failure,
              disposition: "dead_letter" as const,
              retryable: false
            }
          : failure;
      const failedSyncState = await syncState.failWindow({
        syncStateId: payload.syncStateId,
        scope: "provider",
        provider: payload.provider,
        jobType: payload.jobType,
        cursor: payload.cursor,
        checkpoint: payload.checkpoint,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        deadLetterCountIncrement: finalFailure.disposition === "dead_letter" ? 1 : 0,
        deadLettered: finalFailure.disposition === "dead_letter"
      });
      await recordSyncFailureAudit(input.persistence, {
        syncStateId: payload.syncStateId,
        scope: "provider",
        provider: payload.provider,
        jobType: payload.jobType,
        checkpoint: payload.checkpoint,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        failure: finalFailure,
        occurredAt: new Date().toISOString(),
        actorId: "stage1-orchestration"
      });

      return {
        outcome: "failed",
        jobType: payload.jobType,
        syncState: failedSyncState,
        summary: {
          processed: 0,
          normalized: 0,
          duplicate: 0,
          reviewOpened: 0,
          quarantined: 0,
          deferred: 0,
          deadLetterCountIncrement:
            finalFailure.disposition === "dead_letter" ? 1 : 0
        },
        ingestResults: [],
        nextCursor: payload.cursor,
        checkpoint: payload.checkpoint,
        failure: finalFailure
      };
    }
  }

  async function runProjectionRebuildBatch(
    rawPayload: ProjectionRebuildBatchPayload
  ): Promise<Stage1ProjectionRebuildJobOutcome> {
    const payload = projectionRebuildBatchPayloadSchema.parse(rawPayload);
    await syncState.startWindow({
      syncStateId: payload.syncStateId,
      scope: "orchestration",
      provider: null,
      jobType: payload.jobType,
      cursor: null,
      checkpoint: payload.batchId,
      windowStart: null,
      windowEnd: null
    });

    try {
      const contacts =
        payload.contactIds.length > 0
          ? payload.contactIds
          : (await input.persistence.repositories.contacts.listAll()).map(
              (contact) => contact.id
            );
      const rebuiltContactIds = [...contacts].sort((left, right) =>
        left.localeCompare(right)
      );
      const missingProjectionSeeds = new Set<string>();
      const discrepancies: Stage1OperationalDiscrepancy[] = [];
      let rebuiltTimelineRows = 0;
      let rebuiltInboxRows = 0;

      for (const contactId of rebuiltContactIds) {
        const canonicalEvents = [...(
          await input.persistence.repositories.canonicalEvents.listByContactId(
            contactId
          )
        )].sort(compareEventOrder);
        const rebuildInboxProjection =
          payload.projection === "inbox" || payload.projection === "all";

        if (rebuildInboxProjection) {
          await input.persistence.repositories.inboxProjection.deleteByContactId(
            contactId
          );
        }

        for (const event of canonicalEvents) {
          const projectionSeed = await loadProjectionSeed(input.persistence, event);

          if (projectionSeed.source === "fallback") {
            missingProjectionSeeds.add(event.id);
          }

          if (payload.projection === "timeline" || payload.projection === "all") {
            await input.normalization.applyTimelineProjection({
              canonicalEvent: event,
              summary: projectionSeed.summary
            });
            rebuiltTimelineRows += 1;
          }

          if (
            rebuildInboxProjection &&
            isInboxDrivingEvent(event)
          ) {
            await input.normalization.applyInboxProjection({
              canonicalEvent: event,
              snippet: projectionSeed.snippet
            });
            rebuiltInboxRows += 1;
          }
        }

        if (
          payload.includeReviewOverlayRefresh &&
          rebuildInboxProjection
        ) {
          await input.normalization.refreshInboxReviewOverlay({
            contactId
          });
        }
      }

      if (missingProjectionSeeds.size > 0) {
        discrepancies.push({
          code: "projection_seed_missing",
          severity: "warning",
          message:
            "One or more canonical events were rebuilt with fallback summary or snippet values because no durable projection seed audit record was present.",
          entityIds: Array.from(missingProjectionSeeds).sort((left, right) =>
            left.localeCompare(right)
          )
        });
      }

      const completedSyncState = await syncState.completeWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.batchId,
        windowStart: null,
        windowEnd: null,
        parityPercent: null,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        completedAt: new Date().toISOString()
      });

      return {
        outcome: "succeeded",
        jobType: payload.jobType,
        syncState: completedSyncState,
        projection: payload.projection,
        rebuiltContactIds,
        rebuiltTimelineRows,
        rebuiltInboxRows,
        missingProjectionSeeds: Array.from(missingProjectionSeeds).sort(
          (left, right) => left.localeCompare(right)
        ),
        discrepancies,
        failure: null
      };
    } catch (error) {
      const failure = buildJobFailure(error, payload.attempt, payload.maxAttempts);
      const failedSyncState = await syncState.failWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.batchId,
        windowStart: null,
        windowEnd: null,
        deadLetterCountIncrement: failure.disposition === "dead_letter" ? 1 : 0,
        deadLettered: failure.disposition === "dead_letter"
      });
      await recordSyncFailureAudit(input.persistence, {
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        checkpoint: payload.batchId,
        windowStart: null,
        windowEnd: null,
        failure,
        occurredAt: new Date().toISOString(),
        actorId: "stage1-orchestration"
      });

      return {
        outcome: "failed",
        jobType: payload.jobType,
        syncState: failedSyncState,
        projection: payload.projection,
        rebuiltContactIds: [],
        rebuiltTimelineRows: 0,
        rebuiltInboxRows: 0,
        missingProjectionSeeds: [],
        discrepancies: [],
        failure
      };
    }
  }

  async function runParityCheckBatch(
    rawPayload: ParityCheckBatchPayload
  ): Promise<Stage1ParityCheckJobOutcome> {
    const payload = parityCheckBatchPayloadSchema.parse(rawPayload);
    await syncState.startWindow({
      syncStateId: payload.syncStateId,
      scope: "orchestration",
      provider: null,
      jobType: payload.jobType,
      cursor: null,
      checkpoint: payload.checkpointId,
      windowStart: null,
      windowEnd: payload.evaluatedAt
    });

    try {
      const byProvider: Stage1ParityMetricByProvider[] = [];

      for (const provider of payload.providers) {
        byProvider.push({
          provider,
          sourceEvidenceCount:
            await input.persistence.repositories.sourceEvidence.countByProvider(
              provider
            ),
          canonicalEventCount:
            await input.persistence.repositories.canonicalEvents.countByPrimaryProvider(
              provider
            )
        });
      }

      const canonicalEventCount =
        await input.persistence.repositories.canonicalEvents.countAll();
      const timelineProjectionCount =
        await input.persistence.repositories.timelineProjection.countAll();
      const inboxProjectionCount =
        await input.persistence.repositories.inboxProjection.countAll();
      const inboxContactCount =
        await input.persistence.repositories.canonicalEvents.countDistinctInboxContacts();
      const openIdentityCasesByReason = await Promise.all(
        identityResolutionReasonCodeValues.map((reasonCode) =>
          input.persistence.repositories.identityResolutionQueue.listOpenByReasonCode(
            reasonCode
          )
        )
      );
      const openRoutingCasesByReason = await Promise.all(
        routingReviewReasonCodeValues.map((reasonCode) =>
          input.persistence.repositories.routingReviewQueue.listOpenByReasonCode(
            reasonCode
          )
        )
      );
      const openIdentityCaseCount = openIdentityCasesByReason.flat().length;
      const openIdentityConflictCount = openIdentityCasesByReason[
        identityResolutionReasonCodeValues.indexOf("identity_conflict")
      ]?.length ?? 0;
      const openRoutingCaseCount = openRoutingCasesByReason.flat().length;
      const queueRowParityPercent = calculateParityPercent(
        inboxProjectionCount,
        inboxContactCount
      );
      const timelineEventParityPercent = calculateParityPercent(
        timelineProjectionCount,
        canonicalEventCount
      );
      const metrics: Stage1ParityMetrics = {
        byProvider,
        canonicalEventCount,
        timelineProjectionCount,
        inboxProjectionCount,
        inboxContactCount,
        queueRowParityPercent,
        timelineEventParityPercent,
        openIdentityConflictCount,
        openIdentityCaseCount,
        openRoutingCaseCount
      };
      const discrepancies: Stage1OperationalDiscrepancy[] = [];

      if (queueRowParityPercent < payload.queueParityThresholdPercent) {
        discrepancies.push({
          code: "queue_row_parity_below_threshold",
          severity: "blocking",
          message: `Inbox row parity ${formatPercent(queueRowParityPercent)}% is below the configured threshold of ${formatPercent(payload.queueParityThresholdPercent)}%.`,
          entityIds: []
        });
      }

      if (timelineEventParityPercent < payload.timelineParityThresholdPercent) {
        discrepancies.push({
          code: "timeline_event_parity_below_threshold",
          severity: "blocking",
          message: `Timeline parity ${formatPercent(timelineEventParityPercent)}% is below the configured threshold of ${formatPercent(payload.timelineParityThresholdPercent)}%.`,
          entityIds: []
        });
      }

      if (openIdentityConflictCount > 0) {
        discrepancies.push({
          code: "identity_conflict_backlog",
          severity: "blocking",
          message:
            "One or more open identity_conflict cases remain in the manual review queue.",
          entityIds: []
        });
      }

      const allContacts = await input.persistence.repositories.contacts.listAll();
      const sampledContactIds =
        payload.sampleContactIds.length > 0
          ? [...payload.sampleContactIds]
          : allContacts.slice(0, payload.sampleSize).map((contact) => contact.id);
      const sampledContacts: Stage1SampledParityContact[] = [];
      const sampledTimelineMismatchIds: string[] = [];
      const sampledInboxMismatchIds: string[] = [];

      for (const contactId of sampledContactIds) {
        const canonicalEvents = await input.persistence.repositories.canonicalEvents.listByContactId(
          contactId
        );
        const timelineRows = await input.persistence.repositories.timelineProjection.listByContactId(
          contactId
        );
        const inboxRow = await input.persistence.repositories.inboxProjection.findByContactId(
          contactId
        );
        const inboxDrivingEventCount = canonicalEvents.filter((event) =>
          isInboxDrivingEvent(event)
        ).length;

        sampledContacts.push({
          contactId,
          canonicalEventCount: canonicalEvents.length,
          timelineRowCount: timelineRows.length,
          hasInboxRow: inboxRow !== null,
          inboxDrivingEventCount
        });

        if (timelineRows.length !== canonicalEvents.length) {
          sampledTimelineMismatchIds.push(contactId);
        }

        if (
          (inboxDrivingEventCount > 0 && inboxRow === null) ||
          (inboxDrivingEventCount === 0 && inboxRow !== null)
        ) {
          sampledInboxMismatchIds.push(contactId);
        }
      }

      if (sampledTimelineMismatchIds.length > 0) {
        discrepancies.push({
          code: "sampled_timeline_projection_mismatch",
          severity: "warning",
          message:
            "At least one sampled contact has a timeline projection row count that does not match canonical event count.",
          entityIds: sampledTimelineMismatchIds
        });
      }

      if (sampledInboxMismatchIds.length > 0) {
        discrepancies.push({
          code: "sampled_inbox_projection_mismatch",
          severity: "warning",
          message:
            "At least one sampled contact has an inbox projection mismatch against inbox-driving canonical events.",
          entityIds: sampledInboxMismatchIds
        });
      }

      const auditEvidence = await input.persistence.recordAuditEvidence({
        id: `audit:parity:${payload.checkpointId}`,
        actorType: "worker",
        actorId: "stage1-orchestration",
        action: "record_parity_snapshot",
        entityType: "parity_checkpoint",
        entityId: payload.checkpointId,
        occurredAt: payload.evaluatedAt,
        result: "recorded",
        policyCode: paritySnapshotPolicyCode,
        metadataJson: {
          queueRowParityPercent,
          timelineEventParityPercent,
          canonicalEventCount,
          timelineProjectionCount,
          inboxProjectionCount
        }
      });
      const completedSyncState = await syncState.completeWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        parityPercent: Math.min(queueRowParityPercent, timelineEventParityPercent),
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        completedAt: payload.evaluatedAt
      });

      return {
        outcome: "succeeded",
        jobType: payload.jobType,
        syncState: completedSyncState,
        checkpointId: payload.checkpointId,
        metrics,
        sampledContacts,
        discrepancies,
        auditEvidenceId: auditEvidence.id,
        failure: null
      };
    } catch (error) {
      const failure = buildJobFailure(error, payload.attempt, payload.maxAttempts);
      const failedSyncState = await syncState.failWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        deadLetterCountIncrement: failure.disposition === "dead_letter" ? 1 : 0,
        deadLettered: failure.disposition === "dead_letter"
      });
      await recordSyncFailureAudit(input.persistence, {
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        failure,
        occurredAt: payload.evaluatedAt,
        actorId: "stage1-orchestration"
      });

      return {
        outcome: "failed",
        jobType: payload.jobType,
        syncState: failedSyncState,
        checkpointId: payload.checkpointId,
        metrics: {
          byProvider: [],
          canonicalEventCount: 0,
          timelineProjectionCount: 0,
          inboxProjectionCount: 0,
          inboxContactCount: 0,
          queueRowParityPercent: 0,
          timelineEventParityPercent: 0,
          openIdentityConflictCount: 0,
          openIdentityCaseCount: 0,
          openRoutingCaseCount: 0
        },
        sampledContacts: [],
        discrepancies: [],
        auditEvidenceId: null,
        failure
      };
    }
  }

  async function runCutoverCheckpointBatch(
    rawPayload: CutoverCheckpointBatchPayload
  ): Promise<Stage1CutoverCheckpointJobOutcome> {
    const payload = cutoverCheckpointBatchPayloadSchema.parse(rawPayload);
    await syncState.startWindow({
      syncStateId: payload.syncStateId,
      scope: "orchestration",
      provider: null,
      jobType: payload.jobType,
      cursor: null,
      checkpoint: payload.checkpointId,
      windowStart: null,
      windowEnd: payload.evaluatedAt
    });

    try {
      const parity = await runParityCheckBatch(
        parityCheckBatchPayloadSchema.parse({
          version: payload.version,
          jobId: `${payload.jobId}:parity`,
          correlationId: payload.correlationId,
          traceId: payload.traceId,
          batchId: `${payload.batchId}:parity`,
          syncStateId: `${payload.syncStateId}:parity`,
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
          jobType: "parity_snapshot",
          checkpointId: payload.checkpointId,
          providers: payload.providers,
          sampleContactIds: [],
          sampleSize: 25,
          queueParityThresholdPercent: 99.5,
          timelineParityThresholdPercent: 99,
          evaluatedAt: payload.evaluatedAt
        })
      );
      const syncSnapshots: Stage1CutoverSyncSnapshot[] = [];
      const discrepancies = [...parity.discrepancies];

      for (const provider of payload.providers) {
        const historicalBackfill =
          await input.persistence.repositories.syncState.findLatest({
            scope: "provider",
            provider,
            jobType: "historical_backfill"
          });
        const liveIngest = await input.persistence.repositories.syncState.findLatest(
          {
            scope: "provider",
            provider,
            jobType: "live_ingest"
          }
        );

        syncSnapshots.push({
          provider,
          historicalBackfill,
          liveIngest
        });

        if (
          payload.requireHistoricalBackfillComplete &&
          historicalBackfill?.status !== "succeeded"
        ) {
          discrepancies.push({
            code: "historical_backfill_incomplete",
            severity: "blocking",
            message: `Provider ${provider} does not yet have a succeeded historical backfill checkpoint.`,
            entityIds: historicalBackfill === null ? [] : [historicalBackfill.id]
          });
        }

        if (payload.requireLiveIngestCoverage && liveIngest === null) {
          discrepancies.push({
            code: "live_ingest_missing",
            severity: "blocking",
            message: `Provider ${provider} has no live ingest sync state yet.`,
            entityIds: []
          });
        } else if (
          payload.requireLiveIngestCoverage &&
          liveIngest?.status !== "succeeded"
        ) {
          discrepancies.push({
            code: "live_ingest_incomplete",
            severity: "blocking",
            message: `Provider ${provider} does not yet have a succeeded live ingest checkpoint.`,
            entityIds: liveIngest === null ? [] : [liveIngest.id]
          });
        }

        if (liveIngest === null) {
          continue;
        }

        if (
          provider === "gmail" ||
          provider === "simpletexting"
        ) {
          if (liveIngest.freshnessP95Seconds === null) {
            discrepancies.push({
              code: "comms_freshness_p95_unavailable",
              severity: "blocking",
              message: `Provider ${provider} has no live comms freshness p95 metric recorded yet.`,
              entityIds: [liveIngest.id]
            });
          } else if (
            liveIngest.freshnessP95Seconds >
            gmailAndSimpleTextingP95ThresholdSeconds
          ) {
            discrepancies.push({
              code: "comms_freshness_p95_above_threshold",
              severity: "blocking",
              message: `Provider ${provider} has live comms freshness p95 ${String(liveIngest.freshnessP95Seconds)}s above the ${String(gmailAndSimpleTextingP95ThresholdSeconds)}s cutover threshold.`,
              entityIds: [liveIngest.id]
            });
          }

          if (liveIngest.freshnessP99Seconds === null) {
            discrepancies.push({
              code: "comms_freshness_p99_unavailable",
              severity: "blocking",
              message: `Provider ${provider} has no live comms freshness p99 metric recorded yet.`,
              entityIds: [liveIngest.id]
            });
          } else if (
            liveIngest.freshnessP99Seconds >
            gmailAndSimpleTextingP99ThresholdSeconds
          ) {
            discrepancies.push({
              code: "comms_freshness_p99_above_threshold",
              severity: "blocking",
              message: `Provider ${provider} has live comms freshness p99 ${String(liveIngest.freshnessP99Seconds)}s above the ${String(gmailAndSimpleTextingP99ThresholdSeconds)}s cutover threshold.`,
              entityIds: [liveIngest.id]
            });
          }
        }

        if (provider === "salesforce") {
          if (liveIngest.freshnessP95Seconds === null) {
            discrepancies.push({
              code: "lifecycle_freshness_p95_unavailable",
              severity: "blocking",
              message:
                "Salesforce has no lifecycle freshness p95 metric recorded yet.",
              entityIds: [liveIngest.id]
            });
          } else if (
            liveIngest.freshnessP95Seconds >
            salesforceLifecycleP95ThresholdSeconds
          ) {
            discrepancies.push({
              code: "lifecycle_freshness_p95_above_threshold",
              severity: "blocking",
              message: `Salesforce lifecycle freshness p95 ${String(liveIngest.freshnessP95Seconds)}s is above the ${String(salesforceLifecycleP95ThresholdSeconds)}s cutover threshold.`,
              entityIds: [liveIngest.id]
            });
          }
        }
      }

      const auditEvidence = await input.persistence.recordAuditEvidence({
        id: `audit:cutover:${payload.checkpointId}`,
        actorType: "worker",
        actorId: "stage1-orchestration",
        action: "record_cutover_checkpoint",
        entityType: "cutover_checkpoint",
        entityId: payload.checkpointId,
        occurredAt: payload.evaluatedAt,
        result: "recorded",
        policyCode: cutoverCheckpointPolicyCode,
        metadataJson: {
          providerCount: payload.providers.length,
          discrepancyCount: discrepancies.length,
          parityCheckpointId: parity.checkpointId
        }
      });
      const ready = discrepancies.every(
        (discrepancy) => discrepancy.severity !== "blocking"
      );
      const completedSyncState = await syncState.completeWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        parityPercent: parity.metrics.timelineEventParityPercent,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        completedAt: payload.evaluatedAt
      });

      return {
        outcome: "succeeded",
        jobType: payload.jobType,
        syncState: completedSyncState,
        checkpointId: payload.checkpointId,
        ready,
        parity,
        syncSnapshots,
        discrepancies,
        auditEvidenceId: auditEvidence.id,
        failure: null
      };
    } catch (error) {
      const failure = buildJobFailure(error, payload.attempt, payload.maxAttempts);
      const failedSyncState = await syncState.failWindow({
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        cursor: null,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        deadLetterCountIncrement: failure.disposition === "dead_letter" ? 1 : 0,
        deadLettered: failure.disposition === "dead_letter"
      });
      await recordSyncFailureAudit(input.persistence, {
        syncStateId: payload.syncStateId,
        scope: "orchestration",
        provider: null,
        jobType: payload.jobType,
        checkpoint: payload.checkpointId,
        windowStart: null,
        windowEnd: payload.evaluatedAt,
        failure,
        occurredAt: payload.evaluatedAt,
        actorId: "stage1-orchestration"
      });

      return {
        outcome: "failed",
        jobType: payload.jobType,
        syncState: failedSyncState,
        checkpointId: payload.checkpointId,
        ready: false,
        parity: {
          outcome: "failed",
          jobType: "parity_snapshot",
          syncState: failedSyncState,
          checkpointId: payload.checkpointId,
          metrics: {
            byProvider: [],
            canonicalEventCount: 0,
            timelineProjectionCount: 0,
            inboxProjectionCount: 0,
            inboxContactCount: 0,
            queueRowParityPercent: 0,
            timelineEventParityPercent: 0,
            openIdentityConflictCount: 0,
            openIdentityCaseCount: 0,
            openRoutingCaseCount: 0
          },
          sampledContacts: [],
          discrepancies: [],
          auditEvidenceId: null,
          failure
        },
        syncSnapshots: [],
        discrepancies: [],
        auditEvidenceId: null,
        failure
      };
    }
  }

  return {
    planGmailLiveCaptureBatch,
    planSalesforceLiveCaptureBatch,
    runGmailHistoricalCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          gmailHistoricalCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.gmail.captureHistoricalBatch(batchPayload),
        ingestRecord: (record) => input.ingest.ingestGmailHistoricalRecord(record),
        mapRecord: mapGmailRecord
      });
    },

    runGmailLiveCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) => gmailLiveCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) => input.capture.gmail.captureLiveBatch(batchPayload),
        ingestRecord: (record) => input.ingest.ingestGmailLiveRecord(record),
        mapRecord: mapGmailRecord
      });
    },

    runSalesforceHistoricalCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          salesforceHistoricalCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.salesforce.captureHistoricalBatch(batchPayload),
        ingestRecord: (record) =>
          input.ingest.ingestSalesforceHistoricalRecord(record),
        mapRecord: mapSalesforceRecord
      });
    },

    runSalesforceLiveCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          salesforceLiveCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.salesforce.captureLiveBatch(batchPayload),
        ingestRecord: (record) => input.ingest.ingestSalesforceLiveRecord(record),
        mapRecord: mapSalesforceRecord
      });
    },

    runSimpleTextingHistoricalCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          simpleTextingHistoricalCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.simpleTexting.captureHistoricalBatch(batchPayload),
        ingestRecord: (record) =>
          input.ingest.ingestSimpleTextingHistoricalRecord(record),
        mapRecord: mapSimpleTextingRecord
      });
    },

    runSimpleTextingLiveCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          simpleTextingLiveCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.simpleTexting.captureLiveBatch(batchPayload),
        ingestRecord: (record) =>
          input.ingest.ingestSimpleTextingLiveRecord(record),
        mapRecord: mapSimpleTextingRecord
      });
    },

    runMailchimpHistoricalCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          mailchimpHistoricalCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.mailchimp.captureHistoricalBatch(batchPayload),
        ingestRecord: (record) => input.ingest.ingestMailchimpHistoricalRecord(record),
        mapRecord: mapMailchimpRecord
      });
    },

    runMailchimpTransitionCaptureBatch: (payload) => {
      return runCapturedBatch({
        payload,
        parse: (rawPayload) =>
          mailchimpTransitionCaptureBatchPayloadSchema.parse(rawPayload),
        capture: (batchPayload) =>
          input.capture.mailchimp.captureTransitionBatch(batchPayload),
        ingestRecord: (record) => input.ingest.ingestMailchimpTransitionRecord(record),
        mapRecord: mapMailchimpRecord
      });
    },

    runReplayBatch: (rawPayload) => {
      const payload = replayBatchPayloadSchema.parse(rawPayload);

      return runCapturedBatch({
        payload,
        parse: (parsedPayload) => replayBatchPayloadSchema.parse(parsedPayload),
        capture: (parsedPayload) =>
          captureRecordsForReplay(
            input.capture,
            input.persistence,
            input.gmailHistoricalReplay,
            parsedPayload
          ),
        ingestRecord: (record) => {
          switch (payload.provider) {
            case "gmail":
              return payload.mode === "historical"
                ? input.ingest.ingestGmailHistoricalRecord(record as GmailRecord)
                : input.ingest.ingestGmailLiveRecord(record as GmailRecord);
            case "salesforce":
              return payload.mode === "historical"
                ? input.ingest.ingestSalesforceHistoricalRecord(
                    record as SalesforceRecord
                  )
                : input.ingest.ingestSalesforceLiveRecord(
                    record as SalesforceRecord
                  );
            case "simpletexting":
              return payload.mode === "historical"
                ? input.ingest.ingestSimpleTextingHistoricalRecord(
                    record as SimpleTextingRecord
                  )
                : input.ingest.ingestSimpleTextingLiveRecord(
                    record as SimpleTextingRecord
                  );
            case "mailchimp":
              return payload.mode === "historical"
                ? input.ingest.ingestMailchimpHistoricalRecord(
                    record as MailchimpRecord
                  )
                : input.ingest.ingestMailchimpTransitionRecord(
                    record as MailchimpRecord
                  );
            case "manual":
              throw new Stage1NonRetryableJobError(
                "Manual note provider is not supported for replay ingest batches."
              );
          }
        },
        mapRecord: (record) => getMappedResultForRecord(payload.provider, record)
      });
    },

    runProjectionRebuildBatch,
    runParityCheckBatch,
    runCutoverCheckpointBatch
  };
}
