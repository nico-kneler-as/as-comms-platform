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
const nullableStringArraySchema = z.array(z.string().min(1)).nullable();
const GMAIL_SNIPPET_MAX = 2_000;
const GMAIL_BODY_PREVIEW_MAX = 20_000;

export const gmailMessageRecordSchema = z.object({
  recordType: z.literal("message"),
  recordId: z.string().min(1),
  direction: z.enum(["inbound", "outbound"]),
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  snippet: z.string().max(GMAIL_SNIPPET_MAX).default(""),
  subject: nullableStringSchema.default(null),
  fromHeader: nullableStringSchema.default(null),
  toHeader: nullableStringSchema.default(null),
  ccHeader: nullableStringSchema.default(null),
  labelIds: nullableStringArraySchema.optional(),
  snippetClean: z.string().max(GMAIL_SNIPPET_MAX).default(""),
  bodyTextPreview: z.string().max(GMAIL_BODY_PREVIEW_MAX).default(""),
  bodyKind: z
    .enum(["plaintext", "encrypted_placeholder", "binary_fallback"])
    .nullable()
    .optional(),
  dsnOriginalMessageId: z.string().nullable().default(null),
  threadId: nullableStringSchema.default(null),
  rfc822MessageId: nullableStringSchema.default(null),
  capturedMailbox: nullableStringSchema.default(null),
  projectInboxAlias: nullableStringSchema.default(null),
  normalizedParticipantEmails: stringArraySchema.min(1),
  salesforceContactId: nullableStringSchema.default(null),
  volunteerIdPlainValues: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  supportingRecords: z.array(supportingProviderRecordSchema).default([]),
  crossProviderCollapseKey: nullableStringSchema.default(null),
  attachmentMetadata: z
    .array(
      z.object({
        partIndexPath: z.string().min(1),
        mimeType: z.string().min(1),
        filename: nullableStringSchema,
        sizeBytes: z.number().int().nonnegative(),
        gmailAttachmentId: z.string().min(1),
      }),
    )
    .default([]),
});
export type GmailMessageRecord = z.infer<typeof gmailMessageRecordSchema>;

export const gmailUnsupportedRecordSchema = z
  .object({
    recordType: z.string().min(1),
    recordId: z.string().min(1)
  })
  .refine((record) => record.recordType !== "message", {
    message: "Unsupported Gmail records must not use the message record type."
  });
export type GmailUnsupportedRecord = z.infer<typeof gmailUnsupportedRecordSchema>;

export const gmailRecordSchema = z.union([
  gmailMessageRecordSchema,
  gmailUnsupportedRecordSchema
]);
export type GmailRecord = GmailMessageRecord | GmailUnsupportedRecord;

function resolveGmailEventType(
  direction: GmailMessageRecord["direction"]
): CanonicalEventType {
  return direction === "inbound"
    ? "communication.email.inbound"
    : "communication.email.outbound";
}

function buildGmailSummary(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "communication.email.inbound":
      return "Inbound email received";
    case "communication.email.outbound":
      return "Outbound email sent";
    default:
      throw new Error(`Unsupported Gmail event type: ${eventType}`);
  }
}

function mapGmailMessageRecord(
  record: GmailMessageRecord
): NormalizedCanonicalEventIntake {
  const eventType = resolveGmailEventType(record.direction);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;
  const crossProviderCollapseKey = record.crossProviderCollapseKey;
  const cleanSnippet =
    record.snippetClean.trim().length > 0 ? record.snippetClean : record.snippet;
  const bodyTextPreview =
    record.bodyTextPreview.trim().length > 0
      ? record.bodyTextPreview
      : cleanSnippet;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId("gmail", providerRecordType, providerRecordId),
      provider: "gmail",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "gmail",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "gmail",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "gmail",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey
      }),
      summary: buildGmailSummary(eventType),
      snippet: cleanSnippet
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedParticipantEmails),
      normalizedPhones: uniqueStrings(record.normalizedPhones)
    },
    supportingSources: buildSupportingSourceReferences(record.supportingRecords),
    communicationClassification: {
      messageKind: "one_to_one",
      sourceRecordType: providerRecordType,
      sourceRecordId: providerRecordId,
      campaignRef: null,
      threadRef: {
        crossProviderCollapseKey,
        providerThreadId: record.threadId
      },
      direction: record.direction
    },
    gmailMessageDetail: {
      sourceEvidenceId: buildSourceEvidenceId(
        "gmail",
        providerRecordType,
        providerRecordId
      ),
      providerRecordId,
      gmailThreadId: record.threadId,
      rfc822MessageId: record.rfc822MessageId,
      direction: record.direction,
      subject: record.subject,
      fromHeader: record.fromHeader,
      toHeader: record.toHeader,
      ccHeader: record.ccHeader,
      labelIds: record.labelIds,
      snippetClean: cleanSnippet,
      bodyTextPreview,
      bodyKind: record.bodyKind ?? "plaintext",
      capturedMailbox: record.capturedMailbox,
      projectInboxAlias: record.projectInboxAlias
    }
  };
}

export function mapGmailRecord(rawRecord: GmailRecord): ProviderMappingResult {
  const supportedRecord = gmailMessageRecordSchema.safeParse(rawRecord);

  if (supportedRecord.success) {
    const rec = supportedRecord.data;
    const fromLower = (rec.fromHeader ?? "").toLowerCase();
    const subjectLower = (rec.subject ?? "").toLowerCase().trimStart();
    const isDsn =
      fromLower.includes("mailer-daemon@") ||
      fromLower.includes("mail delivery subsystem") ||
      subjectLower.startsWith("delivery status notification") ||
      subjectLower.startsWith("undelivered mail") ||
      subjectLower.startsWith("returned mail") ||
      subjectLower.startsWith("mail delivery failed");

    if (isDsn) {
      // detail is required (z.string().min(1)). When the DSN payload didn't
      // expose an Original-Message-ID (e.g. detected only by subject prefix),
      // fall back to a descriptive marker so the audit trail still has a value.
      const dsnDetail =
        rec.dsnOriginalMessageId !== null && rec.dsnOriginalMessageId.length > 0
          ? `original_message_id=${rec.dsnOriginalMessageId}`
          : "no original_message_id in dsn body";
      return createDeferredMappingResult({
        provider: "gmail",
        sourceRecordType: rec.recordType,
        sourceRecordId: rec.recordId,
        reason: "gmail_dsn",
        detail: dsnDetail
      });
    }

    const labelIds = rec.labelIds ?? [];

    if (labelIds.includes("DRAFT") && !labelIds.includes("SENT")) {
      return createDeferredMappingResult({
        provider: "gmail",
        sourceRecordType: rec.recordType,
        sourceRecordId: rec.recordId,
        reason: "skipped_by_policy",
        detail: "Gmail draft-only messages are skipped before canonical ingest."
      });
    }

    return createCommandMappingResult({
      provider: "gmail",
      sourceRecordType: rec.recordType,
      sourceRecordId: rec.recordId,
      command: createCanonicalEventCommand(mapGmailMessageRecord(rec))
    });
  }

  const deferredRecord = gmailUnsupportedRecordSchema.parse(rawRecord);

  return createDeferredMappingResult({
    provider: "gmail",
    sourceRecordType: deferredRecord.recordType,
    sourceRecordId: deferredRecord.recordId,
    reason: "deferred_record_family",
    detail: `Gmail ${deferredRecord.recordType} records are deferred in Stage 1.`
  });
}
