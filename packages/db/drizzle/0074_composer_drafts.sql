-- Brick A of PRD #553. Adds durable server-side composer draft storage for
-- email, SMS, and note drafts. Read/write paths and UI wiring ship in later
-- bricks.

CREATE TYPE "composer_pane_mode" AS ENUM (
  'new_draft',
  'replying',
  'forwarding'
);

CREATE TYPE "composer_draft_channel" AS ENUM (
  'email',
  'sms',
  'note'
);

CREATE TYPE "composer_draft_recipient_kind" AS ENUM (
  'contact',
  'email',
  'phone'
);

CREATE TABLE "composer_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" text NOT NULL,
  "pane_mode" "composer_pane_mode" NOT NULL,
  "channel" "composer_draft_channel" NOT NULL,
  "recipient_anchor_kind" "composer_draft_recipient_kind",
  "recipient_contact_id" text,
  "recipient_email" text,
  "recipient_phone" text,
  "subject" text DEFAULT '' NOT NULL,
  "body_plaintext" text DEFAULT '' NOT NULL,
  "body_html" text DEFAULT '' NOT NULL,
  "selected_alias" text,
  "cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_directive" text DEFAULT '' NOT NULL,
  "reply_context_thread_cursor" text,
  "forward_context" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "composer_drafts_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "composer_drafts_recipient_contact_id_contacts_id_fk"
    FOREIGN KEY ("recipient_contact_id")
    REFERENCES "public"."contacts"("id")
    ON DELETE set null
    ON UPDATE no action
);

CREATE INDEX "composer_drafts_actor_updated_idx"
  ON "composer_drafts" ("actor_id", "updated_at" DESC);

CREATE INDEX "composer_drafts_actor_recipient_contact_idx"
  ON "composer_drafts" ("actor_id", "recipient_contact_id")
  WHERE "recipient_contact_id" IS NOT NULL;
