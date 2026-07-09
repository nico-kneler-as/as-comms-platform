CREATE TABLE "broadcast_link_clicks" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_run_id" text NOT NULL,
  "audience_snapshot_id" text,
  "contact_id" text,
  "original_link" text NOT NULL,
  "clicked_at" timestamp with time zone NOT NULL,
  "user_agent" text,
  "platform" text,
  "client" jsonb,
  "os" jsonb,
  "geo" jsonb,
  "idempotency_key" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "broadcast_link_clicks_campaign_run_id_campaign_runs_id_fk"
    FOREIGN KEY ("campaign_run_id")
    REFERENCES "public"."campaign_runs"("id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "broadcast_link_clicks_audience_snapshot_id_audience_snapshots_id_fk"
    FOREIGN KEY ("audience_snapshot_id")
    REFERENCES "public"."audience_snapshots"("id")
    ON DELETE cascade
    ON UPDATE no action
);

CREATE INDEX "broadcast_link_clicks_campaign_run_id_idx"
  ON "broadcast_link_clicks" ("campaign_run_id");
