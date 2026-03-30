import { z } from "zod";

import {
  auditActorTypeSchema,
  auditResultSchema,
  canonicalEventTypeSchema,
  channelSchema,
  contactIdentityKindSchema,
  identityResolutionReasonCodeSchema,
  inboxBucketSchema,
  inboxDrivingEventTypeSchema,
  provenanceWinnerReasonSchema,
  providerSchema,
  recordSourceSchema,
  resolveCanonicalChannel,
  reviewCaseStatusSchema,
  reviewStateSchema,
  routingReviewReasonCodeSchema,
  syncScopeSchema,
  syncJobTypeSchema,
  syncStatusSchema
} from "./stage1-taxonomy.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const optionalTimestampSchema = timestampSchema.nullable();
const optionalIdSchema = idSchema.nullable();
const stringArraySchema = z.array(z.string().min(1));
const metadataJsonSchema = z.record(z.string(), z.unknown());

// Stage 1 intentionally keeps provenance serialization compact and explicit.
export const canonicalEventProvenanceSchema = z.object({
  primaryProvider: providerSchema,
  primarySourceEvidenceId: idSchema,
  supportingSourceEvidenceIds: stringArraySchema.default([]),
  winnerReason: provenanceWinnerReasonSchema,
  notes: z.string().min(1).nullable().optional()
});
export type CanonicalEventProvenance = z.infer<
  typeof canonicalEventProvenanceSchema
>;

export const sourceEvidenceSchema = z.object({
  id: idSchema,
  provider: providerSchema,
  providerRecordType: z.string().min(1),
  providerRecordId: z.string().min(1),
  receivedAt: timestampSchema,
  occurredAt: timestampSchema,
  payloadRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  checksum: z.string().min(1)
});
export type SourceEvidenceRecord = z.infer<typeof sourceEvidenceSchema>;

export const canonicalEventSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    eventType: canonicalEventTypeSchema,
    channel: channelSchema,
    occurredAt: timestampSchema,
    sourceEvidenceId: idSchema,
    idempotencyKey: z.string().min(1),
    provenance: canonicalEventProvenanceSchema,
    reviewState: reviewStateSchema
  })
  .superRefine((value, context) => {
    if (value.channel !== resolveCanonicalChannel(value.eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel must match the canonical event type"
      });
    }

    if (value.sourceEvidenceId !== value.provenance.primarySourceEvidenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "sourceEvidenceId must match provenance.primarySourceEvidenceId"
      });
    }
  });
export type CanonicalEventRecord = z.infer<typeof canonicalEventSchema>;

export const contactSchema = z.object({
  id: idSchema,
  salesforceContactId: z.string().min(1).nullable(),
  displayName: z.string().min(1),
  primaryEmail: z.string().min(1).nullable(),
  primaryPhone: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type ContactRecord = z.infer<typeof contactSchema>;

export const contactIdentitySchema = z.object({
  id: idSchema,
  contactId: idSchema,
  kind: contactIdentityKindSchema,
  normalizedValue: z.string().min(1),
  isPrimary: z.boolean(),
  source: recordSourceSchema,
  verifiedAt: optionalTimestampSchema
});
export type ContactIdentityRecord = z.infer<typeof contactIdentitySchema>;

export const contactMembershipSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  projectId: z.string().min(1).nullable(),
  expeditionId: z.string().min(1).nullable(),
  role: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  source: recordSourceSchema
});
export type ContactMembershipRecord = z.infer<typeof contactMembershipSchema>;

export const identityResolutionSchema = z
  .object({
    id: idSchema,
    sourceEvidenceId: idSchema,
    candidateContactIds: stringArraySchema,
    reasonCode: identityResolutionReasonCodeSchema,
    status: reviewCaseStatusSchema,
    openedAt: timestampSchema,
    resolvedAt: optionalTimestampSchema,
    normalizedIdentityValues: stringArraySchema.default([]),
    anchoredContactId: optionalIdSchema,
    explanation: z.string().min(1)
  })
  .superRefine((value, context) => {
    if (value.status === "resolved" && value.resolvedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resolved identity cases must include resolvedAt"
      });
    }
  });
export type IdentityResolutionCase = z.infer<typeof identityResolutionSchema>;

export const routingReviewSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    sourceEvidenceId: idSchema,
    reasonCode: routingReviewReasonCodeSchema,
    status: reviewCaseStatusSchema,
    openedAt: timestampSchema,
    resolvedAt: optionalTimestampSchema,
    candidateMembershipIds: stringArraySchema.default([]),
    explanation: z.string().min(1)
  })
  .superRefine((value, context) => {
    if (value.status === "resolved" && value.resolvedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resolved routing cases must include resolvedAt"
      });
    }
  });
export type RoutingReviewCase = z.infer<typeof routingReviewSchema>;

export const inboxProjectionSchema = z
  .object({
    contactId: idSchema,
    bucket: inboxBucketSchema,
    isStarred: z.boolean(),
    hasUnresolved: z.boolean(),
    lastInboundAt: optionalTimestampSchema,
    lastOutboundAt: optionalTimestampSchema,
    lastActivityAt: timestampSchema,
    snippet: z.string(),
    lastCanonicalEventId: idSchema,
    lastEventType: inboxDrivingEventTypeSchema
  })
  .superRefine((value, context) => {
    const latestKnownAt = [value.lastInboundAt, value.lastOutboundAt]
      .filter((timestamp): timestamp is string => timestamp !== null)
      .sort()
      .at(-1);

    if (latestKnownAt !== undefined && latestKnownAt !== value.lastActivityAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "lastActivityAt must match the newest known inbound or outbound timestamp"
      });
    }
  });
export type InboxProjectionRow = z.infer<typeof inboxProjectionSchema>;

export const timelineProjectionSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    canonicalEventId: idSchema,
    occurredAt: timestampSchema,
    sortKey: z.string().min(1),
    eventType: canonicalEventTypeSchema,
    summary: z.string().min(1),
    channel: channelSchema,
    primaryProvider: providerSchema,
    reviewState: reviewStateSchema
  })
  .superRefine((value, context) => {
    if (value.channel !== resolveCanonicalChannel(value.eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline channel must match the canonical event type"
      });
    }
  });
export type TimelineProjectionRow = z.infer<typeof timelineProjectionSchema>;

export const syncStateSchema = z.object({
  id: idSchema,
  scope: syncScopeSchema,
  provider: providerSchema.nullable(),
  jobType: syncJobTypeSchema,
  cursor: z.string().min(1).nullable(),
  windowStart: optionalTimestampSchema,
  windowEnd: optionalTimestampSchema,
  status: syncStatusSchema,
  parityPercent: z.number().min(0).max(100).nullable(),
  freshnessP95Seconds: z.number().int().nonnegative().nullable(),
  freshnessP99Seconds: z.number().int().nonnegative().nullable(),
  lastSuccessfulAt: optionalTimestampSchema,
  deadLetterCount: z.number().int().nonnegative()
}).superRefine((value, context) => {
  if (value.scope === "provider" && value.provider === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "provider-scoped sync state must include a provider"
    });
  }

  if (value.scope === "orchestration" && value.provider !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "orchestration-scoped sync state must not include a provider"
    });
  }
});
export type SyncStateRecord = z.infer<typeof syncStateSchema>;

export const auditEvidenceSchema = z.object({
  id: idSchema,
  actorType: auditActorTypeSchema,
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  occurredAt: timestampSchema,
  result: auditResultSchema,
  policyCode: z.string().min(1),
  metadataJson: metadataJsonSchema
});
export type AuditEvidenceRecord = z.infer<typeof auditEvidenceSchema>;
