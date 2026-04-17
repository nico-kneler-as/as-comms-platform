ALTER TYPE "provider" ADD VALUE IF NOT EXISTS 'manual';
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'note';
ALTER TYPE "canonical_event_type" ADD VALUE IF NOT EXISTS 'note.internal.created';

ALTER TABLE "salesforce_event_context"
ADD COLUMN "source_field" text;

CREATE TABLE "salesforce_communication_details" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "provider_record_id" text NOT NULL,
  "channel" text NOT NULL,
  "message_kind" text NOT NULL,
  "subject" text,
  "snippet" text DEFAULT '' NOT NULL,
  "source_label" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "simpletexting_message_details" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "provider_record_id" text NOT NULL,
  "direction" text NOT NULL,
  "message_kind" text NOT NULL,
  "message_text_preview" text DEFAULT '' NOT NULL,
  "normalized_phone" text,
  "campaign_id" text,
  "campaign_name" text,
  "provider_thread_id" text,
  "thread_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mailchimp_campaign_activity_details" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "provider_record_id" text NOT NULL,
  "activity_type" text NOT NULL,
  "campaign_id" text,
  "audience_id" text,
  "member_id" text,
  "campaign_name" text,
  "snippet" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "manual_note_details" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "provider_record_id" text NOT NULL,
  "body" text NOT NULL,
  "author_display_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "salesforce_communication_details_record_idx"
ON "salesforce_communication_details" ("provider_record_id");

CREATE INDEX "simpletexting_message_details_record_idx"
ON "simpletexting_message_details" ("provider_record_id");

CREATE INDEX "simpletexting_message_details_campaign_idx"
ON "simpletexting_message_details" ("campaign_id");

CREATE INDEX "simpletexting_message_details_thread_idx"
ON "simpletexting_message_details" ("thread_key");

CREATE INDEX "mailchimp_campaign_activity_details_record_idx"
ON "mailchimp_campaign_activity_details" ("provider_record_id");

CREATE INDEX "mailchimp_campaign_activity_details_campaign_idx"
ON "mailchimp_campaign_activity_details" ("campaign_id");

CREATE INDEX "manual_note_details_record_idx"
ON "manual_note_details" ("provider_record_id");
