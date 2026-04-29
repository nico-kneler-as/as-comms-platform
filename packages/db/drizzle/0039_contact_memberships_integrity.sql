ALTER TABLE "contact_memberships"
  ADD CONSTRAINT "contact_memberships_sf_id_check"
  CHECK ("source" <> 'salesforce' OR "salesforce_membership_id" IS NOT NULL);

ALTER TABLE "contact_memberships"
  ADD CONSTRAINT "contact_memberships_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project_dimensions" ("project_id")
  ON DELETE RESTRICT;

ALTER TABLE "contact_memberships"
  ADD CONSTRAINT "contact_memberships_expedition_id_fkey"
  FOREIGN KEY ("expedition_id") REFERENCES "expedition_dimensions" ("expedition_id")
  ON DELETE RESTRICT;
