-- Brick A of PRD #693. Adds automated-email template snapshots and webhook send logs.
-- Flow, delivery-provider, and worker behavior ship in later bricks.

CREATE TABLE "automated_email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" text NOT NULL,
  "kind" text DEFAULT 'custom' NOT NULL,
  "name" text NOT NULL,
  "draft_subject" text DEFAULT '' NOT NULL,
  "draft_doc" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "published_subject" text,
  "published_doc" jsonb,
  "published_at" timestamp with time zone,
  "published_by" text,
  "is_active" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "automated_email_templates_project_id_project_dimensions_project_id_fk"
    FOREIGN KEY ("project_id")
    REFERENCES "public"."project_dimensions"("project_id")
    ON DELETE restrict
    ON UPDATE no action,
  CONSTRAINT "automated_email_templates_published_by_users_id_fk"
    FOREIGN KEY ("published_by")
    REFERENCES "public"."users"("id")
    ON DELETE set null
    ON UPDATE no action,
  CONSTRAINT "automated_email_templates_created_by_users_id_fk"
    FOREIGN KEY ("created_by")
    REFERENCES "public"."users"("id")
    ON DELETE set null
    ON UPDATE no action
);

CREATE INDEX "automated_email_templates_project_idx"
  ON "automated_email_templates" ("project_id");

CREATE TABLE "automated_email_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "project_id" text NOT NULL,
  "expedition_member_id" text NOT NULL,
  "contact_id" text,
  "status" text NOT NULL,
  "status_reason" text,
  "payload" jsonb NOT NULL,
  "rendered_preview" jsonb,
  "ledger_event_id" text,
  "provider_message_id" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "automated_email_sends_template_id_automated_email_templates_id_fk"
    FOREIGN KEY ("template_id")
    REFERENCES "public"."automated_email_templates"("id")
    ON DELETE restrict
    ON UPDATE no action,
  CONSTRAINT "automated_email_sends_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id")
    REFERENCES "public"."contacts"("id")
    ON DELETE set null
    ON UPDATE no action
);

CREATE INDEX "automated_email_sends_template_received_idx"
  ON "automated_email_sends" ("template_id", "received_at" DESC);

CREATE INDEX "automated_email_sends_template_member_received_idx"
  ON "automated_email_sends" (
    "template_id",
    "expedition_member_id",
    "received_at" DESC
  );
