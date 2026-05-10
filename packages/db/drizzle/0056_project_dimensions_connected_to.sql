-- Connected sub-project relationship for the shared-alias / shared-AI-knowledge
-- pattern (e.g. Beech & Butternut both running under forests@adventurescientists.org).
--
-- One project (host) owns the alias and AI knowledge; one or more "connected
-- sub-projects" point at that host via connected_to_project_id and get rolled
-- up into the host's inbox/dashboard views without owning their own alias.
--
-- This is data-foundation only. UX (Settings wizard, project detail page,
-- contact rail) and AI Knowledge fallback land in follow-up PRs. After this
-- migration applies, an operator can manually:
--   UPDATE project_dimensions SET connected_to_project_id = '<host>'
--     WHERE project_id = '<sub>';
-- to test the rollup.

-- Step 1: new column with FK + ON DELETE SET NULL.
-- Disconnect-on-host-delete is the safe default; the trigger below also
-- prevents chains so a connected sub-project can't itself become a host.
ALTER TABLE "project_dimensions"
  ADD COLUMN "connected_to_project_id" text;

ALTER TABLE "project_dimensions"
  ADD CONSTRAINT "project_dimensions_connected_to_project_id_fkey"
  FOREIGN KEY ("connected_to_project_id")
    REFERENCES "project_dimensions" ("project_id")
    ON DELETE SET NULL;

-- Step 2: index for the rollup queries that fan out from a host id.
CREATE INDEX "project_dimensions_connected_to_idx"
  ON "project_dimensions" ("connected_to_project_id");

-- Step 3: relax the active-alias CHECK so connected sub-projects can be active
-- without owning their own alias. The original constraint (added in 0045)
-- required is_active=false OR alias-non-empty; the new constraint adds an OR
-- branch for "has a connection".
ALTER TABLE "project_dimensions"
  DROP CONSTRAINT "project_dimensions_active_alias_required";

ALTER TABLE "project_dimensions"
  ADD CONSTRAINT "project_dimensions_active_alias_required"
  CHECK (
    "is_active" = false
    OR ("project_alias" IS NOT NULL AND BTRIM("project_alias") <> '')
    OR "connected_to_project_id" IS NOT NULL
  );

-- Step 4: chain prevention. A connected sub-project's connected_to_project_id
-- must point at a HOST — i.e. a project whose own connected_to_project_id is
-- NULL. Postgres CHECK constraints can't run sub-queries, so this lives in a
-- BEFORE INSERT OR UPDATE trigger.
CREATE OR REPLACE FUNCTION "project_dimensions_no_chained_connections"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_connected_to text;
BEGIN
  IF NEW."connected_to_project_id" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."connected_to_project_id" = NEW."project_id" THEN
    RAISE EXCEPTION 'Connected projects cannot point at themselves: %.', NEW."project_id"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "connected_to_project_id"
    INTO parent_connected_to
    FROM "project_dimensions"
    WHERE "project_id" = NEW."connected_to_project_id";

  IF parent_connected_to IS NOT NULL THEN
    RAISE EXCEPTION 'Connected projects cannot be chained: % already has a connection.',
      NEW."connected_to_project_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "project_dimensions_no_chained_connections_trigger"
  BEFORE INSERT OR UPDATE OF "connected_to_project_id"
  ON "project_dimensions"
  FOR EACH ROW
  WHEN (NEW."connected_to_project_id" IS NOT NULL)
  EXECUTE FUNCTION "project_dimensions_no_chained_connections"();

-- Step 5: also prevent a host from acquiring a connection while it still has
-- connected sub-projects (would create a chain in the other direction). This
-- runs as a separate trigger so the WHEN clause stays simple.
CREATE OR REPLACE FUNCTION "project_dimensions_no_host_with_connection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_count int;
BEGIN
  IF NEW."connected_to_project_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO child_count
    FROM "project_dimensions"
    WHERE "connected_to_project_id" = NEW."project_id";

  IF child_count > 0 THEN
    RAISE EXCEPTION 'Connected projects cannot be chained: % already has a connection.',
      NEW."project_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "project_dimensions_no_host_with_connection_trigger"
  BEFORE INSERT OR UPDATE OF "connected_to_project_id"
  ON "project_dimensions"
  FOR EACH ROW
  WHEN (NEW."connected_to_project_id" IS NOT NULL)
  EXECUTE FUNCTION "project_dimensions_no_host_with_connection"();
