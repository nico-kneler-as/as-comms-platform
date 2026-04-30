ALTER TABLE contact_inbox_projection
  ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX contact_inbox_projection_archived_idx
  ON contact_inbox_projection (archived_at)
  WHERE archived_at IS NOT NULL;
