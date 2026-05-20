CREATE TABLE "ops_alert_state" (
  "category" text NOT NULL,
  "dedup_key" text NOT NULL,
  "last_sent_at" timestamp with time zone NOT NULL,
  "last_status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_alert_state_pkey" PRIMARY KEY ("category", "dedup_key"),
  CONSTRAINT "ops_alert_state_last_status_check" CHECK ("last_status" IN ('sent'))
);

CREATE INDEX "ops_alert_state_last_sent_at_idx" ON "ops_alert_state" ("last_sent_at");
