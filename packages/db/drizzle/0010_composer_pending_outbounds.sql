CREATE TYPE "pending_outbound_status" AS ENUM (
  'pending',
  'confirmed',
  'failed',
  'orphaned',
  'superseded'
);

CREATE TABLE "pending_composer_outbounds" (
  "id" text PRIMARY KEY,
  "fingerprint" text NOT NULL,
  "status" "pending_outbound_status" NOT NULL DEFAULT 'pending',
  "actor_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "canonical_contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT,
  "project_id" text REFERENCES "project_dimensions"("project_id") ON DELETE SET NULL,
  "from_alias" text NOT NULL,
  "to_email_normalized" text NOT NULL,
  "subject" text NOT NULL,
  "body_plaintext" text NOT NULL,
  "body_sha256" text NOT NULL,
  "attachment_metadata_json" jsonb NOT NULL DEFAULT '[]',
  "gmail_thread_id" text,
  "in_reply_to_rfc822" text,
  "sent_at" timestamptz NOT NULL,
  "reconciled_event_id" text,
  "reconciled_at" timestamptz,
  "failed_reason" text,
  "orphaned_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pending_composer_outbounds_fingerprint_idx"
ON "pending_composer_outbounds" ("fingerprint");

CREATE INDEX "pending_composer_outbounds_contact_status_idx"
ON "pending_composer_outbounds" ("canonical_contact_id", "status");

CREATE INDEX "pending_composer_outbounds_pending_sweep_idx"
ON "pending_composer_outbounds" ("status", "sent_at")
WHERE "status" = 'pending';
