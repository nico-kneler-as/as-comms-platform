import type {
  GmailRecord,
  MailchimpRecord,
  ProviderMappingResult,
  SalesforceRecord,
  SimpleTextingRecord
} from "@as-comms/integrations";
import {
  mapGmailRecord,
  mapMailchimpRecord,
  mapSalesforceRecord,
  mapSimpleTextingRecord
} from "@as-comms/integrations";
import type {
  NormalizedCanonicalEventResult,
  NormalizedContactGraphResult,
  Stage1NormalizationService
} from "@as-comms/domain";

import type {
  Stage1DeferredIngestResult,
  Stage1DuplicateIngestResult,
  Stage1IngestMode,
  Stage1IngestResult,
  Stage1IngestReviewCaseSummary,
  Stage1NormalizedIngestResult,
  Stage1QuarantinedIngestResult,
  Stage1ReviewOpenedIngestResult
} from "./types.js";

export type Stage1IngestNormalizationPort = Pick<
  Stage1NormalizationService,
  "applyNormalizedCanonicalEvent" | "upsertNormalizedContactGraph"
>;

export interface Stage1IngestService {
  ingestGmailHistoricalRecord(record: GmailRecord): Promise<Stage1IngestResult>;
  ingestGmailLiveRecord(record: GmailRecord): Promise<Stage1IngestResult>;
  ingestSalesforceHistoricalRecord(
    record: SalesforceRecord
  ): Promise<Stage1IngestResult>;
  ingestSalesforceLiveRecord(
    record: SalesforceRecord
  ): Promise<Stage1IngestResult>;
  ingestSimpleTextingHistoricalRecord(
    record: SimpleTextingRecord
  ): Promise<Stage1IngestResult>;
  ingestSimpleTextingLiveRecord(
    record: SimpleTextingRecord
  ): Promise<Stage1IngestResult>;
  ingestMailchimpHistoricalRecord(
    record: MailchimpRecord
  ): Promise<Stage1IngestResult>;
  ingestMailchimpTransitionRecord(
    record: MailchimpRecord
  ): Promise<Stage1IngestResult>;
}

function buildReviewCases(
  result: NormalizedCanonicalEventResult
): Stage1IngestReviewCaseSummary[] {
  switch (result.outcome) {
    case "needs_identity_review":
      return [
        {
          queue: "identity",
          caseId: result.identityCase.id,
          reasonCode: result.identityCase.reasonCode
        }
      ];
    case "applied":
    case "duplicate": {
      const reviewCases: Stage1IngestReviewCaseSummary[] = [];

      if (result.identityCase !== null) {
        reviewCases.push({
          queue: "identity",
          caseId: result.identityCase.id,
          reasonCode: result.identityCase.reasonCode
        });
      }

      if (result.routingCase !== null) {
        reviewCases.push({
          queue: "routing",
          caseId: result.routingCase.id,
          reasonCode: result.routingCase.reasonCode
        });
      }

      return reviewCases;
    }
    case "quarantined":
      return [];
  }
}

function mapDeferredResult(
  input: ProviderMappingResult & { readonly outcome: "deferred" },
  ingestMode: Stage1IngestMode
): Stage1DeferredIngestResult {
  return {
    outcome: "deferred",
    ingestMode,
    provider: input.provider,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    reason: input.reason,
    detail: input.detail
  };
}

function mapContactGraphResult(input: {
  readonly ingestMode: Stage1IngestMode;
  readonly mapped: ProviderMappingResult & { readonly outcome: "command" };
  readonly result: NormalizedContactGraphResult;
}): Stage1NormalizedIngestResult {
  return {
    outcome: "normalized",
    ingestMode: input.ingestMode,
    provider: input.mapped.provider,
    sourceRecordType: input.mapped.sourceRecordType,
    sourceRecordId: input.mapped.sourceRecordId,
    commandKind: "contact_graph",
    sourceEvidenceId: null,
    canonicalEventId: null,
    contactId: input.result.contact.id
  };
}

