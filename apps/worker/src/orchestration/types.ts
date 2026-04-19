import type {
  CutoverCheckpointBatchPayload,
  GmailHistoricalCaptureBatchPayload,
  GmailLiveCaptureBatchPayload,
  MailchimpHistoricalCaptureBatchPayload,
  MailchimpTransitionCaptureBatchPayload,
  ParityCheckBatchPayload,
  ProjectionRebuildBatchPayload,
  Provider,
  ReplayBatchPayload,
  SalesforceHistoricalCaptureBatchPayload,
  SalesforceLiveCaptureBatchPayload,
  SimpleTextingHistoricalCaptureBatchPayload,
  SimpleTextingLiveCaptureBatchPayload,
  SyncJobType,
  SyncStateRecord
} from "@as-comms/contracts";
import type {
  GmailRecord,
  MailchimpRecord,
  SalesforceRecord,
  SimpleTextingRecord
} from "@as-comms/integrations";

import type { Stage1IngestResult } from "../ingest/types.js";

export interface Stage1CapturedBatch<TRecord> {
  readonly records: readonly TRecord[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
}

export interface GmailCapturePort {
  captureHistoricalBatch(
    payload: GmailHistoricalCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<GmailRecord>>;
  captureLiveBatch(
    payload: GmailLiveCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<GmailRecord>>;
}

export interface SalesforceCapturePort {
  captureHistoricalBatch(
    payload: SalesforceHistoricalCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<SalesforceRecord>>;
  captureLiveBatch(
    payload: SalesforceLiveCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<SalesforceRecord>>;
}

export interface SimpleTextingCapturePort {
  captureHistoricalBatch(
    payload: SimpleTextingHistoricalCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<SimpleTextingRecord>>;
  captureLiveBatch(
    payload: SimpleTextingLiveCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<SimpleTextingRecord>>;
}

export interface MailchimpCapturePort {
  captureHistoricalBatch(
    payload: MailchimpHistoricalCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<MailchimpRecord>>;
  captureTransitionBatch(
    payload: MailchimpTransitionCaptureBatchPayload
  ): Promise<Stage1CapturedBatch<MailchimpRecord>>;
}

export interface Stage1ProviderCapturePorts {
  readonly gmail: GmailCapturePort;
  readonly salesforce: SalesforceCapturePort;
  readonly simpleTexting: SimpleTextingCapturePort;
  readonly mailchimp: MailchimpCapturePort;
}

export type Stage1ProjectionSeedSource = "audit" | "fallback";

export interface Stage1ProjectionSeed {
  readonly summary: string;
  readonly snippet: string;
  readonly source: Stage1ProjectionSeedSource;
}

export type Stage1DiscrepancySeverity = "info" | "warning" | "blocking";

export interface Stage1OperationalDiscrepancy {
  readonly code: string;
  readonly severity: Stage1DiscrepancySeverity;
  readonly message: string;
  readonly entityIds: readonly string[];
}

export type Stage1FailureDisposition =
  | "retryable"
  | "non_retryable"
  | "dead_letter";

export interface Stage1JobFailure {
  readonly disposition: Stage1FailureDisposition;
  readonly retryable: boolean;
  readonly message: string;
}

export interface Stage1IngestBatchSummary {
  readonly processed: number;
  readonly normalized: number;
  readonly duplicate: number;
  readonly reviewOpened: number;
  readonly quarantined: number;
  readonly deferred: number;
  readonly deadLetterCountIncrement: number;
}

interface Stage1JobOutcomeBase {
  readonly jobType: SyncJobType;
  readonly syncState: SyncStateRecord;
}

export interface Stage1CaptureJobSuccess extends Stage1JobOutcomeBase {
  readonly outcome: "succeeded";
  readonly summary: Stage1IngestBatchSummary;
  readonly ingestResults: readonly Stage1IngestResult[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
}

export interface Stage1CaptureJobFailure extends Stage1JobOutcomeBase {
  readonly outcome: "failed";
  readonly summary: Stage1IngestBatchSummary;
  readonly ingestResults: readonly Stage1IngestResult[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
  readonly failure: Stage1JobFailure;
}

export type Stage1CaptureJobOutcome =
  | Stage1CaptureJobSuccess
  | Stage1CaptureJobFailure;

export interface Stage1ProjectionRebuildJobOutcome extends Stage1JobOutcomeBase {
  readonly outcome: "succeeded" | "failed";
  readonly projection: ProjectionRebuildBatchPayload["projection"];
  readonly rebuiltContactIds: readonly string[];
  readonly rebuiltTimelineRows: number;
  readonly rebuiltInboxRows: number;
  readonly missingProjectionSeeds: readonly string[];
  readonly discrepancies: readonly Stage1OperationalDiscrepancy[];
  readonly failure: Stage1JobFailure | null;
}

export interface Stage1SampledParityContact {
  readonly contactId: string;
  readonly canonicalEventCount: number;
  readonly timelineRowCount: number;
  readonly hasInboxRow: boolean;
  readonly inboxDrivingEventCount: number;
}

export interface Stage1ParityMetricByProvider {
  readonly provider: Provider;
  readonly sourceEvidenceCount: number;
  readonly canonicalEventCount: number;
}

export interface Stage1ParityMetrics {
  readonly byProvider: readonly Stage1ParityMetricByProvider[];
  readonly canonicalEventCount: number;
  readonly timelineProjectionCount: number;
  readonly inboxProjectionCount: number;
  readonly inboxContactCount: number;
  readonly queueRowParityPercent: number;
  readonly timelineEventParityPercent: number;
  readonly openIdentityConflictCount: number;
  readonly openIdentityCaseCount: number;
  readonly openRoutingCaseCount: number;
}

export interface Stage1ParityCheckJobOutcome extends Stage1JobOutcomeBase {
  readonly outcome: "succeeded" | "failed";
  readonly checkpointId: string;
  readonly metrics: Stage1ParityMetrics;
  readonly sampledContacts: readonly Stage1SampledParityContact[];
  readonly discrepancies: readonly Stage1OperationalDiscrepancy[];
  readonly auditEvidenceId: string | null;
  readonly failure: Stage1JobFailure | null;
}

export interface Stage1CutoverSyncSnapshot {
  readonly provider: Provider;
  readonly historicalBackfill: SyncStateRecord | null;
  readonly liveIngest: SyncStateRecord | null;
}

export interface Stage1CutoverCheckpointJobOutcome extends Stage1JobOutcomeBase {
  readonly outcome: "succeeded" | "failed";
  readonly checkpointId: string;
  readonly ready: boolean;
  readonly parity: Stage1ParityCheckJobOutcome;
  readonly syncSnapshots: readonly Stage1CutoverSyncSnapshot[];
  readonly discrepancies: readonly Stage1OperationalDiscrepancy[];
  readonly auditEvidenceId: string | null;
  readonly failure: Stage1JobFailure | null;
}

export interface Stage1WorkerOrchestrationService {
  planGmailLiveCaptureBatch(
    now?: Date
  ): Promise<GmailLiveCaptureBatchPayload | null>;
  planSalesforceLiveCaptureBatch(
    now?: Date
  ): Promise<SalesforceLiveCaptureBatchPayload | null>;
  runGmailHistoricalCaptureBatch(
    payload: GmailHistoricalCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runGmailLiveCaptureBatch(
    payload: GmailLiveCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runSalesforceHistoricalCaptureBatch(
    payload: SalesforceHistoricalCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runSalesforceLiveCaptureBatch(
    payload: SalesforceLiveCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runSimpleTextingHistoricalCaptureBatch(
    payload: SimpleTextingHistoricalCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runSimpleTextingLiveCaptureBatch(
    payload: SimpleTextingLiveCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runMailchimpHistoricalCaptureBatch(
    payload: MailchimpHistoricalCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runMailchimpTransitionCaptureBatch(
    payload: MailchimpTransitionCaptureBatchPayload
  ): Promise<Stage1CaptureJobOutcome>;
  runReplayBatch(payload: ReplayBatchPayload): Promise<Stage1CaptureJobOutcome>;
  runProjectionRebuildBatch(
    payload: ProjectionRebuildBatchPayload
  ): Promise<Stage1ProjectionRebuildJobOutcome>;
  runParityCheckBatch(
    payload: ParityCheckBatchPayload
  ): Promise<Stage1ParityCheckJobOutcome>;
  runCutoverCheckpointBatch(
    payload: CutoverCheckpointBatchPayload
  ): Promise<Stage1CutoverCheckpointJobOutcome>;
}
