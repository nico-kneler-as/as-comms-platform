import { z } from "zod";

import {
  type CanonicalEventType,
  type NormalizedCanonicalEventIntake,
  type NormalizedContactGraphUpsertInput,
} from "@as-comms/contracts";

import {
  createCanonicalEventCommand,
  createCommandMappingResult,
  createContactGraphCommand,
  createDeferredMappingResult,
  supportingProviderRecordSchema,
  type ProviderMappingResult,
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
  uniqueStrings,
} from "../shared.js";

const nullableStringSchema = z.string().min(1).nullable();
const stringArraySchema = z.array(z.string().min(1));
const timestampSchema = z.string().datetime();
const SALESFORCE_TASK_SNIPPET_MAX = 100_000;

const salesforceLifecycleMilestoneSchema = z.enum([
  "signed_up",
  "received_training",
  "completed_training",
  "submitted_first_data",
]);
const salesforceLifecycleSourceFieldSchema = z.enum([
  "Expedition_Members__c.CreatedDate",
  "Expedition_Members__c.Date_Training_Sent__c",
  "Expedition_Members__c.Date_Training_Completed__c",
  "Expedition_Members__c.Date_First_Sample_Collected__c",
]);

const salesforceRoutingContextSchema = z.object({
  required: z.boolean().default(false),
  projectId: nullableStringSchema.default(null),
  expeditionId: nullableStringSchema.default(null),
  projectName: nullableStringSchema.default(null),
  expeditionName: nullableStringSchema.default(null),
});

const salesforceMembershipSchema = z.object({
  salesforceId: nullableStringSchema.default(null),
  projectId: nullableStringSchema.default(null),
  projectName: nullableStringSchema.default(null),
  expeditionId: nullableStringSchema.default(null),
  expeditionName: nullableStringSchema.default(null),
  role: nullableStringSchema.default(null),
  status: nullableStringSchema.default(null),
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
  memberships: z.array(salesforceMembershipSchema).default([]),
});
export type SalesforceContactSnapshotRecord = z.infer<
  typeof salesforceContactSnapshotRecordSchema
>;

export const salesforceLifecycleRecordSchema = z
  .object({
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
      expeditionId: null,
    }),
  })
  .superRefine((record, ctx) => {
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
          "Salesforce lifecycle sourceField must match the locked Expedition_Members__c milestone mapping.",
      });
    }
  });
export type SalesforceLifecycleRecord = z.infer<
  typeof salesforceLifecycleRecordSchema
>;

export const salesforceLaunchScopeAutomatedOwnerNames = ["Nim Admin"] as const;

export const salesforceLaunchScopeAutomatedOwnerUsernames = [
  "admin+1@adventurescientists.org",
] as const;

const automatedOwnerSignalPatterns = [
  /\bmarketing\s*cloud\b/iu,
  /\bpardot\b/iu,
  /\bworkflow\b/iu,
  /\bautomated\s+process\b/iu,
  /\bsystem\b/iu,
  /\bintegration\b/iu,
] as const;

const automatedSubjectPatterns = [
  /^fw:/iu,
  /^fwd:/iu,
  /^→\s*email:/iu,
  /\bsign(?:\s|-)?up confirmation\b/iu,
  /\btraining reminder\b/iu,
  /\bstart your training\b/iu,
  /\bcomplete your training\b/iu,
] as const;

