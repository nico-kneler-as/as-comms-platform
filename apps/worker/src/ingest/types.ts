import type {
  IdentityResolutionReasonCode,
  Provider,
  QuarantineReasonCode,
  RoutingReviewReasonCode
} from "@as-comms/contracts";

export const stage1IngestModeValues = [
  "historical",
  "live",
  "transition_live"
] as const;
export type Stage1IngestMode = (typeof stage1IngestModeValues)[number];

export type Stage1IngestReviewQueue = "identity" | "routing";

export interface Stage1IngestReviewCaseSummary {
  readonly queue: Stage1IngestReviewQueue;
  readonly caseId: string;
  readonly reasonCode: IdentityResolutionReasonCode | RoutingReviewReasonCode;
}

interface Stage1IngestResultBase {
  readonly ingestMode: Stage1IngestMode;
  readonly provider: Provider;
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
}

export interface Stage1NormalizedIngestResult extends Stage1IngestResultBase {
  readonly outcome: "normalized";
  readonly commandKind: "contact_graph" | "canonical_event";
  readonly sourceEvidenceId: string | null;
  readonly canonicalEventId: string | null;
  readonly contactId: string | null;
}

export interface Stage1DuplicateIngestResult extends Stage1IngestResultBase {
  readonly outcome: "duplicate";
  readonly commandKind: "canonical_event";
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly contactId: string;
}

export interface Stage1ReviewOpenedIngestResult
  extends Stage1IngestResultBase {
  readonly outcome: "review_opened";
  readonly commandKind: "canonical_event";
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string | null;
  readonly contactId: string | null;
  readonly reviewCases: readonly Stage1IngestReviewCaseSummary[];
}

export interface Stage1QuarantinedIngestResult extends Stage1IngestResultBase {
  readonly outcome: "quarantined";
  readonly commandKind: "canonical_event";
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string | null;
  readonly contactId: string | null;
  readonly reasonCode: QuarantineReasonCode;
  readonly explanation: string;
  readonly auditEvidenceId: string;
}

export interface Stage1DeferredIngestResult extends Stage1IngestResultBase {
  readonly outcome: "deferred";
  readonly reason:
    | "unsupported_record_type"
    | "deferred_record_family"
    | "skipped_by_policy"
    | "gmail_dsn";
  readonly detail: string;
}

export type Stage1IngestResult =
  | Stage1NormalizedIngestResult
  | Stage1DuplicateIngestResult
  | Stage1ReviewOpenedIngestResult
  | Stage1QuarantinedIngestResult
  | Stage1DeferredIngestResult;
