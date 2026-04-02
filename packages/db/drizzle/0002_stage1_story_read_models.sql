CREATE TABLE "project_dimensions" (
  "project_id" text PRIMARY KEY NOT NULL,
  "project_name" text NOT NULL,
  "source" "record_source" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "expedition_dimensions" (
  "expedition_id" text PRIMARY KEY NOT NULL,
  "project_id" text,
  "expedition_name" text NOT NULL,
  "source" "record_source" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "gmail_message_details" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "provider_record_id" text NOT NULL,
  "gmail_thread_id" text,
  "rfc822_message_id" text,
  "direction" text NOT NULL,
  "subject" text,
  "snippet_clean" text DEFAULT '' NOT NULL,
  "body_text_preview" text DEFAULT '' NOT NULL,
  "captured_mailbox" text,
  "project_inbox_alias" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "salesforce_event_context" (
  "source_evidence_id" text PRIMARY KEY NOT NULL REFERENCES "source_evidence_log"("id") ON DELETE cascade,
  "salesforce_contact_id" text,
  "project_id" text,
  "expedition_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "expedition_dimensions_project_idx"
ON "expedition_dimensions" ("project_id");

CREATE INDEX "gmail_message_details_record_idx"
ON "gmail_message_details" ("provider_record_id");

CREATE INDEX "gmail_message_details_thread_idx"
ON "gmail_message_details" ("gmail_thread_id");

CREATE INDEX "salesforce_event_context_contact_idx"
ON "salesforce_event_context" ("salesforce_contact_id");

CREATE INDEX "salesforce_event_context_context_idx"
ON "salesforce_event_context" ("project_id", "expedition_id");