function mapCanonicalEventResult(input: {
  readonly ingestMode: Stage1IngestMode;
  readonly mapped: ProviderMappingResult & { readonly outcome: "command" };
  readonly result: NormalizedCanonicalEventResult;
}):
  | Stage1NormalizedIngestResult
  | Stage1DuplicateIngestResult
  | Stage1ReviewOpenedIngestResult
  | Stage1QuarantinedIngestResult {
  const base = {
    ingestMode: input.ingestMode,
    provider: input.mapped.provider,
    sourceRecordType: input.mapped.sourceRecordType,
    sourceRecordId: input.mapped.sourceRecordId,
    commandKind: "canonical_event" as const
  };

  switch (input.result.outcome) {
    case "applied": {
      const reviewCases = buildReviewCases(input.result);

      if (reviewCases.length > 0) {
        return {
          ...base,
          outcome: "review_opened",
          sourceEvidenceId: input.result.sourceEvidence.id,
          canonicalEventId: input.result.canonicalEvent.id,
          contactId: input.result.canonicalEvent.contactId,
          reviewCases
        };
      }

      return {
        ...base,
        outcome: "normalized",
        sourceEvidenceId: input.result.sourceEvidence.id,
        canonicalEventId: input.result.canonicalEvent.id,
        contactId: input.result.canonicalEvent.contactId
      };
    }
    case "duplicate": {
      const reviewCases = buildReviewCases(input.result);

      if (reviewCases.length > 0) {
        return {
          ...base,
          outcome: "review_opened",
          sourceEvidenceId: input.result.sourceEvidence.id,
          canonicalEventId: input.result.canonicalEvent.id,
          contactId: input.result.canonicalEvent.contactId,
          reviewCases
        };
      }

      return {
        ...base,
        outcome: "duplicate",
        sourceEvidenceId: input.result.sourceEvidence.id,
        canonicalEventId: input.result.canonicalEvent.id,
        contactId: input.result.canonicalEvent.contactId
      };
    }
    case "needs_identity_review":
      return {
        ...base,
        outcome: "review_opened",
        sourceEvidenceId: input.result.sourceEvidence.id,
        canonicalEventId: null,
        contactId: input.result.identityCase.anchoredContactId,
        reviewCases: buildReviewCases(input.result)
      };
    case "quarantined":
      return {
        ...base,
        outcome: "quarantined",
        sourceEvidenceId: input.result.sourceEvidence.id,
        canonicalEventId: input.result.existingCanonicalEvent?.id ?? null,
        contactId: input.result.existingCanonicalEvent?.contactId ?? null,
        reasonCode: input.result.reasonCode,
        explanation: input.result.explanation,
        auditEvidenceId: input.result.auditEvidence.id
      };
  }
}

async function executeMappedCommand(
  normalization: Stage1IngestNormalizationPort,
  ingestMode: Stage1IngestMode,
  mapped: ProviderMappingResult
): Promise<Stage1IngestResult> {
  if (mapped.outcome === "deferred") {
    return mapDeferredResult(mapped, ingestMode);
  }

  const { command } = mapped;

  if (command.kind === "contact_graph") {
    return mapContactGraphResult({
      ingestMode,
      mapped,
      result: await normalization.upsertNormalizedContactGraph(command.input)
    });
  }

  return mapCanonicalEventResult({
    ingestMode,
    mapped,
    result: await normalization.applyNormalizedCanonicalEvent(command.input)
  });
}

async function ingestRecord<TRecord>(
  normalization: Stage1IngestNormalizationPort,
  input: {
    readonly ingestMode: Stage1IngestMode;
    readonly mapper: (record: TRecord) => ProviderMappingResult;
    readonly record: TRecord;
  }
): Promise<Stage1IngestResult> {
  return executeMappedCommand(
    normalization,
    input.ingestMode,
    input.mapper(input.record)
  );
}

export function createStage1IngestService(
  normalization: Stage1IngestNormalizationPort
): Stage1IngestService {
  return {
    ingestGmailHistoricalRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "historical",
        mapper: mapGmailRecord,
        record
      });
    },

    ingestGmailLiveRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "live",
        mapper: mapGmailRecord,
        record
      });
    },

    ingestSalesforceHistoricalRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "historical",
        mapper: mapSalesforceRecord,
        record
      });
    },

    ingestSalesforceLiveRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "live",
        mapper: mapSalesforceRecord,
        record
      });
    },

    ingestSimpleTextingHistoricalRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "historical",
        mapper: mapSimpleTextingRecord,
        record
      });
    },

    ingestSimpleTextingLiveRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "live",
        mapper: mapSimpleTextingRecord,
        record
      });
    },

    ingestMailchimpHistoricalRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "historical",
        mapper: mapMailchimpRecord,
        record
      });
    },

    ingestMailchimpTransitionRecord(record) {
      return ingestRecord(normalization, {
        ingestMode: "transition_live",
        mapper: mapMailchimpRecord,
        record
      });
    }
  };
}