function normalizeComparableString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function matchesAnyPattern(
  value: string | null,
  patterns: readonly RegExp[],
): boolean {
  if (value === null) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function normalizeComparableLiteral(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeComparableString(value);
  return normalized === null ? null : normalized.toLowerCase();
}

function matchesAnyLiteral(
  value: string | null | undefined,
  literals: readonly string[],
): boolean {
  const normalizedValue = normalizeComparableLiteral(value);

  if (normalizedValue === null) {
    return false;
  }

  return literals.some((literal) => normalizedValue === literal.toLowerCase());
}

export interface SalesforceTaskMessageKindClassificationInput {
  readonly channel: "email" | "sms";
  readonly taskSubtype?: string | null;
  readonly ownerId?: string | null;
  readonly ownerName?: string | null;
  readonly ownerUsername?: string | null;
  readonly subject?: string | null;
}

export interface SalesforceTaskMessageKindClassification {
  readonly messageKind: "one_to_one" | "auto";
  readonly reason:
    | "non_email_task"
    | "automated_owner"
    | "subject_pattern"
    | "human_owned_task"
    | "insufficient_metadata";
}

function hasAutomatedOwnerSignal(
  input: SalesforceTaskMessageKindClassificationInput,
): boolean {
  return (
    matchesAnyLiteral(
      input.ownerName,
      salesforceLaunchScopeAutomatedOwnerNames,
    ) ||
    matchesAnyLiteral(
      input.ownerUsername,
      salesforceLaunchScopeAutomatedOwnerUsernames,
    ) ||
    matchesAnyPattern(normalizeComparableString(input.ownerId), [
      ...automatedOwnerSignalPatterns,
    ]) ||
    matchesAnyPattern(normalizeComparableString(input.ownerName), [
      ...automatedOwnerSignalPatterns,
    ]) ||
    matchesAnyPattern(normalizeComparableString(input.ownerUsername), [
      ...automatedOwnerSignalPatterns,
    ])
  );
}

function hasHumanOwnerSignal(
  input: SalesforceTaskMessageKindClassificationInput,
): boolean {
  return (
    normalizeComparableString(input.ownerName) !== null ||
    normalizeComparableString(input.ownerUsername) !== null
  );
}

export function classifySalesforceTaskMessageKind(
  input: SalesforceTaskMessageKindClassificationInput,
): SalesforceTaskMessageKindClassification {
  if (input.channel !== "email") {
    return {
      messageKind: "auto",
      reason: "non_email_task",
    };
  }

  const subject = normalizeComparableString(input.subject);

  // D-039 narrows live Salesforce email Task capture to Nim Admin-owned
  // volunteer automations. When owner metadata is present, owner truth beats
  // subject heuristics so human-owned CRM mail does not leak back into the
  // auto bucket. Subject fallback remains for legacy rows that persisted only
  // the subject/snippet and no owner metadata.
  if (hasAutomatedOwnerSignal(input)) {
    return {
      messageKind: "auto",
      reason: "automated_owner",
    };
  }

  if (hasHumanOwnerSignal(input)) {
    return {
      messageKind: "one_to_one",
      reason: "human_owned_task",
    };
  }

  if (matchesAnyPattern(subject, [...automatedSubjectPatterns])) {
    return {
      messageKind: "auto",
      reason: "subject_pattern",
    };
  }

  return {
    messageKind: "auto",
    reason: "insufficient_metadata",
  };
}

export const salesforceTaskCommunicationRecordSchema = z.object({
  recordType: z.literal("task_communication"),
  recordId: z.string().min(1),
  channel: z.enum(["email", "sms"]),
  messageKind: z.enum(["one_to_one", "auto"]).default("auto"),
  salesforceContactId: nullableStringSchema.default(null),
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  payloadRef: z.string().min(1),
  checksum: z.string().min(1),
  subject: nullableStringSchema.default(null),
  snippet: z.string().max(SALESFORCE_TASK_SNIPPET_MAX).default(""),
  normalizedEmails: stringArraySchema.default([]),
  normalizedPhones: stringArraySchema.default([]),
  volunteerIdPlainValues: stringArraySchema.default([]),
  supportingRecords: z.array(supportingProviderRecordSchema).default([]),
  crossProviderCollapseKey: nullableStringSchema.default(null),
  routing: salesforceRoutingContextSchema.default({
    required: false,
    projectId: null,
    expeditionId: null,
  }),
});
export type SalesforceTaskCommunicationRecord = z.infer<
  typeof salesforceTaskCommunicationRecordSchema
>;

export const salesforceUnsupportedRecordSchema = z
  .object({
    recordType: z.string().min(1),
    recordId: z.string().min(1),
  })
  .refine(
    (record) =>
      ![
        "contact_snapshot",
        "lifecycle_milestone",
        "task_communication",
      ].includes(record.recordType),
    {
      message:
        "Unsupported Salesforce records must not use a first-scope record type.",
    },
  );
export type SalesforceUnsupportedRecord = z.infer<
  typeof salesforceUnsupportedRecordSchema
>;

export const salesforceRecordSchema = z.union([
  salesforceContactSnapshotRecordSchema,
  salesforceLifecycleRecordSchema,
  salesforceTaskCommunicationRecordSchema,
  salesforceUnsupportedRecordSchema,
]);
export type SalesforceRecord =
  | SalesforceContactSnapshotRecord
  | SalesforceLifecycleRecord
  | SalesforceTaskCommunicationRecord
  | SalesforceUnsupportedRecord;

function resolveLifecycleEventType(
  milestone: SalesforceLifecycleRecord["milestone"],
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

export function parseSubjectDirection(rawSubject: string | null): {
  readonly direction: "inbound" | "outbound";
  readonly cleanSubject: string | null;
} {
  if (rawSubject === null) {
    return {
      direction: "outbound",
      cleanSubject: null,
    };
  }

  const trimmed = rawSubject.trim();

  if (trimmed.length === 0) {
    return {
      direction: "outbound",
      cleanSubject: null,
    };
  }

  const normalizeCleanSubject = (value: string): string | null => {
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  if (trimmed.startsWith("←") || trimmed.startsWith("⇐")) {
    return {
      direction: "inbound",
      cleanSubject: normalizeCleanSubject(
        trimmed.replace(/^[←⇐]\s*(?:Email:\s*)?/u, ""),
      ),
    };
  }

  if (trimmed.startsWith("→") || trimmed.startsWith("⇒")) {
    return {
      direction: "outbound",
      cleanSubject: normalizeCleanSubject(
        trimmed.replace(/^[→⇒]\s*(?:Email:\s*)?/u, ""),
      ),
    };
  }

  return {
    direction: "outbound",
    cleanSubject: normalizeCleanSubject(trimmed.replace(/^Email:\s*/iu, "")),
  };
}

export function mapSalesforceContactSnapshot(
  record: SalesforceContactSnapshotRecord,
): NormalizedContactGraphUpsertInput {
  const contactId = buildContactIdFromSalesforceContactId(
    record.salesforceContactId,
  );
  const normalizedEmails = uniqueStrings([
    ...(record.primaryEmail === null ? [] : [record.primaryEmail]),
    ...record.normalizedEmails,
  ]);
  const normalizedPhones = uniqueStrings([
    ...(record.primaryPhone === null ? [] : [record.primaryPhone]),
    ...record.normalizedPhones,
  ]);
  const volunteerIdPlainValues = uniqueStrings(record.volunteerIdPlainValues);
  const projectDimensionsById = new Map<
    string,
    {
      readonly projectId: string;
      readonly projectName: string;
      readonly source: "salesforce";
    }
  >();
  const expeditionDimensionsById = new Map<
    string,
    {
      readonly expeditionId: string;
      readonly projectId: string | null;
      readonly expeditionName: string;
      readonly source: "salesforce";
    }
  >();

  for (const membership of record.memberships) {
    if (membership.projectId !== null) {
      projectDimensionsById.set(membership.projectId, {
        projectId: membership.projectId,
        projectName: membership.projectName ?? membership.projectId,
        source: "salesforce",
      });
    }

    if (membership.expeditionId !== null) {
      expeditionDimensionsById.set(membership.expeditionId, {
        expeditionId: membership.expeditionId,
        projectId: membership.projectId,
        expeditionName: membership.expeditionName ?? membership.expeditionId,
        source: "salesforce",
      });
    }
  }

  return {
    contact: {
      id: contactId,
      salesforceContactId: record.salesforceContactId,
      displayName: record.displayName,
      primaryEmail: record.primaryEmail,
      primaryPhone: record.primaryPhone,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    identities: [
      {
        id: buildContactIdentityId({
          contactId,
          kind: "salesforce_contact_id",
          normalizedValue: record.salesforceContactId,
        }),
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: record.salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: record.updatedAt,
      },
      ...volunteerIdPlainValues.map((value) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "volunteer_id_plain",
          normalizedValue: value,
        }),
        contactId,
        kind: "volunteer_id_plain" as const,
        normalizedValue: value,
        isPrimary: false,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt,
      })),
      ...normalizedEmails.map((value, index) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "email",
          normalizedValue: value,
        }),
        contactId,
        kind: "email" as const,
        normalizedValue: value,
        isPrimary: index === 0,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt,
      })),
      ...normalizedPhones.map((value, index) => ({
        id: buildContactIdentityId({
          contactId,
          kind: "phone",
          normalizedValue: value,
        }),
        contactId,
        kind: "phone" as const,
        normalizedValue: value,
        isPrimary: index === 0,
        source: "salesforce" as const,
        verifiedAt: record.updatedAt,
      })),
    ],
    memberships: record.memberships.map((membership) => ({
      id: buildContactMembershipId({
        contactId,
        projectId: membership.projectId,
        expeditionId: membership.expeditionId,
        role: membership.role,
      }),
      contactId,
      projectId: membership.projectId,
      expeditionId: membership.expeditionId,
      salesforceMembershipId: membership.salesforceId ?? undefined,
      role: membership.role,
      status: membership.status,
      source: "salesforce",
      createdAt: record.createdAt,
    })),
    projectDimensions: Array.from(projectDimensionsById.values()),
    expeditionDimensions: Array.from(expeditionDimensionsById.values()),
  };
}

