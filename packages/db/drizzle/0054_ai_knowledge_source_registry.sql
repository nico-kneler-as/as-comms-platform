ALTER TABLE "project_dimensions"
  ADD COLUMN "ai_knowledge_sources" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "project_dimensions"
  ADD COLUMN "ai_operating_context" text NOT NULL DEFAULT '';

ALTER TABLE "project_dimensions"
  ADD COLUMN "ai_optimized_synthesized_at" timestamp with time zone;

ALTER TABLE "project_dimensions"
  ADD COLUMN "ai_optimized_input_hash" text;

WITH project_cache AS (
  SELECT
    pd."project_id",
    pd."ai_knowledge_url",
    pd."ai_knowledge_synced_at",
    ake."content_hash" AS "source_content_hash",
    LOWER(
      SUBSTRING(
        REPLACE(pd."ai_knowledge_url", '-', '')
        FROM '([0-9a-fA-F]{32})'
      )
    ) AS "source_id"
  FROM "project_dimensions" pd
  LEFT JOIN "ai_knowledge_entries" ake
    ON ake."scope" = 'project'
   AND ake."scope_key" = pd."project_id"
   AND ake."source_provider" = 'notion'
  WHERE pd."is_active" = true
    AND pd."ai_knowledge_url" IS NOT NULL
)
UPDATE "project_dimensions" pd
SET
  "ai_knowledge_sources" = jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'url', project_cache."ai_knowledge_url",
      'kind', 'notion',
      'label', NULL,
      'enabled', true,
      'last_synced_at', CASE
        WHEN project_cache."ai_knowledge_synced_at" IS NULL THEN NULL
        ELSE to_char(
          project_cache."ai_knowledge_synced_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      END,
      'last_sync_status', 'healthy',
      'last_sync_error', NULL,
      'source_id', project_cache."source_id",
      'source_content_hash', project_cache."source_content_hash",
      'created_at', to_char(
        NOW() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'updated_at', to_char(
        NOW() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    )
  ),
  "updated_at" = NOW()
FROM project_cache
WHERE pd."project_id" = project_cache."project_id";
