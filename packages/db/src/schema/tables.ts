import type { CanonicalEventProvenance } from "@as-comms/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  auditActorTypeEnum,
  auditResultEnum,
  canonicalEventTypeEnum,
  channelEnum,
  contactIdentityKindEnum,
  identityResolutionReasonCodeEnum,
  inboxBucketEnum,
  providerEnum,
  recordSourceEnum,
  reviewCaseStatusEnum,
  reviewStateEnum,
  routingReviewReasonCodeEnum,
  syncScopeEnum,
  syncJobTypeEnum,
  syncStatusEnum
} from "./enums.js";

const createdAtColumn = timestamp("created_at", {
  mode: "date",
  withTimezone: true
})
  .notNull()
  .defaultNow();

const updatedAtColumn = timestamp("updated_at", {
  mode: "date",
  withTimezone: true
})
  .notNull()
  .defaultNow();

export const sourceEvidenceLog = pgTable(
  "source_evidence_log",
  {
    id: text("id").primaryKey(),
    provider: providerEnum("provider").notNull(),
    providerRecordType: text("provider_record_type").notNull(),
    providerRecordId: text("provider_record_id").notNull(),
    receivedAt: timestamp("received_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    payloadRef: text("payload_ref").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: createdAtColumn
  },
  (table) => [
    index("source_evidence_log_provider_record_idx").on(
      table.provider,
      table.providerRecordType,
      table.providerRecordId
    ),
    uniqueIndex("source_evidence_log_replay_unique").on(
      table.provider,
      table.idempotencyKey,
      table.checksum
    )
  ]
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    salesforceContactId: text("salesforce_contact_id"),
    displayName: text("display_name").notNull(),
    primaryEmail: text("primary_email"),
    primaryPhone: text("primary_phone"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true
    }).notNull()
  },
  (table) => [
    uniqueIndex("contacts_salesforce_contact_id_unique").on(
      table.salesforceContactId
    ),
    index("contacts_primary_email_idx").on(table.primaryEmail),
    index("contacts_primary_phone_idx").on(table.primaryPhone)
  ]
);

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: contactIdentityKindEnum("kind").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: recordSourceEnum("source").notNull(),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    uniqueIndex("contact_identities_contact_value_unique").on(
      table.contactId,
      table.kind,
      table.normalizedValue
    ),
    index("contact_identities_kind_value_idx").on(
      table.kind,
      table.normalizedValue
    )
  ]
);

export const contactMemberships = pgTable(
  "contact_memberships",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    expeditionId: text("expedition_id"),
    role: text("role"),
    status: text("status"),
    source: recordSourceEnum("source").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("contact_memberships_contact_idx").on(table.contactId),
    index("contact_memberships_context_idx").on(
      table.projectId,
      table.expeditionId
    )
  ]
);

export const canonicalEventLedger = pgTable(
  "canonical_event_ledger",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    eventType: canonicalEventTypeEnum("event_type").notNull(),
    channel: channelEnum("channel").notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => sourceEvidenceLog.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    provenance: jsonb("provenance")
      .$type<CanonicalEventProvenance>()
      .notNull(),
    reviewState: reviewStateEnum("review_state").notNull().default("clear"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    uniqueIndex("canonical_event_ledger_idempotency_key_unique").on(
      table.idempotencyKey
    ),
    index("canonical_event_ledger_contact_occurred_idx").on(
      table.contactId,
      table.occurredAt
    ),
    index("canonical_event_ledger_source_evidence_idx").on(
      table.sourceEvidenceId
    )
  ]
);

export const identityResolutionQueue = pgTable(
  "identity_resolution_queue",
  {
    id: text("id").primaryKey(),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => sourceEvidenceLog.id, { onDelete: "restrict" }),
    candidateContactIds: text("candidate_contact_ids")
      .array()
      .notNull()
      .default([]),
    reasonCode: identityResolutionReasonCodeEnum("reason_code").notNull(),
    status: reviewCaseStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    resolvedAt: timestamp("resolved_at", {
      mode: "date",
      withTimezone: true
    }),
    normalizedIdentityValues: text("normalized_identity_values")
      .array()
      .notNull()
      .default([]),
    anchoredContactId: text("anchored_contact_id").references(() => contacts.id, {
      onDelete: "set null"
    }),
    explanation: text("explanation").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("identity_resolution_queue_source_evidence_idx").on(
      table.sourceEvidenceId
    ),
    index("identity_resolution_queue_status_idx").on(
      table.status,
      table.reasonCode
    )
  ]
);

