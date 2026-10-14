CREATE TABLE "user_workspaces" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "workspace" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_workspaces_pkey" PRIMARY KEY ("user_id", "workspace"),
  CONSTRAINT "user_workspaces_workspace_check" CHECK (
    "workspace" IN ('volunteers', 'donors')
  )
);

INSERT INTO "user_workspaces" ("user_id", "workspace")
SELECT "id", 'volunteers'
FROM "users"
ON CONFLICT DO NOTHING;

ALTER TABLE "campaign_runs"
  ADD COLUMN "workspace" text NOT NULL DEFAULT 'volunteers';

UPDATE "campaign_runs"
SET "workspace" = 'volunteers';

ALTER TABLE "campaign_runs"
  ADD CONSTRAINT "campaign_runs_workspace_check"
  CHECK ("workspace" IN ('volunteers', 'donors'));

DROP VIEW "campaign_run_projection";

CREATE VIEW "campaign_run_projection" AS
SELECT
  "id" AS "run_id",
  'postmark'::text AS "provider",
  "workspace",
  "kind",
  "launch_type",
  "state",
  "project_id",
  COALESCE("from_email", '') AS "sender",
  COALESCE("subject_template", '') AS "subject",
  "audience_size",
  "scheduled_at",
  "started_at",
  "completed_at",
  "cancelled_at",
  "created_at",
  "updated_at"
FROM "campaign_runs"
UNION ALL
SELECT
  "campaign_id" AS "run_id",
  'mailchimp'::text AS "provider",
  'volunteers'::text AS "workspace",
  'newsletter'::text AS "kind",
  'html_email'::text AS "launch_type",
  'complete'::text AS "state",
  NULL::text AS "project_id",
  ''::text AS "sender",
  COALESCE("campaign_name", '') AS "subject",
  NULL::integer AS "audience_size",
  NULL::timestamptz AS "scheduled_at",
  MIN("created_at") AS "started_at",
  MAX("created_at") AS "completed_at",
  NULL::timestamptz AS "cancelled_at",
  MIN("created_at") AS "created_at",
  MAX("updated_at") AS "updated_at"
FROM "mailchimp_campaign_activity_details"
WHERE "campaign_id" IS NOT NULL
GROUP BY "campaign_id", "campaign_name";
