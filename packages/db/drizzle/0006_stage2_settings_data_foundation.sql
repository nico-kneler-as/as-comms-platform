ALTER TABLE "project_dimensions"
  ADD COLUMN "is_active" boolean NOT NULL DEFAULT false,
  ADD COLUMN "ai_knowledge_url" text,
  ADD COLUMN "ai_knowledge_synced_at" timestamp with time zone;

CREATE TABLE "integration_health" (
  "id" text PRIMARY KEY NOT NULL,
  "service_name" text NOT NULL,
  "category" text NOT NULL,
  "status" text NOT NULL DEFAULT 'not_configured',
  "last_checked_at" timestamp with time zone,
  "detail" text,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "integration_health_updated_at_idx"
ON "integration_health" ("updated_at" DESC);