function mapSalesforceLifecycleRecord(
  record: SalesforceLifecycleRecord,
): NormalizedCanonicalEventIntake {
  const eventType = resolveLifecycleEventType(record.milestone);
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId,
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
        providerRecordId,
      ),
      checksum: record.checksum,
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null,
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: null,
      }),
      summary: buildLifecycleSummary(eventType),
      snippet: "",
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: uniqueStrings(record.normalizedPhones),
    },
    routing: record.routing,
    supportingSources: [],
    salesforceEventContext: {
      sourceEvidenceId: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId,
      ),
      salesforceContactId: record.salesforceContactId,
      projectId: record.routing.projectId,
      expeditionId: record.routing.expeditionId,
      sourceField: record.sourceField,
    },
    projectDimensions:
      record.routing.projectId !== null
        ? [
            {
              projectId: record.routing.projectId,
              projectName:
                record.routing.projectName ?? record.routing.projectId,
              source: "salesforce" as const,
            },
          ]
        : [],
    expeditionDimensions:
      record.routing.expeditionId !== null
        ? [
            {
              expeditionId: record.routing.expeditionId,
              projectId: record.routing.projectId,
              expeditionName:
                record.routing.expeditionName ?? record.routing.expeditionId,
              source: "salesforce" as const,
            },
          ]
        : [],
  };
}

