CREATE TYPE "provider" AS ENUM ('gmail', 'salesforce', 'simpletexting', 'mailchimp');
CREATE TYPE "record_source" AS ENUM ('gmail', 'salesforce', 'simpletexting', 'mailchimp', 'manual', 'system');
CREATE TYPE "channel" AS ENUM ('email', 'sms', 'lifecycle', 'campaign_email');
CREATE TYPE "canonical_event_type" AS ENUM (
  'communication.email.inbound',
  'communication.email.outbound',
  'communication.sms.inbound',
  'communication.sms.outbound',
  'communication.sms.opt_in',
  'communication.sms.opt_out',
  'lifecycle.signed_up',
  'lifecycle.received_training',
  'lifecycle.completed_training',
  'lifecycle.submitted_first_data',
  'campaign.email.sent',
  'campaign.email.opened',
  'campaign.email.clicked',
  'campaign.email.unsubscribed'
);
CREATE TYPE "review_state" AS ENUM ('clear', 'needs_identity_review', 'needs_routing_review', 'quarantined');
CREATE TYPE "contact_identity_kind" AS ENUM ('salesforce_contact_id', 'volunteer_id_plain', 'email', 'phone');
CREATE TYPE "inbox_bucket" AS ENUM ('New', 'Opened');
CREATE TYPE "identity_resolution_reason_code" AS ENUM (
  'identity_missing_anchor',
  'identity_multi_candidate',
  'identity_conflict',
  'identity_anchor_mismatch'
);
CREATE TYPE "routing_review_reason_code" AS ENUM (
  'routing_missing_membership',
  'routing_multiple_memberships',
  'routing_context_conflict'
);
CREATE TYPE "review_case_status" AS ENUM ('open', 'resolved', 'quarantined');
CREATE TYPE "sync_job_type" AS ENUM (
  'historical_backfill',
  'live_ingest',
  'projection_rebuild',
  'parity_snapshot',
  'final_delta_sync',
  'dead_letter_reprocess'
);
CREATE TYPE "sync_status" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'quarantined', 'cancelled');
CREATE TYPE "audit_actor_type" AS ENUM ('system', 'user', 'worker', 'provider');
CREATE TYPE "audit_result" AS ENUM ('allowed', 'denied', 'recorded');

