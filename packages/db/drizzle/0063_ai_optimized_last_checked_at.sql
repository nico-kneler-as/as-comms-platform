-- Add ai_optimized_last_checked_at to project_dimensions.
--
-- Why: the synthesis orchestrator's skip-if-unchanged optimization
-- (PRD #366 Phase 2) correctly skips Anthropic calls when source content
-- hashes match the stored ai_optimized_input_hash. But that meant
-- ai_optimized_synthesized_at stayed frozen at the last content-generating
-- run, and the auto-sync hourly cron silently completed every hour with no
-- visible signal. Operators reported "auto-sync is broken" (2026-05-21,
-- PNW Biodiversity + Killer Whales stuck at May 10 despite Weekly schedule).
--
-- Solution: track a separate "last verified" timestamp that bumps on every
-- successful orchestrator run, whether or not Anthropic was called. The
-- UI then surfaces both:
--   - "Last synthesized: <content gen time>"
--   - "Last checked: <verification cycle>"
-- so operators can confirm auto-sync is running even when nothing has
-- changed.
--
-- Backfill: NULL is the correct seed value for never-checked projects.
-- Already-active projects with a non-null ai_optimized_synthesized_at get
-- their last_checked_at backfilled to the same timestamp so the first
-- UI render after deploy doesn't show "Never" for a project that was
-- demonstrably synthesized.

ALTER TABLE "project_dimensions"
ADD COLUMN "ai_optimized_last_checked_at" timestamp with time zone;

UPDATE "project_dimensions"
SET "ai_optimized_last_checked_at" = "ai_optimized_synthesized_at"
WHERE "ai_optimized_synthesized_at" IS NOT NULL;