function buildSalesforceTaskSummary(input: {
  readonly eventType: CanonicalEventType;
  readonly messageKind: "one_to_one" | "auto";
}): string {
  switch (input.eventType) {
    case "communication.email.inbound":
      return "Inbound email received";
    case "communication.email.outbound":
      return input.messageKind === "auto"
        ? "Auto email sent"
        : "Outbound email sent";
    case "communication.sms.outbound":
      return input.messageKind === "auto"
        ? "Auto SMS sent"
        : "Outbound SMS sent";
    default:
      throw new Error(
        `Unsupported Salesforce task event type: ${input.eventType}`,
      );
  }
}

function mapSalesforceTaskCommunicationRecord(
  record: SalesforceTaskCommunicationRecord,
): NormalizedCanonicalEventIntake {
  const subjectDirection =
    record.channel === "email"
      ? parseSubjectDirection(record.subject)
      : {
          direction: "outbound" as const,
          cleanSubject: record.subject,
        };
  const eventType: CanonicalEventType =
    record.channel === "email"
      ? subjectDirection.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound"
      : "communication.sms.outbound";
  const providerRecordType = record.recordType;
  const providerRecordId = record.recordId;

  return {
    sourceEvidence: {
      id: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId,
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
        providerRecordId,
      ),
      checksum: record.checksum,
    },
    canonicalEvent: {
      id: buildCanonicalEventId({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: record.crossProviderCollapseKey,
      }),
      eventType,
      occurredAt: record.occurredAt,
      idempotencyKey: buildCanonicalEventIdempotencyKey({
        provider: "salesforce",
        providerRecordType,
        providerRecordId,
        eventType,
        crossProviderCollapseKey: record.crossProviderCollapseKey,
      }),
      summary: buildSalesforceTaskSummary({
        eventType,
        messageKind: record.messageKind,
      }),
      snippet: record.snippet,
    },
    identity: {
      salesforceContactId: record.salesforceContactId,
      volunteerIdPlainValues: uniqueStrings(record.volunteerIdPlainValues),
      normalizedEmails: uniqueStrings(record.normalizedEmails),
      normalizedPhones: uniqueStrings(record.normalizedPhones),
    },
    routing: record.routing,
    supportingSources: buildSupportingSourceReferences(
      record.supportingRecords,
    ),
    communicationClassification: {
      messageKind: record.messageKind,
      sourceRecordType: providerRecordType,
      sourceRecordId: providerRecordId,
      campaignRef: null,
      threadRef: {
        crossProviderCollapseKey: record.crossProviderCollapseKey,
        providerThreadId: null,
      },
      direction: subjectDirection.direction,
    },
    salesforceCommunicationDetail: {
      sourceEvidenceId: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId,
      ),
      providerRecordId,
      channel: record.channel,
      messageKind: record.messageKind,
      subject: subjectDirection.cleanSubject,
      snippet: record.snippet,
      sourceLabel:
        record.messageKind === "auto" ? "Salesforce Flow" : "Salesforce Task",
    },
    salesforceEventContext: {
      sourceEvidenceId: buildSourceEvidenceId(
        "salesforce",
        providerRecordType,
        providerRecordId,
      ),
      salesforceContactId: record.salesforceContactId,
      projectId: record.routing.projectId,
      expeditionId: record.routing.expeditionId,
      sourceField: null,
    },
    projectDimensions:
      record.routing.projectId !== null && record.routing.projectName !== null
        ? [
            {
              projectId: record.routing.projectId,
              projectName: record.routing.projectName,
              source: "salesforce" as const,
            },
          ]
        : [],
    expeditionDimensions:
      record.routing.expeditionId !== null &&
      record.routing.expeditionName !== null
        ? [
            {
              expeditionId: record.routing.expeditionId,
              projectId: record.routing.projectId,
              expeditionName: record.routing.expeditionName,
              source: "salesforce" as const,
            },
          ]
        : [],
  };
}

