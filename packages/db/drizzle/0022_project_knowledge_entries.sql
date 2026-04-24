CREATE TABLE "project_knowledge_entries" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "kind" text NOT NULL,
  "issue_type" text,
  "volunteer_stage" text,
  "question_summary" text NOT NULL,
  "reply_strategy" text,
  "masked_example" text,
  "source_kind" text NOT NULL,
  "approved_for_ai" boolean NOT NULL DEFAULT false,
  "source_event_id" text,
  "metadata_json" jsonb NOT NULL DEFAULT '{}',
  "last_reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "project_knowledge_entries_project_id_idx"
  ON "project_knowledge_entries" ("project_id");

CREATE INDEX "project_knowledge_entries_approved_idx"
  ON "project_knowledge_entries" ("project_id", "approved_for_ai");

CREATE INDEX "project_knowledge_entries_issue_type_idx"
  ON "project_knowledge_entries" ("project_id", "issue_type")
  WHERE "approved_for_ai" = true;
