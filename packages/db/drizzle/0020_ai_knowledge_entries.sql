CREATE TABLE "ai_knowledge_entries" (
  "id" text PRIMARY KEY,
  "scope" text NOT NULL,
  "scope_key" text,
  "source_provider" text NOT NULL,
  "source_id" text NOT NULL,
  "source_url" text,
  "title" text,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_last_edited_at" timestamptz,
  "synced_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "ai_knowledge_entries_source_idx"
ON "ai_knowledge_entries" ("source_provider", "source_id");

CREATE INDEX "ai_knowledge_entries_scope_idx"
ON "ai_knowledge_entries" ("scope", "scope_key");
