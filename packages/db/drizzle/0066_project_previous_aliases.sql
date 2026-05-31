-- previous_aliases preserves the historical project_alias values a project
-- has used over its lifetime, so the email timeline bubble-side renderer
-- (per D-049) can keep messages from prior aliases on the right side even
-- after an admin renames the alias.
--
-- Populated by setProjectAlias: when the current alias is non-empty and is
-- being replaced with a different non-null value, the prior alias is
-- appended (lowercased + trimmed; duplicates skipped).
--
-- Default '{}' for existing rows. Re-running the bubble-side migration set
-- after this migration applies leaves historical messages on whatever side
-- they currently render — only future alias renames preserve their prior
-- value automatically.

ALTER TABLE "project_dimensions"
  ADD COLUMN "previous_aliases" text[] NOT NULL DEFAULT '{}';
