-- Originally drafted as a UNIQUE INDEX (filename retained to match the
-- applied_migrations row id seeded during the 2026-05-03 incident
-- remediation). At apply time we discovered shared org/family phones in
-- the live data (1 known case as of 2026-05-03 — California Botanic
-- Garden main line shared by two contacts), so we landed a non-UNIQUE
-- partial index instead.
--
-- Tracking issue: phone↔contact must move to a many-to-many relation via
-- contact_identities before SMS routing goes live, at which point the
-- uniqueness invariant can be re-established at the right grain.
-- See https://github.com/nico-kneler-as/as-comms-platform/issues/285
CREATE INDEX IF NOT EXISTS contacts_primary_phone_index
  ON contacts (primary_phone) WHERE primary_phone IS NOT NULL;
