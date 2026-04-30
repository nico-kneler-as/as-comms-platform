import { isNotNull, sql } from "drizzle-orm";
import type {
  CanonicalEventProvenance,
  IntegrationHealthCategory,
  IntegrationHealthStatus,
} from "@as-comms/contracts";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  auditActorTypeEnum,
  auditResultEnum,
  canonicalEventTypeEnum,
  channelEnum,
  contactIdentityKindEnum,
  identityResolutionReasonCodeEnum,
  inboxBucketEnum,
  pendingOutboundStatusEnum,
  providerEnum,
  recordSourceEnum,
  reviewCaseStatusEnum,
  reviewStateEnum,
  routingReviewReasonCodeEnum,
  syncScopeEnum,
  syncJobTypeEnum,
  syncStatusEnum,
  userRoleEnum,
} from "./enums.js";

const createdAtColumn = timestamp("created_at", {
  mode: "date",
  withTimezone: true,
})
  .notNull()
  .defaultNow();

const updatedAtColumn = timestamp("updated_at", {
  mode: "date",
  withTimezone: true,
})
  .notNull()
  .defaultNow();

type PendingComposerOutboundAttachmentMetadata = Readonly<{
  filename: string;
  size: number;
  contentType: string;
}>;

export const sourceEvidenceLog = pgTable(
  "source_evidence_log",
  {
    id: text("id").primaryKey(),
    provider: providerEnum("provider").notNull(),
    providerRecordType: text("provider_record_type").notNull(),
    providerRecordId: text("provider_record_id").notNull(),
    receivedAt: timestamp("received_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    payloadRef: text("payload_ref").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: createdAtColumn,
  },
  (table) => [
    index("source_evidence_log_provider_record_idx").on(
      table.provider,
      table.providerRecordType,
      table.providerRecordId,
    ),
    uniqueIndex("source_evidence_log_provider_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
  ],
);

export const sourceEvidenceQuarantine = pgTable(
  "source_evidence_quarantine",
  {
    id: text("id").primaryKey(),
    provider: providerEnum("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    checksum: text("checksum").notNull(),
    attemptedAt: timestamp("attempted_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    // Canonical values are free-text strings like "checksum_mismatch".
    reason: text("reason").notNull(),
    payloadRef: text("payload_ref").notNull(),
    detailsJsonb: jsonb("details_jsonb").notNull(),
    createdAt: createdAtColumn,
  },
  (table) => [
    index("source_evidence_quarantine_provider_idempotency_idx").on(
      table.provider,
      table.idempotencyKey,
    ),
  ],
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
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("contacts_salesforce_contact_id_unique").on(
      table.salesforceContactId,
    ),
    index("contacts_primary_email_idx").on(table.primaryEmail),
    index("contacts_primary_phone_idx").on(table.primaryPhone),
  ],
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
      withTimezone: true,
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("contact_identities_contact_value_unique").on(
      table.contactId,
      table.kind,
      table.normalizedValue,
    ),
    index("contact_identities_kind_value_idx").on(
      table.kind,
      table.normalizedValue,
    ),
  ],
);

export const contactMemberships = pgTable(
  "contact_memberships",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // Migration 0039 added these FKs, 0044 dropped them to unblock a
    // Salesforce capture P0, and 0046 restores them after the capture
    // pipeline was fixed to seed dimensions before memberships.
    projectId: text("project_id").references(() => projectDimensions.projectId, {
      onDelete: "restrict"
    }),
    expeditionId: text("expedition_id").references(
      () => expeditionDimensions.expeditionId,
      { onDelete: "restrict" }
    ),
    salesforceMembershipId: text("salesforce_membership_id"),
    role: text("role"),
    status: text("status"),
    source: recordSourceEnum("source").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "contact_memberships_sf_id_check",
      sql`${table.source} <> 'salesforce' OR ${table.salesforceMembershipId} IS NOT NULL`,
    ),
    index("contact_memberships_contact_idx").on(table.contactId),
    index("contact_memberships_context_idx").on(
      table.projectId,
      table.expeditionId,
    ),
    index("contact_memberships_project_contact_idx").on(
      table.projectId,
      table.contactId,
    ),
  ],
);

export const projectDimensions = pgTable(
  "project_dimensions",
  {
    projectId: text("project_id").primaryKey(),
    projectName: text("project_name").notNull(),
    projectAlias: text("project_alias"),
    isActive: boolean("is_active").notNull().default(false),
    aiKnowledgeUrl: text("ai_knowledge_url"),
    aiKnowledgeSyncedAt: timestamp("ai_knowledge_synced_at", {
      mode: "date",
      withTimezone: true,
    }),
    source: recordSourceEnum("source").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "project_dimensions_active_alias_required",
      sql`${table.isActive} = false OR (${table.projectAlias} IS NOT NULL AND BTRIM(${table.projectAlias}) <> '')`,
    ),
  ],
);

