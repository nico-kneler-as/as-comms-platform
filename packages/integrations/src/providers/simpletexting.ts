import { z } from "zod";

import {
  type CanonicalEventType,
  type NormalizedCanonicalEventIntake
} from "@as-comms/contracts";

import {
  createCanonicalEventCommand,
  createCommandMappingResult,
  createDeferredMappingResult,
  supportingProviderRecordSchema,
  type ProviderMappingResult
} from "../provider-types.js";
import {
  buildCanonicalEventId,
  buildCanonicalEventIdempotencyKey,
  buildSourceEvidenceId,
  buildSourceEvidenceIdempotencyKey,
  buildSupportingSourceReferences,
  uniqueStrings
} from "../shared.js";

const nullableStringSchema = z.string().min(1).nullable();
const stringArraySchema = z.array(z.string().min(1));
const timestampSchema = z.string().datetime();

export const simpleTextingMessageRecordSchema = z.object({
  recordType: z.literal("message"),
  recordId: z.string().min(1),
  direction: z.enum(["inbound", "outbound"]),
  messageKind: z.enum(["one_to_one", "campaign"]),
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  snippet: z.string().default(""),
  normalizedPhone: z.string().min(1),
  campaignId: nullableStringSchema.default(null),
  campaignName: nullableStringSchema.default(null),
  providerThreadId: nullableStringSchema.default(null),
  salesforceContactId: nullableStringSchema.default(null),
  volunteerIdPlainValues: stringArraySchema.default([]),
  normalizedEmails: stringArraySchema.default([]),
  supportingRecords: z.array(supportingProviderRecordSchema).default([]),
  crossProviderCollapseKey: nullableStringSchema.default(null)
});
export type SimpleTextingMessageRecord = z.infer<
  typeof simpleTextingMessageRecordSchema
>;

export const simpleTextingComplianceRecordSchema = z.object({
  recordType: z.literal("compliance"),
  recordId: z.string().min(1),
  complianceType: z.enum(["opt_in", "opt_out"]),
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  normalizedPhone: z.string().min(1),
  salesforceContactId: nullableStringSchema.default(null),
  volunteerIdPlainValues: stringArraySchema.default([]),
  normalizedEmails: stringArraySchema.default([])
});
export type SimpleTextingComplianceRecord = z.infer<
  typeof simpleTextingComplianceRecordSchema
>;

export const simpleTextingUnsupportedRecordSchema = z
  .object({
    recordType: z.string().min(1),
    recordId: z.string().min(1)
  })
  .refine(
    (record) => !["message", "compliance"].includes(record.recordType),
    {
      message:
        "Unsupported SimpleTexting records must not use a first-scope record type."
    }
  );
export type SimpleTextingUnsupportedRecord = z.infer<
  typeof simpleTextingUnsupportedRecordSchema
>;

export const simpleTextingRecordSchema = z.union([
  simpleTextingMessageRecordSchema,
  simpleTextingComplianceRecordSchema,
  simpleTextingUnsupportedRecordSchema
]);
export type SimpleTextingRecord =
  | SimpleTextingMessageRecord
  | SimpleTextingComplianceRecord
  | SimpleTextingUnsupportedRecord;

function resolveSimpleTextingMessageEventType(
  direction: SimpleTextingMessageRecord["direction"]
): CanonicalEventType {
  return direction === "inbound"
    ? "communication.sms.inbound"
    : "communication.sms.outbound";
}

function resolveComplianceEventType(
  complianceType: SimpleTextingComplianceRecord["complianceType"]
): CanonicalEventType {
  return complianceType === "opt_in"
    ? "communication.sms.opt_in"
    : "communication.sms.opt_out";
}

function buildSmsSummary(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "communication.sms.inbound":
      return "Inbound SMS received";
    case "communication.sms.outbound":
      return "Outbound SMS sent";
    case "communication.sms.opt_in":
      return "SMS opt-in received";
    case "communication.sms.opt_out":
      return "SMS opt-out received";
    default:
      throw new Error(`Unsupported SimpleTexting event type: ${eventType}`);
  }
}

function mapSimpleTextingMessageRecord(
  record: SimpleTextingMessageRecord
): NormalizedCanonicalEventIntake {
  const eventType = resolveSimpleTextingMessageEventType(record.direction);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;
  const crossProviderCollapseKey =
    record.crossProviderCollapseKey ??
    (record.messageKind === "campaign" && record.campaignId !== null
      ? `simpletexting:campaign:${record.campaignId}:${record.normalizedPhone}`
      : null);

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "simpletexting",
        providerRecordType,
        providerRecordId
      ),
      provider: "simpletexting",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "simpletexting",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "simpletexting",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "simpletexting",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey
      }),
      summary: buildSmsSummary(eventType),
      snippet: record.snippet
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: [record.normalizedPhone]
    },
    supportingSources: buildSupportingSourceReferences(record.supportingRecords),
    communicationClassification: {
      messageKind: record.messageKind,
      sourceRecordType: providerRecordType,
      sourceRecordId: providerRecordId,
      campaignRef:
        record.messageKind === "campaign"
          ? {
              providerCampaignId: record.campaignId,
              providerAudienceId: null,
              providerMessageName: record.campaignName
            }
          : null,
      threadRef: {
        crossProviderCollapseKey,
        providerThreadId: record.providerThreadId
      },
      direction: record.direction
    },
    simpleTextingMessageDetail: {
      sourceEvidenceId: buildSourceEvidenceId(
        "simpletexting",
        providerRecordType,
        providerRecordId
      ),
      providerRecordId,
      direction: record.direction,
      messageKind: record.messageKind,
      messageTextPreview: record.snippet,
      normalizedPhone: record.normalizedPhone,
      campaignId: record.campaignId,
      campaignName: record.campaignName,
      providerThreadId: record.providerThreadId,
      threadKey: crossProviderCollapseKey
    }
  };
}

function mapSimpleTextingComplianceRecord(
  record: SimpleTextingComplianceRecord
): NormalizedCanonicalEventIntake {
  const eventType = resolveComplianceEventType(record.complianceType);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "simpletexting",
        providerRecordType,
        providerRecordId
      ),
      provider: "simpletexting",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "simpletexting",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "simpletexting",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "simpletexting",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      summary: buildSmsSummary(eventType),
      snippet: ""
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: [record.normalizedPhone]
    },
    supportingSources: []
  };
}

export function mapSimpleTextingRecord(
  rawRecord: SimpleTextingRecord
): ProviderMappingResult {
  const messageRecord = simpleTextingMessageRecordSchema.safeParse(rawRecord);

  if (messageRecord.success) {
    return createCommandMappingResult({
      provider: "simpletexting",
      sourceRecordType: messageRecord.data.recordType,
      sourceRecordId: messageRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSimpleTextingMessageRecord(messageRecord.data)
      )
    });
  }

  const complianceRecord = simpleTextingComplianceRecordSchema.safeParse(
    rawRecord
  );

  if (complianceRecord.success) {
    return createCommandMappingResult({
      provider: "simpletexting",
      sourceRecordType: complianceRecord.data.recordType,
      sourceRecordId: complianceRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSimpleTextingComplianceRecord(complianceRecord.data)
      )
    });
  }

  const deferredRecord = simpleTextingUnsupportedRecordSchema.parse(rawRecord);

  return createDeferredMappingResult({
    provider: "simpletexting",
    sourceRecordType: deferredRecord.recordType,
    sourceRecordId: deferredRecord.recordId,
    reason: "deferred_record_family",
    detail: `SimpleTexting ${deferredRecord.recordType} records are deferred in Stage 1.`
  });
}
