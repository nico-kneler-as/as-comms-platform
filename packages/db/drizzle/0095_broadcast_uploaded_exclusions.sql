CREATE TABLE "broadcast_uploaded_exclusions" (
  "id" text PRIMARY KEY,
  "campaign_run_id" text NOT NULL REFERENCES "campaign_runs"("id") ON DELETE CASCADE,
  "normalized_email" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "broadcast_uploaded_exclusions_run_email_unique"
    UNIQUE ("campaign_run_id", "normalized_email")
);

CREATE INDEX "broadcast_uploaded_exclusions_campaign_run_id_idx"
  ON "broadcast_uploaded_exclusions" ("campaign_run_id");