CREATE TABLE "source_evidence_log" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" "provider" NOT NULL,
  "provider_record_type" text NOT NULL,
  "provider_record_id" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "payload_ref" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "checksum" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "salesforce_contact_id" text,
  "display_name" text NOT NULL,
  "primary_email" text,
  "primary_phone" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "contact_identities" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "kind" "contact_identity_kind" NOT NULL,
  "normalized_value" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source" "record_source" NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "project_id" text,
  "expedition_id" text,
  "role" text,
  "status" text,
  "source" "record_source" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "canonical_event_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "event_type" "canonical_event_type" NOT NULL,
  "channel" "channel" NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "source_evidence_id" text NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE restrict,
  "idempotency_key" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "review_state" "review_state" DEFAULT 'clear' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "identity_resolution_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "source_evidence_id" text NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE restrict,
  "candidate_contact_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "reason_code" "identity_resolution_reason_code" NOT NULL,
  "status" "review_case_status" DEFAULT 'open' NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "normalized_identity_values" text[] DEFAULT '{}'::text[] NOT NULL,
  "anchored_contact_id" text REFERENCES "contacts"("id") ON DELETE set null,
  "explanation" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "routing_review_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "source_evidence_id" text NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE restrict,
  "reason_code" "routing_review_reason_code" NOT NULL,
  "status" "review_case_status" DEFAULT 'open' NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "candidate_membership_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "explanation" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_inbox_projection" (
  "contact_id" text PRIMARY KEY NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "bucket" "inbox_bucket" NOT NULL,
  "is_starred" boolean DEFAULT false NOT NULL,
  "has_unresolved" boolean DEFAULT false NOT NULL,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone NOT NULL,
  "snippet" text DEFAULT '' NOT NULL,
  "last_canonical_event_id" text NOT NULL REFERENCES "canonical_event_ledger"("id") ON DELETE restrict,
  "last_event_type" "canonical_event_type" NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_timeline_projection" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "canonical_event_id" text NOT NULL REFERENCES "canonical_event_ledger"("id") ON DELETE cascade,
  "occurred_at" timestamp with time zone NOT NULL,
  "sort_key" text NOT NULL,
  "event_type" "canonical_event_type" NOT NULL,
  "summary" text NOT NULL,
  "channel" "channel" NOT NULL,
  "primary_provider" "provider" NOT NULL,
  "review_state" "review_state" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sync_state" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" "provider" NOT NULL,
  "job_type" "sync_job_type" NOT NULL,
  "cursor" text,
  "window_start" timestamp with time zone,
  "window_end" timestamp with time zone,
  "status" "sync_status" NOT NULL,
  "parity_percent" numeric(5, 2),
  "last_successful_at" timestamp with time zone,
  "dead_letter_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_policy_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_type" "audit_actor_type" NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "result" "audit_result" NOT NULL,
  "policy_code" text NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "source_evidence_log_replay_unique" ON "source_evidence_log" ("provider", "idempotency_key", "checksum");
CREATE INDEX "source_evidence_log_provider_record_idx" ON "source_evidence_log" ("provider", "provider_record_type", "provider_record_id");
CREATE UNIQUE INDEX "contacts_salesforce_contact_id_unique" ON "contacts" ("salesforce_contact_id");
CREATE INDEX "contacts_primary_email_idx" ON "contacts" ("primary_email");
CREATE INDEX "contacts_primary_phone_idx" ON "contacts" ("primary_phone");
CREATE UNIQUE INDEX "contact_identities_contact_value_unique" ON "contact_identities" ("contact_id", "kind", "normalized_value");
CREATE INDEX "contact_identities_kind_value_idx" ON "contact_identities" ("kind", "normalized_value");
CREATE INDEX "contact_memberships_contact_idx" ON "contact_memberships" ("contact_id");
CREATE INDEX "contact_memberships_context_idx" ON "contact_memberships" ("project_id", "expedition_id");
CREATE UNIQUE INDEX "canonical_event_ledger_idempotency_key_unique" ON "canonical_event_ledger" ("idempotency_key");
CREATE INDEX "canonical_event_ledger_contact_occurred_idx" ON "canonical_event_ledger" ("contact_id", "occurred_at");
CREATE INDEX "canonical_event_ledger_source_evidence_idx" ON "canonical_event_ledger" ("source_evidence_id");
CREATE INDEX "identity_resolution_queue_source_evidence_idx" ON "identity_resolution_queue" ("source_evidence_id");
CREATE INDEX "identity_resolution_queue_status_idx" ON "identity_resolution_queue" ("status", "reason_code");
CREATE INDEX "routing_review_queue_contact_idx" ON "routing_review_queue" ("contact_id");
CREATE INDEX "routing_review_queue_status_idx" ON "routing_review_queue" ("status", "reason_code");
CREATE INDEX "contact_inbox_projection_bucket_idx" ON "contact_inbox_projection" ("bucket", "last_activity_at");
CREATE INDEX "contact_inbox_projection_unresolved_idx" ON "contact_inbox_projection" ("has_unresolved", "last_activity_at");
CREATE UNIQUE INDEX "contact_timeline_projection_canonical_event_unique" ON "contact_timeline_projection" ("canonical_event_id");
CREATE INDEX "contact_timeline_projection_contact_sort_idx" ON "contact_timeline_projection" ("contact_id", "sort_key");
CREATE INDEX "sync_state_provider_job_type_idx" ON "sync_state" ("provider", "job_type", "status");
CREATE INDEX "audit_policy_evidence_entity_idx" ON "audit_policy_evidence" ("entity_type", "entity_id");
CREATE INDEX "audit_policy_evidence_actor_idx" ON "audit_policy_evidence" ("actor_type", "actor_id");
CREATE INDEX "audit_policy_evidence_occurred_at_idx" ON "audit_policy_evidence" ("occurred_at");
