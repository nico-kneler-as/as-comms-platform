ALTER TABLE "campaign_runs"
  ADD COLUMN "subject_template_b" text,
  ADD COLUMN "ab_test_enabled" boolean DEFAULT false NOT NULL;

ALTER TABLE "audience_snapshots"
  ADD COLUMN "subject_variant" text;

ALTER TABLE "audience_snapshots"
  ADD CONSTRAINT "audience_snapshots_subject_variant_check"
  CHECK (
    "subject_variant" IS NULL
    OR "subject_variant" IN ('a', 'b')
  );
