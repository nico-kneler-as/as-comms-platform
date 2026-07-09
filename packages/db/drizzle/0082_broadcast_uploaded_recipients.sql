ALTER TABLE "audience_snapshots"
  DROP CONSTRAINT "audience_snapshots_recipient_check";

ALTER TABLE "audience_snapshots"
  ADD CONSTRAINT "audience_snapshots_recipient_check"
  CHECK (
    num_nonnulls("contact_id", "newsletter_subscriber_id") <= 1
  );

CREATE TABLE "broadcast_uploaded_recipients" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_run_id" text NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "broadcast_uploaded_recipients_campaign_run_id_campaign_runs_id_fk"
    FOREIGN KEY ("campaign_run_id")
    REFERENCES "public"."campaign_runs"("id")
    ON DELETE cascade
    ON UPDATE no action
);

CREATE INDEX "broadcast_uploaded_recipients_campaign_run_id_idx"
  ON "broadcast_uploaded_recipients" ("campaign_run_id");