export const routingReviewQueue = pgTable(
  "routing_review_queue",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => sourceEvidenceLog.id, { onDelete: "restrict" }),
    reasonCode: routingReviewReasonCodeEnum("reason_code").notNull(),
    status: reviewCaseStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    resolvedAt: timestamp("resolved_at", {
      mode: "date",
      withTimezone: true
    }),
    candidateMembershipIds: text("candidate_membership_ids")
      .array()
      .notNull()
      .default([]),
    explanation: text("explanation").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("routing_review_queue_contact_idx").on(table.contactId),
    index("routing_review_queue_status_idx").on(
      table.status,
      table.reasonCode
    )
  ]
);

export const contactInboxProjection = pgTable(
  "contact_inbox_projection",
  {
    contactId: text("contact_id")
      .primaryKey()
      .references(() => contacts.id, { onDelete: "cascade" }),
    bucket: inboxBucketEnum("bucket").notNull(),
    isStarred: boolean("is_starred").notNull().default(false),
    hasUnresolved: boolean("has_unresolved").notNull().default(false),
    lastInboundAt: timestamp("last_inbound_at", {
      mode: "date",
      withTimezone: true
    }),
    lastOutboundAt: timestamp("last_outbound_at", {
      mode: "date",
      withTimezone: true
    }),
    lastActivityAt: timestamp("last_activity_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    snippet: text("snippet").notNull().default(""),
    lastCanonicalEventId: text("last_canonical_event_id")
      .notNull()
      .references(() => canonicalEventLedger.id, { onDelete: "restrict" }),
    lastEventType: canonicalEventTypeEnum("last_event_type").notNull(),
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("contact_inbox_projection_bucket_idx").on(
      table.bucket,
      table.lastActivityAt
    ),
    index("contact_inbox_projection_unresolved_idx").on(
      table.hasUnresolved,
      table.lastActivityAt
    )
  ]
);

export const contactTimelineProjection = pgTable(
  "contact_timeline_projection",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    canonicalEventId: text("canonical_event_id")
      .notNull()
      .references(() => canonicalEventLedger.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    // The spec intentionally leaves sortKey encoding open; Stage 1 stores it as
    // opaque text while requiring deterministic generation in projection code.
    sortKey: text("sort_key").notNull(),
    eventType: canonicalEventTypeEnum("event_type").notNull(),
    summary: text("summary").notNull(),
    channel: channelEnum("channel").notNull(),
    primaryProvider: providerEnum("primary_provider").notNull(),
    reviewState: reviewStateEnum("review_state").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    uniqueIndex("contact_timeline_projection_canonical_event_unique").on(
      table.canonicalEventId
    ),
    index("contact_timeline_projection_contact_sort_idx").on(
      table.contactId,
      table.sortKey
    )
  ]
);

export const syncState = pgTable(
  "sync_state",
  {
    id: text("id").primaryKey(),
    scope: syncScopeEnum("scope").notNull(),
    provider: providerEnum("provider"),
    jobType: syncJobTypeEnum("job_type").notNull(),
    cursor: text("cursor"),
    windowStart: timestamp("window_start", {
      mode: "date",
      withTimezone: true
    }),
    windowEnd: timestamp("window_end", {
      mode: "date",
      withTimezone: true
    }),
    status: syncStatusEnum("status").notNull(),
    parityPercent: numeric("parity_percent", {
      precision: 5,
      scale: 2
    }),
    freshnessP95Seconds: integer("freshness_p95_seconds"),
    freshnessP99Seconds: integer("freshness_p99_seconds"),
    lastSuccessfulAt: timestamp("last_successful_at", {
      mode: "date",
      withTimezone: true
    }),
    deadLetterCount: integer("dead_letter_count").notNull().default(0),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("sync_state_scope_provider_job_type_idx").on(
      table.scope,
      table.provider,
      table.jobType,
      table.status
    )
  ]
);

export const auditPolicyEvidence = pgTable(
  "audit_policy_evidence",
  {
    id: text("id").primaryKey(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    result: auditResultEnum("result").notNull(),
    policyCode: text("policy_code").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn
  },
  (table) => [
    index("audit_policy_evidence_entity_idx").on(
      table.entityType,
      table.entityId
    ),
    index("audit_policy_evidence_actor_idx").on(
      table.actorType,
      table.actorId
    ),
    index("audit_policy_evidence_occurred_at_idx").on(
      table.occurredAt
    )
  ]
);
