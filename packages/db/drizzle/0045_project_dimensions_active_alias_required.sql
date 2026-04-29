-- Active projects must have a non-empty project_alias.
--
-- Background: project_dimensions.project_alias is the operator-friendly short
-- name (e.g. "PNW Biodiversity") used in the inbox sidebar chip and the
-- Settings → Projects subtitle. The display layer falls back to project_name
-- when alias is null; production has 3 active rows with alias = NULL, so the
-- UI shows the long marketing name. The Settings UI guards against this
-- (apps/web/app/settings/actions.ts:711) but the DB has no enforcement, so
-- any non-action-layer write could land an active row without an alias.
--
-- Step 1: backfill active rows missing an alias with a mechanical default
--         derived from project_name. Operator can edit through the existing
--         /settings/projects/{projectId} UI (or the new ops:backfill script)
--         to override with operator-chosen aliases.
-- Step 2: add a CHECK constraint so the same gap can't reopen.

UPDATE "project_dimensions"
   SET "project_alias" = LEFT(BTRIM("project_name"), 40),
       "updated_at" = NOW()
 WHERE "is_active" = true
   AND ("project_alias" IS NULL OR BTRIM("project_alias") = '');

ALTER TABLE "project_dimensions"
  ADD CONSTRAINT "project_dimensions_active_alias_required"
  CHECK (
    "is_active" = false
    OR ("project_alias" IS NOT NULL AND BTRIM("project_alias") <> '')
  );
