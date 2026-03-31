import { z } from "zod";

import {
  type CanonicalEventType,
  type NormalizedCanonicalEventIntake,
  type NormalizedContactGraphUpsertInput
} from "@as-comms/contracts";

import {
  createCanonicalEventCommand,
  createCommandMappingResult,
  createContactGraphCommand,
  createDeferredMappingResult,
  supportingProviderRecordSchema,
  type ProviderMappingResult
} from "../provider-types.js";
import {
  buildCanonicalEventId,
  buildCanonicalEventIdempotencyKey,
  buildContactIdFromSalesforceContactId,
  buildContactIdentityId,
  buildContactMembershipId,
  buildSourceEvidenceId,
  buildSourceEvidenceIdempotencyKey,
  buildSupportingSourceReferences,
  uniqueStrings
} from "../shared.js";

const nullableStringSchema = z.string().min(1).nullable();
const stringArraySchema = z.array(z.string().min(1));
const timestampSchema = z.string().datetime();

const salesforceLifecycleMilestoneSchema = z.enum([
  "signed_up",
  "received_training",
  "completed_training",
  "submitted_first_data"
]);
const salesforceLifecycleSourceFieldSchema = z.enum([
  "Expedition_Members__c.CreatedDate",
  "Expedition_Members__c.Date_Training_Sent__c",
  "Expedition_Members__c.Date_Training_Completed__c",
  "Expedition_Members__c.Date_First_Sample_Collected__c"
]);

const salesforceRoutingContextSchema = z.object({
  required: z.boolean().default(false),
  projectId: nullableStringSchema.default(null),
  expeditionId: nullableStringSchema.default(null)
});

const salesforceMembershipSchema = z.object({
  projectId: nullableStringSchema.default(null),
  expeditionId: nullableStringSchema.default(null),
  role: nullableStringSchema.default(null),
  status: nullableStringSchema.default(null)
});

export const salesforceContactSnapshotRecordSchema = z.object({
  recordType: z.literal("contact_snapshot"),
  recordId: z.string().min(1),
  salesforceContactId: z.string().min(1),
  displayName: z.string().min(1),
  primaryEmail: nullableStringSchema.default(null),
  primaryPhone: nullableStringSchema.default(null),
  normalizedEmails: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  volunteerIdPlainValues: stringArraySchema.default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  memberships: z.array(salesforceMembershipSchema).default([])
});
export type SalesforceContactSnapshotRecord = z.infer<
  typeof salesforceContactSnapshotRecordSchema
>;

export const salesforceLifecycleRecordSchema = z.object({
  recordType: z.literal("lifecycle_milestone"),
  recordId: z.string().min(1),
  salesforceContactId: z.string().min(1),
  milestone: salesforceLifecycleMilestoneSchema,
  sourceField: salesforceLifecycleSourceFieldSchema,
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  normalizedEmails: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  volunteerIdPlainValues: stringArraySchema.default([]),
  routing: salesforceRoutingContextSchema.default({
    required: false,
    projectId: null,
    expeditionId: null
  })
}).superRefine((record, ctx) => {
  const expectedSourceField = (() => {
    switch (record.milestone) {
      case "signed_up":
        return "Expedition_Members__c.CreatedDate";
      case "received_training":
        return "Expedition_Members__c.Date_Training_Sent__c";
      case "completed_training":
        return "Expedition_Members__c.Date_Training_Completed__c";
      case "submitted_first_data":
        return "Expedition_Members__c.Date_First_Sample_Collected__c";
    }
  })();

  if (record.sourceField !== expectedSourceField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceField"],
      message:
        "Salesforce lifecycle sourceField must match the locked Expedition_Members__c milestone mapping."
    });
  }
});
export type SalesforceLifecycleRecord = z.infer<
  typeof salesforceLifecycleRecordSchema
>;