export const expeditionDimensions = pgTable(
  "expedition_dimensions",
  {
    expeditionId: text("expedition_id").primaryKey(),
    projectId: text("project_id"),
    expeditionName: text("expedition_name").notNull(),
    source: recordSourceEnum("source").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [index("expedition_dimensions_project_idx").on(table.projectId)],
);

export const gmailMessageDetails = pgTable(
  "gmail_message_details",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    providerRecordId: text("provider_record_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    rfc822MessageId: text("rfc822_message_id"),
    direction: text("direction").notNull(),
    subject: text("subject"),
    fromHeader: text("from_header"),
    toHeader: text("to_header"),
    ccHeader: text("cc_header"),
    labelIds: text("label_ids").array(),
    snippetClean: text("snippet_clean").notNull().default(""),
    bodyTextPreview: text("body_text_preview").notNull().default(""),
    bodyKind: text("body_kind"),
    capturedMailbox: text("captured_mailbox"),
    projectInboxAlias: text("project_inbox_alias"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("gmail_message_details_record_idx").on(table.providerRecordId),
    index("gmail_message_details_thread_idx").on(table.gmailThreadId),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    gmailAttachmentId: text("gmail_attachment_id").notNull(),
    mimeType: text("mime_type").notNull(),
    filename: text("filename"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAtColumn,
  },
  (table) => [index("message_attachments_source_idx").on(table.sourceEvidenceId)],
);

export const salesforceEventContext = pgTable(
  "salesforce_event_context",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    salesforceContactId: text("salesforce_contact_id"),
    projectId: text("project_id"),
    expeditionId: text("expedition_id"),
    sourceField: text("source_field"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("salesforce_event_context_contact_idx").on(table.salesforceContactId),
    index("salesforce_event_context_context_idx").on(
      table.projectId,
      table.expeditionId,
    ),
  ],
);

export const salesforceCommunicationDetails = pgTable(
  "salesforce_communication_details",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    providerRecordId: text("provider_record_id").notNull(),
    channel: text("channel").notNull(),
    messageKind: text("message_kind").notNull(),
    subject: text("subject"),
    snippet: text("snippet").notNull().default(""),
    sourceLabel: text("source_label").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("salesforce_communication_details_record_idx").on(
      table.providerRecordId,
    ),
  ],
);

export const simpleTextingMessageDetails = pgTable(
  "simpletexting_message_details",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    providerRecordId: text("provider_record_id").notNull(),
    direction: text("direction").notNull(),
    messageKind: text("message_kind").notNull(),
    messageTextPreview: text("message_text_preview").notNull().default(""),
    normalizedPhone: text("normalized_phone"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    providerThreadId: text("provider_thread_id"),
    threadKey: text("thread_key"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("simpletexting_message_details_record_idx").on(
      table.providerRecordId,
    ),
    index("simpletexting_message_details_campaign_idx").on(table.campaignId),
    index("simpletexting_message_details_thread_idx").on(table.threadKey),
  ],
);

export const mailchimpCampaignActivityDetails = pgTable(
  "mailchimp_campaign_activity_details",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    providerRecordId: text("provider_record_id").notNull(),
    activityType: text("activity_type").notNull(),
    campaignId: text("campaign_id"),
    audienceId: text("audience_id"),
    memberId: text("member_id"),
    campaignName: text("campaign_name"),
    snippet: text("snippet").notNull().default(""),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("mailchimp_campaign_activity_details_record_idx").on(
      table.providerRecordId,
    ),
    index("mailchimp_campaign_activity_details_campaign_idx").on(
      table.campaignId,
    ),
  ],
);

export const manualNoteDetails = pgTable(
  "manual_note_details",
  {
    sourceEvidenceId: text("source_evidence_id")
      .primaryKey()
      .references(() => sourceEvidenceLog.id, { onDelete: "cascade" }),
    providerRecordId: text("provider_record_id").notNull(),
    body: text("body").notNull(),
    authorDisplayName: text("author_display_name"),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("manual_note_details_record_idx").on(table.providerRecordId),
    index("manual_note_details_author_idx").on(table.authorId),
  ],
);

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("internal_notes_contact_id_idx").on(table.contactId),
    index("internal_notes_created_at_idx").on(table.createdAt),
  ],
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
      withTimezone: true,
    }).notNull(),
    contentFingerprint: text("content_fingerprint"),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => sourceEvidenceLog.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    provenance: jsonb("provenance").$type<CanonicalEventProvenance>().notNull(),
    reviewState: reviewStateEnum("review_state").notNull().default("clear"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("canonical_event_ledger_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("canonical_event_ledger_contact_occurred_idx").on(
      table.contactId,
      table.occurredAt,
    ),
    index("canonical_event_ledger_contact_channel_fingerprint_idx").on(
      table.contactId,
      table.channel,
      table.contentFingerprint,
    ),
    index("canonical_event_ledger_source_evidence_idx").on(
      table.sourceEvidenceId,
    ),
  ],
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
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastAttemptedAt: timestamp("last_attempted_at", {
      mode: "date",
      withTimezone: true,
    }),
    normalizedIdentityValues: text("normalized_identity_values")
      .array()
      .notNull()
      .default([]),
    anchoredContactId: text("anchored_contact_id").references(
      () => contacts.id,
      {
        onDelete: "set null",
      },
    ),
    explanation: text("explanation").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("identity_resolution_queue_source_evidence_idx").on(
      table.sourceEvidenceId,
    ),
    index("identity_resolution_queue_status_idx").on(
      table.status,
      table.reasonCode,
    ),
    index("identity_resolution_queue_last_attempted_idx")
      .on(table.lastAttemptedAt, table.openedAt)
      .where(sql`${table.status} = 'open'`),
  ],
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
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", {
      mode: "date",
      withTimezone: true,
    }),
    candidateMembershipIds: text("candidate_membership_ids")
      .array()
      .notNull()
      .default([]),
    explanation: text("explanation").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("routing_review_queue_contact_idx").on(table.contactId),
    index("routing_review_queue_status_idx").on(table.status, table.reasonCode),
  ],
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
      withTimezone: true,
    }),
    lastOutboundAt: timestamp("last_outbound_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastActivityAt: timestamp("last_activity_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    snippet: text("snippet").notNull().default(""),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastCanonicalEventId: text("last_canonical_event_id")
      .notNull()
      .references(() => canonicalEventLedger.id, { onDelete: "restrict" }),
    lastEventType: canonicalEventTypeEnum("last_event_type").notNull(),
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("contact_inbox_projection_bucket_idx").on(
      table.bucket,
      table.lastActivityAt,
    ),
    index("contact_inbox_projection_recency_inbound_idx").on(
      table.lastInboundAt.desc().nullsLast(),
      table.lastActivityAt.desc(),
      table.contactId.asc(),
    ),
    index("contact_inbox_projection_recency_outbound_idx").on(
      table.lastOutboundAt.desc().nullsLast(),
      table.lastActivityAt.desc(),
      table.contactId.asc(),
    ),
    index("contact_inbox_projection_unresolved_idx").on(
      table.hasUnresolved,
      table.lastActivityAt,
    ),
    index("contact_inbox_projection_archived_idx")
      .on(table.archivedAt)
      .where(isNotNull(table.archivedAt)),
  ],
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
      withTimezone: true,
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
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("contact_timeline_projection_canonical_event_unique").on(
      table.canonicalEventId,
    ),
    index("contact_timeline_projection_contact_sort_idx").on(
      table.contactId,
      table.sortKey,
    ),
  ],
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
      withTimezone: true,
    }),
    windowEnd: timestamp("window_end", {
      mode: "date",
      withTimezone: true,
    }),
    status: syncStatusEnum("status").notNull(),
    parityPercent: numeric("parity_percent", {
      precision: 5,
      scale: 2,
    }),
    freshnessP95Seconds: integer("freshness_p95_seconds"),
    freshnessP99Seconds: integer("freshness_p99_seconds"),
    lastSuccessfulAt: timestamp("last_successful_at", {
      mode: "date",
      withTimezone: true,
    }),
    consecutiveFailureCount: integer("consecutive_failure_count")
      .notNull()
      .default(0),
    leaseOwner: text("lease_owner"),
    heartbeatAt: timestamp("heartbeat_at", {
      mode: "date",
      withTimezone: true,
    }),
    deadLetterCount: integer("dead_letter_count").notNull().default(0),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("sync_state_scope_provider_job_type_idx").on(
      table.scope,
      table.provider,
      table.jobType,
      table.status,
    ),
  ],
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
      withTimezone: true,
    }).notNull(),
    result: auditResultEnum("result").notNull(),
    policyCode: text("policy_code").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn,
  },
  (table) => [
    index("audit_policy_evidence_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    index("audit_policy_evidence_actor_idx").on(table.actorType, table.actorId),
    index("audit_policy_evidence_occurred_at_idx").on(table.occurredAt),
  ],
);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", {
    mode: "date",
    withTimezone: true,
  }),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("operator"),
  deactivatedAt: timestamp("deactivated_at", {
    mode: "date",
    withTimezone: true,
  }),
  createdAt: createdAtColumn,
  updatedAt: updatedAtColumn,
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerAccountId],
      name: "accounts_provider_provider_account_id_pk",
    }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
      name: "verification_tokens_identifier_token_pk",
    }),
  ],
);

