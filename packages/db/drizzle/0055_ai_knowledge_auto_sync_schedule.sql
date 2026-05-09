ALTER TABLE "project_dimensions"
  ADD COLUMN "ai_auto_sync_schedule" text NOT NULL DEFAULT 'never',
  ADD CONSTRAINT "project_dimensions_ai_auto_sync_schedule_valid"
    CHECK ("ai_auto_sync_schedule" IN ('never', 'daily', 'weekly'));
