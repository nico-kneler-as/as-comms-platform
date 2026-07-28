CREATE TABLE "ops_digest_watermark" (
  "id" text PRIMARY KEY NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_digest_sent_at" timestamp with time zone,
  "quiet_streak_started_at" timestamp with time zone,
  "sync_state_dead_letter_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seen_postmark_webhook_dead_letter_received_at" timestamp with time zone,
  "last_seen_postmark_webhook_dead_letter_id" uuid,
  "last_seen_identity_resolution_opened_at" timestamp with time zone,
  "last_seen_identity_resolution_case_id" text,
  "last_seen_routing_review_opened_at" timestamp with time zone,
  "last_seen_routing_review_case_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "ops_digest_watermark_last_digest_sent_at_idx"
  ON "ops_digest_watermark" ("last_digest_sent_at");
