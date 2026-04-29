DROP INDEX IF EXISTS "source_evidence_log_replay_unique";

CREATE UNIQUE INDEX "source_evidence_log_provider_idempotency_unique"
  ON "source_evidence_log" ("provider", "idempotency_key");

CREATE TABLE "source_evidence_quarantine" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" "provider" NOT NULL,
  "idempotency_key" text NOT NULL,
  "checksum" text NOT NULL,
  "attempted_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "payload_ref" text NOT NULL,
  "details_jsonb" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "source_evidence_quarantine_provider_idempotency_idx"
  ON "source_evidence_quarantine" ("provider", "idempotency_key");
