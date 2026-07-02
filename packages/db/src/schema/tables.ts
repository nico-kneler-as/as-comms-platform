import { isNotNull, sql } from "drizzle-orm";
import type {
  AiKnowledgeSource,
  CanonicalEventProvenance,
  ComposerDraftForwardContext,
  IntegrationHealthCategory,
  IntegrationHealthStatus,
} from "@as-comms/contracts";
import type {
  AudienceCriteria,
  CampaignKind,
  ConsentScopeType,
  ConsentSource,
  DeliveryStatus,
  LaunchType,
  PostmarkSenderStatus,
  RunState,
  SuppressionReason,
  WebhookDeadLetterFailureKind,
  WebhookDeadLetterStatus,
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
  uuid,
} from "drizzle-orm/pg-core";

import {
  auditActorTypeEnum,
  auditResultEnum,
  canonicalEventTypeEnum,
  channelEnum,
  composerDraftChannelEnum,
  composerDraftPaneModeEnum,
  composerDraftRecipientKindEnum,
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

export const postmarkWebhookDeadLetter = pgTable(
  "postmark_webhook_dead_letter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: timestamp("received_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    recordType: text("record_type"),
    messageId: text("message_id"),
    sourceEvidenceId: text("source_evidence_id").references(
      () => sourceEvidenceLog.id,
      {
        onDelete: "set null",
      },
    ),
    payloadJson: jsonb("payload_json").notNull(),
    failureKind: text("failure_kind")
      .$type<WebhookDeadLetterFailureKind>()
      .notNull(),
    failureMessage: text("failure_message").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    lastRetryAt: timestamp("last_retry_at", {
      mode: "date",
      withTimezone: true,
    }),
    status: text("status").$type<WebhookDeadLetterStatus>().notNull().default(
      "pending",
    ),
    terminalReason: text("terminal_reason"),
  },
  (table) => [
    index("postmark_webhook_dead_letter_status_received_at_idx").on(
      table.status,
      table.receivedAt,
    ),
    index("postmark_webhook_dead_letter_message_id_idx")
      .on(table.messageId)
      .where(isNotNull(table.messageId)),
  ],
);

