-- Brick 1 of PRD #544. Adds tombstone (`salesforce_deleted_at`) and
-- last-confirmed-present (`salesforce_reconciled_at`) columns to the three
-- Salesforce-anchored tables, plus a new `salesforce_reconciliation_runs`
-- log table that the weekly reconciler will write one row per (run, entity)
-- to. Reconciler itself ships in Brick 2.

ALTER TABLE "contacts"
  ADD COLUMN "salesforce_deleted_at" timestamp with time zone,
  ADD COLUMN "salesforce_reconciled_at" timestamp with time zone;

ALTER TABLE "contact_memberships"
  ADD COLUMN "salesforce_deleted_at" timestamp with time zone,
  ADD COLUMN "salesforce_reconciled_at" timestamp with time zone;

ALTER TABLE "project_dimensions"
  ADD COLUMN "salesforce_deleted_at" timestamp with time zone,
  ADD COLUMN "salesforce_reconciled_at" timestamp with time zone;

CREATE TABLE "salesforce_reconciliation_runs" (
  "id" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "mode" text NOT NULL,
  "entity_type" text NOT NULL,
  "scanned" integer NOT NULL DEFAULT 0,
  "confirmed_present" integer NOT NULL DEFAULT 0,
  "marked_deleted" integer NOT NULL DEFAULT 0,
  "missing_locally_count" integer NOT NULL DEFAULT 0,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "aborted_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "salesforce_reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesforce_reconciliation_runs_mode_check"
    CHECK ("mode" IN ('dry_run', 'enforce')),
  CONSTRAINT "salesforce_reconciliation_runs_entity_type_check"
    CHECK ("entity_type" IN ('contact', 'membership', 'project'))
);

CREATE INDEX "salesforce_reconciliation_runs_entity_started_idx"
  ON "salesforce_reconciliation_runs" ("entity_type", "started_at" DESC);
