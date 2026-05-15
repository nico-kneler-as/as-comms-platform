ALTER TYPE "canonical_event_type"
  ADD VALUE IF NOT EXISTS 'campaign.email.delivered';

ALTER TYPE "canonical_event_type"
  ADD VALUE IF NOT EXISTS 'campaign.email.bounced';

ALTER TYPE "canonical_event_type"
  ADD VALUE IF NOT EXISTS 'campaign.email.complained';

CREATE TABLE "campaign_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "launch_type" text NOT NULL,
  "state" text NOT NULL,
  "project_id" text REFERENCES "project_dimensions"("project_id") ON DELETE restrict,
  "from_email" text,
  "from_name" text,
  "reply_to_email" text,
  "subject_template" text,
  "body_html_template" text,
  "body_text_template" text,
  "preheader" text,
  "audience_criteria" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "audience_size" integer,
  "scheduled_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_reason" text,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "last_edited_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_runs_kind_check" CHECK (
    "kind" IN ('newsletter', 'project')
  ),
  CONSTRAINT "campaign_runs_launch_type_check" CHECK (
    "launch_type" IN ('normal_email', 'html_email', 'sms')
  ),
  CONSTRAINT "campaign_runs_state_check" CHECK (
    "state" IN ('draft', 'scheduled', 'sending', 'complete', 'finalized', 'cancelled')
  )
);

CREATE INDEX "campaign_runs_state_scheduled_idx"
  ON "campaign_runs" ("state", "scheduled_at");

CREATE INDEX "campaign_runs_project_id_idx"
  ON "campaign_runs" ("project_id")
  WHERE "project_id" IS NOT NULL;

CREATE INDEX "campaign_runs_created_at_idx"
  ON "campaign_runs" ("created_at" DESC);

CREATE TABLE "audience_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_run_id" text NOT NULL REFERENCES "campaign_runs"("id") ON DELETE cascade,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "frozen_email" text NOT NULL,
  "frozen_first_name" text,
  "frozen_project_name" text,
  "frozen_project_id" text,
  "frozen_alias_email" text,
  "unsubscribe_token" text NOT NULL,
  "delivery_status" text NOT NULL DEFAULT 'pending',
  "provider_message_id" text,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "bounced_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "clicked_at" timestamp with time zone,
  "complained_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audience_snapshots_delivery_status_check" CHECK (
    "delivery_status" IN (
      'pending',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'unsubscribed',
      'failed',
      'suppressed_at_send'
    )
  )
);

CREATE INDEX "audience_snapshots_run_id_idx"
  ON "audience_snapshots" ("campaign_run_id");

CREATE INDEX "audience_snapshots_contact_id_idx"
  ON "audience_snapshots" ("contact_id");

CREATE UNIQUE INDEX "audience_snapshots_unsubscribe_token_idx"
  ON "audience_snapshots" ("unsubscribe_token");

CREATE INDEX "audience_snapshots_provider_message_id_idx"
  ON "audience_snapshots" ("provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;

CREATE UNIQUE INDEX "audience_snapshots_run_contact_unique"
  ON "audience_snapshots" ("campaign_run_id", "contact_id");

CREATE TABLE "contact_consent" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "scope_type" text NOT NULL,
  "scope_id" text,
  "source" text NOT NULL,
  "source_run_id" text REFERENCES "campaign_runs"("id") ON DELETE set null,
  "opted_out_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contact_consent_scope_type_check" CHECK (
    "scope_type" IN ('project', 'newsletter', 'all')
  ),
  CONSTRAINT "contact_consent_source_check" CHECK (
    "source" IN ('recipient_click', 'admin_action', 'provider_event', 'import')
  ),
  CONSTRAINT "contact_consent_scope_shape_check" CHECK (
    (
      "scope_type" = 'project'
      AND "scope_id" IS NOT NULL
    )
    OR (
      "scope_type" IN ('newsletter', 'all')
      AND "scope_id" IS NULL
    )
  )
);

CREATE INDEX "contact_consent_contact_scope_idx"
  ON "contact_consent" ("contact_id", "scope_type", "scope_id");

CREATE UNIQUE INDEX "contact_consent_project_scope_unique"
  ON "contact_consent" ("contact_id", "scope_id")
  WHERE "scope_type" = 'project';

CREATE UNIQUE INDEX "contact_consent_non_project_scope_unique"
  ON "contact_consent" ("contact_id", "scope_type")
  WHERE "scope_type" IN ('newsletter', 'all');

CREATE TABLE "suppression_list" (
  "id" text PRIMARY KEY NOT NULL,
  "normalized_email" text NOT NULL,
  "reason" text NOT NULL,
  "first_event_at" timestamp with time zone NOT NULL,
  "last_event_at" timestamp with time zone NOT NULL,
  "last_provider_event_id" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "suppression_list_reason_check" CHECK (
    "reason" IN ('hard_bounce', 'soft_bounce_strike3', 'complaint', 'manual')
  )
);

CREATE UNIQUE INDEX "suppression_list_normalized_email_unique"
  ON "suppression_list" ("normalized_email");

CREATE TABLE "org_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "physical_address_line1" text NOT NULL DEFAULT '',
  "physical_address_line2" text NOT NULL DEFAULT '',
  "physical_city" text NOT NULL DEFAULT '',
  "physical_state" text NOT NULL DEFAULT '',
  "physical_zip" text NOT NULL DEFAULT '',
  "physical_country" text NOT NULL DEFAULT 'US',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "org_settings_singleton_check" CHECK ("id" = 'singleton')
);

INSERT INTO "org_settings" ("id")
VALUES ('singleton');

ALTER TABLE "project_dimensions"
  ADD COLUMN "postmark_sender_status" text NOT NULL DEFAULT 'unverified';

ALTER TABLE "project_dimensions"
  ADD CONSTRAINT "project_dimensions_postmark_sender_status_check"
  CHECK (
    "postmark_sender_status" IN ('unverified', 'pending', 'verified', 'rejected')
  );

CREATE VIEW "campaign_run_projection" AS
SELECT
  "id" AS "run_id",
  'postmark'::text AS "provider",
  "kind",
  "launch_type",
  "state",
  "project_id",
  COALESCE("from_email", '') AS "sender",
  COALESCE("subject_template", '') AS "subject",
  "audience_size",
  "scheduled_at",
  "started_at",
  "completed_at",
  "cancelled_at",
  "created_at",
  "updated_at"
FROM "campaign_runs"
UNION ALL
SELECT
  "campaign_id" AS "run_id",
  'mailchimp'::text AS "provider",
  'newsletter'::text AS "kind",
  'html_email'::text AS "launch_type",
  'complete'::text AS "state",
  NULL::text AS "project_id",
  ''::text AS "sender",
  COALESCE("campaign_name", '') AS "subject",
  NULL::integer AS "audience_size",
  NULL::timestamptz AS "scheduled_at",
  MIN("created_at") AS "started_at",
  MAX("created_at") AS "completed_at",
  NULL::timestamptz AS "cancelled_at",
  MIN("created_at") AS "created_at",
  MAX("updated_at") AS "updated_at"
FROM "mailchimp_campaign_activity_details"
WHERE "campaign_id" IS NOT NULL
GROUP BY "campaign_id", "campaign_name";