export function mapSalesforceRecord(
  rawRecord: SalesforceRecord,
): ProviderMappingResult {
  const contactSnapshot =
    salesforceContactSnapshotRecordSchema.safeParse(rawRecord);

  if (contactSnapshot.success) {
    if (contactSnapshot.data.memberships.length === 0) {
      return createDeferredMappingResult({
        provider: "salesforce",
        sourceRecordType: contactSnapshot.data.recordType,
        sourceRecordId: contactSnapshot.data.recordId,
        reason: "deferred_record_family",
        detail:
          "Salesforce contact_snapshot records without expedition memberships are skipped in Stage 1.",
      });
    }

    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: contactSnapshot.data.recordType,
      sourceRecordId: contactSnapshot.data.recordId,
      command: createContactGraphCommand(
        mapSalesforceContactSnapshot(contactSnapshot.data),
      ),
    });
  }

  const lifecycleRecord = salesforceLifecycleRecordSchema.safeParse(rawRecord);

  if (lifecycleRecord.success) {
    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: lifecycleRecord.data.recordType,
      sourceRecordId: lifecycleRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSalesforceLifecycleRecord(lifecycleRecord.data),
      ),
    });
  }

  const taskRecord =
    salesforceTaskCommunicationRecordSchema.safeParse(rawRecord);

  if (taskRecord.success) {
    return createCommandMappingResult({
      provider: "salesforce",
      sourceRecordType: taskRecord.data.recordType,
      sourceRecordId: taskRecord.data.recordId,
      command: createCanonicalEventCommand(
        mapSalesforceTaskCommunicationRecord(taskRecord.data),
      ),
    });
  }

  const deferredRecord = salesforceUnsupportedRecordSchema.parse(rawRecord);

  return createDeferredMappingResult({
    provider: "salesforce",
    sourceRecordType: deferredRecord.recordType,
    sourceRecordId: deferredRecord.recordId,
    reason: "deferred_record_family",
    detail: `Salesforce ${deferredRecord.recordType} records are deferred in Stage 1.`,
  });
}
