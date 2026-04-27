DROP TABLE IF EXISTS "project_knowledge_source_links";
DROP TABLE IF EXISTS "project_knowledge_bootstrap_runs";

UPDATE "project_dimensions"
SET
  "project_alias" = 'PNW Biodiversity',
  "updated_at" = now()
WHERE "project_id" = 'a0tVK00000AeJqzYAF';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "project_dimensions"
    WHERE "is_active" = true
      AND (
        "project_alias" IS NULL
        OR btrim("project_alias") = ''
      )
  ) THEN
    RAISE EXCEPTION 'Active projects must have a non-empty project_alias after migration 0029.';
  END IF;
END $$;
