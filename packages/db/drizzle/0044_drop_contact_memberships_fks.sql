-- Migration 0039 added FKs from contact_memberships to project_dimensions and
-- expedition_dimensions. In prod (2026-04-29) those FKs blocked Salesforce
-- live capture: the capture writes contact_memberships rows pointing at
-- expedition IDs that haven't yet been ingested into expedition_dimensions.
-- The FKs were dropped manually in prod to unblock capture. This migration
-- mirrors that drop in the migration history so a fresh DB ends in the same
-- state as production.
--
-- The CHECK constraint on salesforce_membership_id (also from 0039) stays
-- in place — that one isn't an issue.
--
-- The FKs can come back in a future migration once the capture pipeline is
-- updated to seed expedition_dimensions before contact_memberships.

ALTER TABLE "contact_memberships"
  DROP CONSTRAINT IF EXISTS "contact_memberships_project_id_fkey";

ALTER TABLE "contact_memberships"
  DROP CONSTRAINT IF EXISTS "contact_memberships_expedition_id_fkey";
