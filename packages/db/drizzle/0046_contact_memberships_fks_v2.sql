-- Re-add the contact_memberships FKs introduced in 0039 and dropped in 0044.
-- Salesforce capture now seeds project_dimensions / expedition_dimensions
-- before contact_memberships, and the mapper always emits dimension rows when
-- membership IDs are present, so the referential integrity checks are safe
-- to restore.

ALTER TABLE "contact_memberships"
  ADD CONSTRAINT "contact_memberships_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project_dimensions" ("project_id")
  ON DELETE RESTRICT;

ALTER TABLE "contact_memberships"
  ADD CONSTRAINT "contact_memberships_expedition_id_fkey"
  FOREIGN KEY ("expedition_id") REFERENCES "expedition_dimensions" ("expedition_id")
  ON DELETE RESTRICT;