export const salesforceTaskCommunicationRecordSchema = z.object({
  recordType: z.literal("task_communication"),
  recordId: z.string().min(1),
  channel: z.enum(["email", "sms"]),
  salesforceContactId: nullableStringSchema.default(null),
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  snippet: z.string().default(""),
  normalizedEmails: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  volunteerIdPlainValues: stringArraySchema.default([]),
  supportingRecords: z.array(supportingProviderRecordSchema).default([]),
  crossProviderCollapseKey: nullableStringSchema.default(null),
  routing: salesforceRoutingContextSchema.default({
    required: false,
    projectId: null,
    expeditionId: null
  })
});
export type SalesforceTaskCommunicationRecord = z.infer<
  typeof salesforceTaskCommunicationRecordSchema
>;

export const salesforceUnsupportedRecordSchema = z
  .object({
    recordType: z.string().min(1),
    recordId: z.string().min(1)
  })
  .refine(
    (record) =>
      ![
        "contact_snapshot",
        "lifecycle_milestone",
        "task_communication"
      ].includes(record.recordType),
    {
      message:
        "Unsupported Salesforce records must not use a first-scope record type."
    }
  );
export type SalesforceUnsupportedRecord = z.infer<
  typeof salesforceUnsupportedRecordSchema
>;

export const salesforceRecordSchema = z.union([
  salesforceContactSnapshotRecordSchema,
  salesforceLifecycleRecordSchema,
  salesforceTaskCommunicationRecordSchema,
  salesforceUnsupportedRecordSchema
]);
export type SalesforceRecord =
  | SalesforceContactSnapshotRecord
  | SalesforceLifecycleRecord
  | SalesforceTaskCommunicationRecord
  | SalesforceUnsupportedRecord;

function resolveLifecycleEventType(
  milestone: SalesforceLifecycleRecord["milestone"]
): CanonicalEventType {
  switch (milestone) {
    case "signed_up":
      return "lifecycle.signed_up";
    case "received_training":
      return "lifecycle.received_training";
    case "completed_training":
      return "lifecycle.completed_training";
    case "submitted_first_data":
      return "lifecycle.submitted_first_data";
  }
}

function buildLifecycleSummary(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "lifecycle.signed_up":
      return "Volunteer signed up";
    case "lifecycle.received_training":
      return "Volunteer received training";
    case "lifecycle.completed_training":
      return "Volunteer completed training";
    case "lifecycle.submitted_first_data":
      return "Volunteer submitted first data";
    default:
      throw new Error(`Unsupported lifecycle event type: ${eventType}`);
  }
}

function mapSalesforceContactSnapshot(
  record: SalesforceContactSnapshotRecord
): NormalizedContactGraphUpsertInput {
  const contactId = buildContactIdFromSalesforceContactId(
    record.salesforceContactId
  );
  const normalizedEmails = uniqueStrings([
    ...(record.primaryEmail === null ? [] : [record.primaryEmail]),
    ...record.normalizedEmails
  ]);
  const normalizedPhones = uniqueStrings([
    ...(record.primaryPhone === null ? [] : [record.primaryPhone]),
    ...record.normalizedPhones
  ]);
  const volunteerIdPlainValues = uniqueStrings(record.volunteerIdPlainValues);

  return {
    contact: {
      id: contactId,
      salesforceContactId: record.salesforceContactId,
      displayName: record.displayName,
      primaryEmail: record.primaryEmail,
      primaryPhone: record.primaryPhone,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    },
    identities: [
      {
        id: buildContactIdentityId({
          contactId,
          kind: "salesforce_contact_id",
          normalizedValue: record.salesforceContactId
        }),
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: record.salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: record.updatedAt
      },
      ...volunteerIdPlainValues.map((value) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "volunteer_id_plain",
          normalizedValue: value
        }),
        contactId,
        kind: "volunteer_id_plain" as const,
        normalizedValue: value,
        isPrimary: false,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt
      })),
      ...normalizedEmails.map((value, index) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "email",
          normalizedValue: value
        }),
        contactId,
        kind: "email" as const,
        normalizedValue: value,
        isPrimary: index === 0,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt
      })),
      ...normalizedPhones.map((value, index) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "phone",
          normalizedValue: value
        }),
        contactId,
        kind: "phone" as const,
        normalizedValue: value,
        isPrimary: index === 0,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt
      }))
    ],
    memberships: record.memberships.map((membership) => ({
      id: buildContactMembershipId({
        contactId,
        projectId: membership.projectId,
        expeditionId: membership.expeditionId,
        role: membership.role
      }),
      contactId,
      projectId: membership.projectId,
      expeditionId: membership.expeditionId,
      role: membership.role,
      status: membership.status,
      source: "salesforce"
    }))
  };
}

