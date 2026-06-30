-- Brick A of PRD #577. Adds org-level cross-project sender storage.
-- Org sendability relies on domain verification, so no per-sender verification
-- state is stored here.

CREATE TABLE "org_senders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "label" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "org_senders_email_unique"
  ON "org_senders" ("email");

CREATE INDEX "org_senders_created_at_idx"
  ON "org_senders" ("created_at");
