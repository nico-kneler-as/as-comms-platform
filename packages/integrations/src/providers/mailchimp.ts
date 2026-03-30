import { z } from "zod";

import {
  type CanonicalEventType,
  type NormalizedCanonicalEventIntake
} from "@as-comms/contracts";

import {
  createCanonicalEventCommand,
  createCommandMappingResult,
  createDeferredMappingResult,
  type ProviderMappingResult
} from "../provider-types.js";
import {
  buildCanonicalEventId,
  buildCanonicalEventIdempotencyKey,
  buildSourceEvidenceId,
  buildSourceEvidenceIdempotencyKey
} from "../shared.js";

const nullableStringSchema = z.string().min(1).nullable();
const stringArraySchema = z.array(z.string().min(1));
const timestampSchema = z.string().datetime();

const mailchimpActivityTypeSchema = z.enum([
  "sent",
  "opened",
  "clicked",
  "unsubscribed"
]);

export const mailchimpCampaignActivityRecordSchema = z.object({
  recordType: z.literal("campaign_member_activity"),
  recordId: z.string().min(1),
  activityType: mailchimpActivityTypeSchema,
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  normalizedEmail: z.string().min(1),
  salesforceContactId: nullableStringSchema.default(null),
  volunteerIdPlainValues: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  campaignId: z.string().min(1),
  audienceId: z.string().min(1),
  memberId: z.string().min(1),
  snippet: z.string().default("")
});
export type MailchimpCampaignActivityRecord = z.infer<
  typeof mailchimpCampaignActivityRecordSchema
>;

export const mailchimpUnsupportedRecordSchema = z
  .object({
    recordType: z.string().min(1),
    recordId: z.string().min(1)
  })
  .refine((record) => record.recordType !== "campaign_member_activity", {
    message:
      "Unsupported Mailchimp records must not use the first-scope activity type."
  });
export type MailchimpUnsupportedRecord = z.infer<
  typeof mailchimpUnsupportedRecordSchema
>;

export const mailchimpRecordSchema = z.union([
  mailchimpCampaignActivityRecordSchema,
  mailchimpUnsupportedRecordSchema
]);
export type MailchimpRecord =
  | MailchimpCampaignActivityRecord
  | MailchimpUnsupportedRecord;

function resolveMailchimpEventType(
  activityType: MailchimpCampaignActivityRecord["activityType"]
): CanonicalEventType {
  switch (activityType) {
    case "sent":
      return "campaign.email.sent";
    case "opened":
      return "campaign.email.opened";
    case "clicked":
      return "campaign.email.clicked";
    case "unsubscribed":
      return "campaign.email.unsubscribed";
  }
}

function buildMailchimpSummary(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "campaign.email.sent":
      return "Campaign email sent";
    case "campaign.email.opened":
      return "Campaign email opened";
    case "campaign.email.clicked":
      return "Campaign email clicked";
    case "campaign.email.unsubscribed":
      return "Campaign email unsubscribed";
    default:
      throw new Error(`Unsupported Mailchimp event type: ${eventType}`);
  }
}

function mapMailchimpCampaignActivityRecord(
  record: MailchimpCampaignActivityRecord
): NormalizedCanonicalEventIntake {
  const eventType = resolveMailchimpEventType(record.activityType);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId("mailchimp", providerRecordType, providerRecordId),
      provider: "mailchimp",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "mailchimp",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "mailchimp",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "mailchimp",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      summary: buildMailchimpSummary(eventType),
      snippet: record.snippet
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: record.volunteerIdPlainValues,
      normalizedEmails: [record.normalizedEmail],
      normalizedPhones: record.normalizedPhones
    },
    supportingSources: []
  };
}

export function mapMailchimpRecord(
  rawRecord: MailchimpRecord
): ProviderMappingResult {
  const supportedRecord = mailchimpCampaignActivityRecordSchema.safeParse(
    rawRecord
  );

  if (supportedRecord.success) {
    return createCommandMappingResult({
      provider: "mailchimp",
      sourceRecordType: supportedRecord.data.recordType,
      sourceRecordId: supportedRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapMailchimpCampaignActivityRecord(supportedRecord.data)
      )
    });
  }

  const deferredRecord = mailchimpUnsupportedRecordSchema.parse(rawRecord);

  return createDeferredMappingResult({
    provider: "mailchimp",
    sourceRecordType: deferredRecord.recordType,
    sourceRecordId: deferredRecord.recordId,
    reason: "deferred_record_family",
    detail: `Mailchimp ${deferredRecord.recordType} records are deferred in Stage 1.`
  });
}