function mapSalesforceLifecycleRecord(
  record: SalesforceLifecycleRecord
): NormalizedCanonicalEventIntake {
  const eventType = resolveLifecycleEventType(record.milestone);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId
      ),
      provider: "salesforce",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "salesforce",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null
      }),
      summary: buildLifecycleSummary(eventType),
      snippet: ""
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: uniqueStrings(record.normalizedPhones)
    },
    routing: record.routing,
    supportingSources: []
  };
}

function buildSalesforceTaskSummary(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "communication.email.outbound":
      return "Outbound email sent";
    case "communication.sms.outbound":
      return "Outbound SMS sent";
    default:
      throw new Error(`Unsupported Salesforce task event type: ${eventType}`);
  }
}

function mapSalesforceTaskCommunicationRecord(
  record: SalesforceTaskCommunicationRecord
): NormalizedCanonicalEventIntake {
  const eventType: CanonicalEventType =
    record.channel === "email"
      ? "communication.email.outbound"
      : "communication.sms.outbound";
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId
      ),
      provider: "salesforce",
      providerRecordType,
      providerRecordId,
      receivedAt: record.receivedAt,
      occurredAt: record.occurredAt,
      payloadRef: record.payloadRef,
      idempotencyKey: buildSourceEvidenceIdempotencyKey(
        "salesforce",
        providerRecordType,
        providerRecordId
      ),
      checksum: record.checksum
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: record.crossProviderCollapseKey
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: record.crossProviderCollapseKey
      }),
      summary: buildSalesforceTaskSummary(eventType),
      snippet: record.snippet
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: uniqueStrings(record.normalizedPhones)
    },
    routing: record.routing,
    supportingSources: buildSupportingSourceReferences(record.supportingRecords)
  };
}

export function mapSalesforceRecord(
  rawRecord: SalesforceRecord
): ProviderMappingResult {
  const contactSnapshot = salesforceContactSnapshotRecordSchema.safeParse(rawRecord);

  if (contactSnapshot.success) {
    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: contactSnapshot.data.recordType,
      sourceRecordId: contactSnapshot.data.recordId,
      command: createContactGraphCommand(
        mapSalesforceContactSnapshot(contactSnapshot.data)
      )
    });
  }

  const lifecycleRecord = salesforceLifecycleRecordSchema.safeParse(rawRecord);

  if (lifecycleRecord.success) {
    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: lifecycleRecord.data.recordType,
      sourceRecordId: lifecycleRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSalesforceLifecycleRecord(lifecycleRecord.data)
      )
    });
  }

  const taskRecord = salesforceTaskCommunicationRecordSchema.safeParse(rawRecord);

  if (taskRecord.success) {
    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: taskRecord.data.recordType,
      sourceRecordId: taskRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSalesforceTaskCommunicationRecord(taskRecord.data)
      )
    });
  }

  const deferredRecord = salesforceUnsupportedRecordSchema.parse(rawRecord);

  return createDeferredMappingResult({
    provider: "salesforce",
    sourceRecordType: deferredRecord.recordType,
    sourceRecordId: deferredRecord.recordId,
    reason: "deferred_record_family",
    detail: `Salesforce ${deferredRecord.recordType} records are deferred in Stage 1.`
  });
}