export const opsAlertState = pgTable(
  "ops_alert_state",
  {
    category: text("category").notNull(),
    dedupKey: text("dedup_key").notNull(),
    lastSentAt: timestamp("last_sent_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    lastStatus: text("last_status").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    primaryKey({
      columns: [table.category, table.dedupKey],
      name: "ops_alert_state_pkey",
    }),
    check(
      "ops_alert_state_last_status_check",
      sql`${table.lastStatus} IN ('sent')`,
    ),
    index("ops_alert_state_last_sent_at_idx").on(table.lastSentAt),
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
    salesforceDeletedAt: timestamp("salesforce_deleted_at", {
      mode: "date",
      withTimezone: true,
    }),
    salesforceReconciledAt: timestamp("salesforce_reconciled_at", {
      mode: "date",
      withTimezone: true,
    }),
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
    salesforceDeletedAt: timestamp("salesforce_deleted_at", {
      mode: "date",
      withTimezone: true,
    }),
    salesforceReconciledAt: timestamp("salesforce_reconciled_at", {
      mode: "date",
      withTimezone: true,
    }),
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
    // Historical project_alias values this project has used. Appended by
    // setProjectAlias when the current alias is replaced with a different
    // value. Read alongside projectAlias by listAllProjectAliases so the
    // email timeline bubble-side renderer (D-049) keeps messages from
    // prior aliases on the right side after a rename.
    previousAliases: text("previous_aliases")
      .array()
      .notNull()
      .default([]),
    postmarkSenderStatus: text("postmark_sender_status")
      .$type<PostmarkSenderStatus>()
      .notNull()
      .default("unverified"),
    isActive: boolean("is_active").notNull().default(false),
    // Connected-sub-project pointer. NULL = host (or standalone) project.
    // Non-NULL = this project rolls up into the referenced host's inbox and
    // dashboard views; it does not own its own alias or AI knowledge.
    // Chain prevention is enforced by a BEFORE-INSERT/UPDATE trigger added
    // in migration 0056 (drizzle-kit can't model triggers, so it lives in
    // raw SQL). FK with ON DELETE SET NULL: deleting a host disconnects
    // its sub-projects safely.
    connectedToProjectId: text("connected_to_project_id"),
    aiKnowledgeUrl: text("ai_knowledge_url"),
    aiKnowledgeSyncedAt: timestamp("ai_knowledge_synced_at", {
      mode: "date",
      withTimezone: true,
    }),
    aiKnowledgeSources: jsonb("ai_knowledge_sources")
      .$type<readonly AiKnowledgeSource[]>()
      .notNull()
      .default([]),
    aiOperatingContext: text("ai_operating_context").notNull().default(""),
    aiAutoSyncSchedule: text("ai_auto_sync_schedule")
      .$type<"never" | "daily" | "weekly">()
      .notNull()
      .default("never"),
    aiOptimizedSynthesizedAt: timestamp("ai_optimized_synthesized_at", {
      mode: "date",
      withTimezone: true,
    }),
    // Bumped on every successful synthesis orchestrator run, including
    // skip-if-unchanged paths where Anthropic was not called. Lets the UI
    // distinguish "content gen time" from "auto-sync verification cycle"
    // so a Weekly schedule with stable sources doesn't look broken.
    aiOptimizedLastCheckedAt: timestamp("ai_optimized_last_checked_at", {
      mode: "date",
      withTimezone: true,
    }),
    aiOptimizedInputHash: text("ai_optimized_input_hash"),
    source: recordSourceEnum("source").notNull(),
    salesforceDeletedAt: timestamp("salesforce_deleted_at", {
      mode: "date",
      withTimezone: true,
    }),
    salesforceReconciledAt: timestamp("salesforce_reconciled_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "project_dimensions_active_alias_required",
      sql`${table.isActive} = false OR (${table.projectAlias} IS NOT NULL AND BTRIM(${table.projectAlias}) <> '') OR ${table.connectedToProjectId} IS NOT NULL`,
    ),
    check(
      "project_dimensions_ai_auto_sync_schedule_valid",
      sql`${table.aiAutoSyncSchedule} IN ('never', 'daily', 'weekly')`,
    ),
    check(
      "project_dimensions_postmark_sender_status_check",
      sql`${table.postmarkSenderStatus} IN ('unverified', 'pending', 'verified', 'rejected')`,
    ),
    index("project_dimensions_connected_to_idx").on(table.connectedToProjectId),
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

export const smsSenders = pgTable(
  "sms_senders",
  {
    id: text("id").primaryKey(),
    phoneE164: text("phone_e164").notNull(),
    displayName: text("display_name").notNull(),
    monthlyCap: integer("monthly_cap"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("sms_senders_phone_e164_unique").on(table.phoneE164),
  ],
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: text("id").primaryKey(),
    twilioMessageSid: text("twilio_message_sid"),
    direction: text("direction").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    senderId: text("sender_id")
      .notNull()
      .references(() => smsSenders.id, { onDelete: "restrict" }),
    broadcastRunId: text("broadcast_run_id").references(() => campaignRuns.id, {
      onDelete: "cascade",
    }),
    body: text("body").notNull(),
    segments: integer("segments").notNull().default(1),
    encoding: text("encoding").notNull(),
    mediaUrls: text("media_urls").array(),
    sendStatus: text("send_status").notNull(),
    failedReason: text("failed_reason"),
    failedDetail: text("failed_detail"),
    sentAt: timestamp("sent_at", {
      mode: "date",
      withTimezone: true,
    }),
    receivedAt: timestamp("received_at", {
      mode: "date",
      withTimezone: true,
    }),
    actorId: text("actor_id").references(() => users.id),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "sms_messages_direction_check",
      sql`${table.direction} IN ('inbound', 'outbound')`,
    ),
    check(
      "sms_messages_encoding_check",
      sql`${table.encoding} IN ('GSM-7', 'Unicode')`,
    ),
    index("sms_messages_contact_created_idx").on(
      table.contactId,
      sql`${table.createdAt} DESC`,
    ),
    uniqueIndex("sms_messages_twilio_sid_unique")
      .on(table.twilioMessageSid)
      .where(isNotNull(table.twilioMessageSid)),
    index("sms_messages_broadcast_run_id_idx")
      .on(table.broadcastRunId)
      .where(isNotNull(table.broadcastRunId)),
    index("sms_messages_phone_e164_idx").on(table.phoneE164),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    phoneE164: text("phone_e164").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    consentedAt: timestamp("consented_at", {
      mode: "date",
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", {
      mode: "date",
      withTimezone: true,
    }),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "consent_records_status_check",
      sql`${table.status} IN ('opted_in', 'revoked')`,
    ),
    check(
      "consent_records_source_check",
      sql`${table.source} IN ('volunteer_application_form', 'sms_reply_yes', 'operator_attestation', 'salesforce_field', 'inbound_thread')`,
    ),
    index("consent_records_phone_created_idx").on(
      table.phoneE164,
      sql`${table.createdAt} DESC`,
    ),
    index("consent_records_contact_created_idx").on(
      table.contactId,
      sql`${table.createdAt} DESC`,
    ),
  ],
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
    fromEmails: text("from_emails").array().notNull().default([]),
    toEmails: text("to_emails").array().notNull().default([]),
    ccEmails: text("cc_emails").array().notNull().default([]),
    bccEmails: text("bcc_emails").array().notNull().default([]),
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
    index("gmail_message_details_rfc822_idx")
      .on(table.rfc822MessageId)
      .where(sql`${table.rfc822MessageId} IS NOT NULL`),
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
    gmailAttachmentId: text("gmail_attachment_id"),
    mimeType: text("mime_type").notNull(),
    filename: text("filename"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key"),
    externalUrl: text("external_url"),
    isDecoration: boolean("is_decoration").notNull().default(false),
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

export const mailchimpCampaignTailState = pgTable(
  "mailchimp_campaign_tail_state",
  {
    campaignId: text("campaign_id").primaryKey(),
    audienceId: text("audience_id").notNull(),
    firstSeenSendTime: timestamp("first_seen_send_time", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    lastActivitySeenAt: timestamp("last_activity_seen_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastPolledAt: timestamp("last_polled_at", {
      mode: "date",
      withTimezone: true,
    }),
    droppedAt: timestamp("dropped_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("mailchimp_campaign_tail_state_active_refresh_idx")
      .on(table.lastPolledAt)
      .where(sql`${table.droppedAt} IS NULL`),
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

/*
 * Junction table for PRD #482 Gmail timeline fan-out. Stores one row per
 * canonical event and audience contact so later read paths can project the
 * same canonical event onto every participant's contact timeline.
 */
export const canonicalEventAudience = pgTable(
  "canonical_event_audience",
  {
    canonicalEventId: text("canonical_event_id")
      .notNull()
      .references(() => canonicalEventLedger.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    participantRole: text("participant_role").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    primaryKey({
      columns: [table.canonicalEventId, table.contactId],
      name: "canonical_event_audience_pkey",
    }),
    index("canonical_event_audience_contact_idx").on(
      table.contactId,
      table.canonicalEventId,
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

export const composerDrafts = pgTable(
  "composer_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paneMode: composerDraftPaneModeEnum("pane_mode").notNull(),
    channel: composerDraftChannelEnum("channel").notNull(),
    recipientAnchorKind: composerDraftRecipientKindEnum(
      "recipient_anchor_kind",
    ),
    recipientContactId: text("recipient_contact_id").references(
      () => contacts.id,
      {
        onDelete: "set null",
      },
    ),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    subject: text("subject").notNull().default(""),
    bodyPlaintext: text("body_plaintext").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    selectedAlias: text("selected_alias"),
    cc: jsonb("cc").$type<unknown>().notNull().default([]),
    bcc: jsonb("bcc").$type<unknown>().notNull().default([]),
    attachments: jsonb("attachments").$type<unknown>().notNull().default([]),
    aiDirective: text("ai_directive").notNull().default(""),
    replyContextThreadCursor: text("reply_context_thread_cursor"),
    forwardContext: jsonb("forward_context").$type<ComposerDraftForwardContext>(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("composer_drafts_actor_updated_idx").on(
      table.actorId,
      table.updatedAt.desc(),
    ),
    index("composer_drafts_actor_recipient_contact_idx")
      .on(table.actorId, table.recipientContactId)
      .where(isNotNull(table.recipientContactId)),
  ],
);

export const broadcastMediaAssets = pgTable(
  "broadcast_media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploaderId: text("uploader_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    publicUrl: text("public_url").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: createdAtColumn,
    deletedAt: timestamp("deleted_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [index("broadcast_media_assets_created_at_idx").on(table.createdAt.desc())],
);

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

export const campaignRuns = pgTable(
  "campaign_runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<CampaignKind>().notNull(),
    launchType: text("launch_type").$type<LaunchType>().notNull(),
    state: text("state").$type<RunState>().notNull(),
    projectId: text("project_id").references(() => projectDimensions.projectId, {
      onDelete: "restrict",
    }),
    name: text("name"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    replyToEmail: text("reply_to_email"),
    subjectTemplate: text("subject_template"),
    bodyHtmlTemplate: text("body_html_template"),
    bodyTextTemplate: text("body_text_template"),
    bodyDesignJson: jsonb("body_design_json").$type<unknown>(),
    preheader: text("preheader"),
    audienceCriteria: jsonb("audience_criteria")
      .$type<AudienceCriteria>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    audienceSize: integer("audience_size"),
    scheduledAt: timestamp("scheduled_at", {
      mode: "date",
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    finalizedAt: timestamp("finalized_at", {
      mode: "date",
      withTimezone: true,
    }),
    cancelledAt: timestamp("cancelled_at", {
      mode: "date",
      withTimezone: true,
    }),
    cancelledReason: text("cancelled_reason"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastEditedByUserId: text("last_edited_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "campaign_runs_kind_check",
      sql`${table.kind} IN ('newsletter', 'project')`,
    ),
    check(
      "campaign_runs_launch_type_check",
      sql`${table.launchType} IN ('normal_email', 'html_email', 'sms')`,
    ),
    check(
      "campaign_runs_state_check",
      sql`${table.state} IN ('draft', 'scheduled', 'sending', 'complete', 'finalized', 'cancelled')`,
    ),
    index("campaign_runs_state_scheduled_idx").on(
      table.state,
      table.scheduledAt,
    ),
    index("campaign_runs_project_id_idx")
      .on(table.projectId)
      .where(isNotNull(table.projectId)),
    index("campaign_runs_created_at_idx").on(table.createdAt.desc()),
  ],
);

export const audienceSnapshots = pgTable(
  "audience_snapshots",
  {
    id: text("id").primaryKey(),
    campaignRunId: text("campaign_run_id")
      .notNull()
      .references(() => campaignRuns.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "restrict",
    }),
    newsletterSubscriberId: uuid("newsletter_subscriber_id").references(
      () => newsletterSubscribers.id,
      { onDelete: "restrict" },
    ),
    frozenEmail: text("frozen_email").notNull(),
    frozenFirstName: text("frozen_first_name"),
    frozenProjectName: text("frozen_project_name"),
    frozenProjectId: text("frozen_project_id"),
    frozenAliasEmail: text("frozen_alias_email"),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    deliveryStatus: text("delivery_status")
      .$type<DeliveryStatus>()
      .notNull()
      .default("pending"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", {
      mode: "date",
      withTimezone: true,
    }),
    deliveredAt: timestamp("delivered_at", {
      mode: "date",
      withTimezone: true,
    }),
    bouncedAt: timestamp("bounced_at", {
      mode: "date",
      withTimezone: true,
    }),
    openedAt: timestamp("opened_at", {
      mode: "date",
      withTimezone: true,
    }),
    clickedAt: timestamp("clicked_at", {
      mode: "date",
      withTimezone: true,
    }),
    complainedAt: timestamp("complained_at", {
      mode: "date",
      withTimezone: true,
    }),
    unsubscribedAt: timestamp("unsubscribed_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastEventAt: timestamp("last_event_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: createdAtColumn,
  },
  (table) => [
    check(
      "audience_snapshots_delivery_status_check",
      sql`${table.deliveryStatus} IN ('pending', 'sent', 'delivered', 'bounced', 'complained', 'unsubscribed', 'failed', 'suppressed_at_send')`,
    ),
    check(
      "audience_snapshots_recipient_check",
      sql`num_nonnulls(${table.contactId}, ${table.newsletterSubscriberId}) = 1`,
    ),
    index("audience_snapshots_run_id_idx").on(table.campaignRunId),
    index("audience_snapshots_contact_id_idx").on(table.contactId),
    index("audience_snapshots_newsletter_subscriber_id_idx").on(
      table.newsletterSubscriberId,
    ),
    uniqueIndex("audience_snapshots_unsubscribe_token_idx").on(
      table.unsubscribeToken,
    ),
    index("audience_snapshots_provider_message_id_idx")
      .on(table.providerMessageId)
      .where(isNotNull(table.providerMessageId)),
    uniqueIndex("audience_snapshots_run_contact_unique")
      .on(table.campaignRunId, table.contactId)
      .where(isNotNull(table.contactId)),
    uniqueIndex("audience_snapshots_run_newsletter_subscriber_unique")
      .on(table.campaignRunId, table.newsletterSubscriberId)
      .where(isNotNull(table.newsletterSubscriberId)),
  ],
);

export const contactConsent = pgTable(
  "contact_consent",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").$type<ConsentScopeType>().notNull(),
    scopeId: text("scope_id"),
    source: text("source").$type<ConsentSource>().notNull(),
    sourceRunId: text("source_run_id").references(() => campaignRuns.id, {
      onDelete: "set null",
    }),
    optedOutAt: timestamp("opted_out_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    createdAt: createdAtColumn,
  },
  (table) => [
    check(
      "contact_consent_scope_type_check",
      sql`${table.scopeType} IN ('project', 'newsletter', 'all')`,
    ),
    check(
      "contact_consent_source_check",
      sql`${table.source} IN ('recipient_click', 'admin_action', 'provider_event', 'import')`,
    ),
    check(
      "contact_consent_scope_shape_check",
      sql`((${table.scopeType} = 'project' AND ${table.scopeId} IS NOT NULL) OR (${table.scopeType} IN ('newsletter', 'all') AND ${table.scopeId} IS NULL))`,
    ),
    index("contact_consent_contact_scope_idx").on(
      table.contactId,
      table.scopeType,
      table.scopeId,
    ),
    uniqueIndex("contact_consent_project_scope_unique")
      .on(table.contactId, table.scopeId)
      .where(sql`${table.scopeType} = 'project'`),
    uniqueIndex("contact_consent_non_project_scope_unique")
      .on(table.contactId, table.scopeType)
      .where(sql`${table.scopeType} IN ('newsletter', 'all')`),
  ],
);

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: text("id").primaryKey(),
    normalizedEmail: text("normalized_email").notNull(),
    reason: text("reason").$type<SuppressionReason>().notNull(),
    firstEventAt: timestamp("first_event_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    lastEventAt: timestamp("last_event_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    lastProviderEventId: text("last_provider_event_id"),
    notes: text("notes"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "suppression_list_reason_check",
      sql`${table.reason} IN ('hard_bounce', 'soft_bounce_strike3', 'complaint', 'manual')`,
    ),
    uniqueIndex("suppression_list_normalized_email_unique").on(
      table.normalizedEmail,
    ),
  ],
);

export const orgSettings = pgTable(
  "org_settings",
  {
    id: text("id").primaryKey(),
    physicalAddressLine1: text("physical_address_line1").notNull().default(""),
    physicalAddressLine2: text("physical_address_line2").notNull().default(""),
    physicalCity: text("physical_city").notNull().default(""),
    physicalState: text("physical_state").notNull().default(""),
    physicalZip: text("physical_zip").notNull().default(""),
    physicalCountry: text("physical_country").notNull().default("US"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check("org_settings_singleton_check", sql`${table.id} = 'singleton'`),
  ],
);

export const orgSenders = pgTable(
  "org_senders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("org_senders_email_unique").on(table.email),
    index("org_senders_created_at_idx").on(table.createdAt),
  ],
);

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    status: text("status").notNull().default("subscribed"),
    memberRating: integer("member_rating"),
    optinTime: timestamp("optin_time", {
      mode: "date",
      withTimezone: true,
    }),
    optinIp: text("optin_ip"),
    confirmTime: timestamp("confirm_time", {
      mode: "date",
      withTimezone: true,
    }),
    confirmIp: text("confirm_ip"),
    lastChangedAt: timestamp("last_changed_at", {
      mode: "date",
      withTimezone: true,
    }),
    interests: text("interests"),
    tags: text("tags"),
    source: text("source").notNull().default("mailchimp_import"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    uniqueIndex("newsletter_subscribers_email_unique").on(table.email),
    index("newsletter_subscribers_member_rating_idx").on(table.memberRating),
    index("newsletter_subscribers_last_changed_at_idx").on(table.lastChangedAt),
  ],
);

export const newsletterSuppressions = pgTable(
  "newsletter_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "newsletter_suppressions_reason_check",
      sql`${table.reason} IN ('unsubscribed', 'cleaned', 'platform_optout')`,
    ),
    uniqueIndex("newsletter_suppressions_email_unique").on(table.email),
  ],
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

export const integrationBackfillJobs = pgTable(
  "integration_backfill_jobs",
  {
    id: text("id").primaryKey(),
    service: text("service").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    triggeredBy: text("triggered_by").notNull(),
    windowStart: timestamp("window_start", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    windowEnd: timestamp("window_end", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    mailbox: text("mailbox"),
    status: text("status").notNull().default("pending"),
    enqueuedAt: timestamp("enqueued_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
    failureReason: text("failure_reason"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    index("integration_backfill_jobs_status_idx").on(
      table.status,
      table.enqueuedAt,
    ),
    index("integration_backfill_jobs_service_idx").on(
      table.service,
      sql`${table.enqueuedAt} DESC`,
    ),
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
      .$type<"canonical_reply" | "snippet" | "pattern" | "corpus_example">()
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

export const salesforceReconciliationRuns = pgTable(
  "salesforce_reconciliation_runs",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    mode: text("mode").$type<"dry_run" | "enforce">().notNull(),
    entityType: text("entity_type")
      .$type<"contact" | "membership" | "project">()
      .notNull(),
    scanned: integer("scanned").notNull().default(0),
    confirmedPresent: integer("confirmed_present").notNull().default(0),
    markedDeleted: integer("marked_deleted").notNull().default(0),
    missingLocallyCount: integer("missing_locally_count").notNull().default(0),
    errors: jsonb("errors").$type<readonly unknown[]>().notNull().default([]),
    abortedReason: text("aborted_reason"),
    createdAt: createdAtColumn,
    updatedAt: updatedAtColumn,
  },
  (table) => [
    check(
      "salesforce_reconciliation_runs_mode_check",
      sql`${table.mode} IN ('dry_run', 'enforce')`,
    ),
    check(
      "salesforce_reconciliation_runs_entity_type_check",
      sql`${table.entityType} IN ('contact', 'membership', 'project')`,
    ),
    index("salesforce_reconciliation_runs_entity_started_idx").on(
      table.entityType,
      table.startedAt.desc(),
    ),
  ],
);