export const projectAliases = pgTable(
  "project_aliases",
  {
    id: text("id").primaryKey(),
    alias: text("alias").notNull().unique(),
    signature: text("signature").notNull().default(""),
    projectId: text("project_id").references(
      () => projectDimensions.projectId,
      {
        onDelete: "set null",
      },
    ),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("project_aliases_project_idx").on(table.projectId)],
);

export const pendingComposerOutbounds = pgTable(
  "pending_composer_outbounds",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    status: pendingOutboundStatusEnum("status").notNull().default("pending"),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    canonicalContactId: text("canonical_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(
      () => projectDimensions.projectId,
      {
        onDelete: "set null",
      },
    ),
    fromAlias: text("from_alias").notNull(),
    toEmailNormalized: text("to_email_normalized").notNull(),
    subject: text("subject").notNull(),
    bodyPlaintext: text("body_plaintext").notNull(),
    bodyHtml: text("body_html"),
    bodySha256: text("body_sha256").notNull(),
    attachmentMetadataJson: jsonb("attachment_metadata_json")
      .$type<readonly PendingComposerOutboundAttachmentMetadata[]>()
      .notNull()
      .default([]),
    gmailThreadId: text("gmail_thread_id"),
    inReplyToRfc822: text("in_reply_to_rfc822"),
    attemptedAt: timestamp("attempted_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    reconciledEventId: text("reconciled_event_id"),
    reconciledAt: timestamp("reconciled_at", {
      mode: "date",
      withTimezone: true,
    }),
    failedReason: text("failed_reason"),
    sentRfc822MessageId: text("sent_rfc822_message_id"),
    failedDetail: text("failed_detail"),
    orphanedAt: timestamp("orphaned_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("pending_composer_outbounds_fingerprint_idx").on(table.fingerprint),
    index("pending_composer_outbounds_contact_status_idx").on(
      table.canonicalContactId,
      table.status,
    ),
    index("pending_composer_outbounds_sent_rfc822_idx")
      .on(table.sentRfc822MessageId)
      .where(sql`${table.sentRfc822MessageId} is not null`),
    index("pending_composer_outbounds_pending_sweep_idx")
      .on(table.status, table.attemptedAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const aiKnowledgeEntries = pgTable(
  "ai_knowledge_entries",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    scopeKey: text("scope_key"),
    sourceProvider: text("source_provider").notNull(),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url"),
    title: text("title"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceLastEditedAt: timestamp("source_last_edited_at", {
      mode: "date",
      withTimezone: true
    }),
    syncedAt: timestamp("synced_at", {
      mode: "date",
      withTimezone: true
    }).notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    uniqueIndex("ai_knowledge_entries_source_idx").on(
      table.sourceProvider,
      table.sourceId
    ),
    index("ai_knowledge_entries_scope_idx").on(table.scope, table.scopeKey)
  ]
);

export const projectKnowledgeEntries = pgTable(
  "project_knowledge_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    kind: text("kind")
      .$type<"canonical_reply" | "snippet" | "pattern">()
      .notNull(),
    issueType: text("issue_type"),
    volunteerStage: text("volunteer_stage"),
    questionSummary: text("question_summary").notNull(),
    replyStrategy: text("reply_strategy"),
    maskedExample: text("masked_example"),
    sourceKind: text("source_kind")
      .$type<"hand_authored" | "captured_from_send" | "bootstrap_synthesized">()
      .notNull(),
    approvedForAi: boolean("approved_for_ai").notNull().default(false),
    sourceEventId: text("source_event_id"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastReviewedAt: timestamp("last_reviewed_at", {
      mode: "date",
      withTimezone: true
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn
  },
  (table) => [
    index("project_knowledge_entries_project_id_idx").on(table.projectId),
    index("project_knowledge_entries_approved_idx").on(
      table.projectId,
      table.approvedForAi
    ),
    index("project_knowledge_entries_issue_type_idx")
      .on(table.projectId, table.issueType)
      .where(sql`${table.approvedForAi} = true`)
  ]
);

export const integrationHealth = pgTable(
  "integration_health",
  {
    id: text("id").primaryKey(),
    serviceName: text("service_name").notNull(),
    category: text("category").$type<IntegrationHealthCategory>().notNull(),
    status: text("status")
      .$type<IntegrationHealthStatus>()
      .notNull()
      .default("not_configured"),
    lastCheckedAt: timestamp("last_checked_at", {
      mode: "date",
      withTimezone: true,
    }),
    degradedSinceAt: timestamp("degraded_since_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastAlertSentAt: timestamp("last_alert_sent_at", {
      mode: "date",
      withTimezone: true,
    }),
    detail: text("detail"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [index("integration_health_updated_at_idx").on(table.updatedAt)],
);
