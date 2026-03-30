CREATE TYPE "sync_scope" AS ENUM ('provider', 'orchestration');

ALTER TABLE "sync_state"
ADD COLUMN "scope" "sync_scope";

UPDATE "sync_state"
SET "scope" = 'provider'
WHERE "scope" IS NULL;

ALTER TABLE "sync_state"
ALTER COLUMN "scope" SET NOT NULL;

ALTER TABLE "sync_state"
ALTER COLUMN "provider" DROP NOT NULL;

ALTER TABLE "sync_state"
ADD COLUMN "freshness_p95_seconds" integer;

ALTER TABLE "sync_state"
ADD COLUMN "freshness_p99_seconds" integer;

DROP INDEX IF EXISTS "sync_state_provider_job_type_idx";

CREATE INDEX "sync_state_scope_provider_job_type_idx"
ON "sync_state" ("scope", "provider", "job_type", "status");
