ALTER TABLE "broadcast_link_clicks"
  ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL,
  ADD COLUMN "bot_reason" text;

ALTER TABLE "broadcast_link_clicks"
  ADD CONSTRAINT "broadcast_link_clicks_bot_reason_check"
  CHECK (
    "bot_reason" IS NULL
    OR "bot_reason" IN ('machine_user_agent', 'fast_activity')
  );

CREATE TABLE "broadcast_opens" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_run_id" text NOT NULL,
  "audience_snapshot_id" text,
  "contact_id" text,
  "opened_at" timestamp with time zone NOT NULL,
  "user_agent" text,
  "platform" text,
  "client" jsonb,
  "os" jsonb,
  "geo" jsonb,
  "is_bot" boolean DEFAULT false NOT NULL,
  "bot_reason" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "broadcast_opens_campaign_run_id_campaign_runs_id_fk"
    FOREIGN KEY ("campaign_run_id")
    REFERENCES "public"."campaign_runs"("id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "broadcast_opens_audience_snapshot_id_audience_snapshots_id_fk"
    FOREIGN KEY ("audience_snapshot_id")
    REFERENCES "public"."audience_snapshots"("id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "broadcast_opens_bot_reason_check"
    CHECK (
      "bot_reason" IS NULL
      OR "bot_reason" IN ('machine_user_agent', 'fast_activity')
    )
);

CREATE UNIQUE INDEX "broadcast_opens_idempotency_key_unique"
  ON "broadcast_opens" ("idempotency_key");

CREATE INDEX "broadcast_opens_campaign_run_id_idx"
  ON "broadcast_opens" ("campaign_run_id");
