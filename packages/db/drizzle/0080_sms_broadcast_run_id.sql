ALTER TABLE "sms_messages"
  ADD COLUMN "broadcast_run_id" text REFERENCES "campaign_runs" ("id") ON DELETE CASCADE;

CREATE INDEX "sms_messages_broadcast_run_id_idx"
  ON "sms_messages" ("broadcast_run_id")
  WHERE "broadcast_run_id" IS NOT NULL;
