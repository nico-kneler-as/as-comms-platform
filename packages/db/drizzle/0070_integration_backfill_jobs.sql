CREATE TABLE "integration_backfill_jobs" (
  "id" TEXT PRIMARY KEY,
  "service" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "triggered_by" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "window_end" TIMESTAMPTZ NOT NULL,
  "mailbox" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "enqueued_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "result_json" JSONB,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "integration_backfill_jobs_status_idx"
  ON "integration_backfill_jobs" ("status", "enqueued_at");

CREATE INDEX "integration_backfill_jobs_service_idx"
  ON "integration_backfill_jobs" ("service", "enqueued_at" DESC);
