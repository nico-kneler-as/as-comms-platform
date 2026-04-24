CREATE TABLE "project_knowledge_source_links" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "kind" text NOT NULL,
  "label" text,
  "url" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "project_knowledge_source_links_project_idx"
  ON "project_knowledge_source_links" ("project_id");

CREATE TABLE "project_knowledge_bootstrap_runs" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "status" text NOT NULL,
  "force" boolean NOT NULL DEFAULT false,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "stats_json" jsonb NOT NULL DEFAULT '{}',
  "error_detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "project_knowledge_bootstrap_runs_project_idx"
  ON "project_knowledge_bootstrap_runs" ("project_id", "started_at" DESC);
