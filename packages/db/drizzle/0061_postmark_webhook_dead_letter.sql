CREATE TABLE "postmark_webhook_dead_letter" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "record_type" text,
  "message_id" text,
  "source_evidence_id" text REFERENCES "source_evidence_log"("id") ON DELETE set null,
  "payload_json" jsonb NOT NULL,
  "failure_kind" text NOT NULL,
  "failure_message" text NOT NULL,
  "retry_count" integer NOT NULL DEFAULT 0,
  "last_retry_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'pending',
  "terminal_reason" text
);

CREATE INDEX "postmark_webhook_dead_letter_status_received_at_idx"
  ON "postmark_webhook_dead_letter" ("status", "received_at");

CREATE INDEX "postmark_webhook_dead_letter_message_id_idx"
  ON "postmark_webhook_dead_letter" ("message_id")
  WHERE "message_id" IS NOT NULL;
