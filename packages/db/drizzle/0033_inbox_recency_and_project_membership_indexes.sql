CREATE INDEX IF NOT EXISTS contact_inbox_projection_recency_inbound_idx
  ON contact_inbox_projection (last_inbound_at DESC NULLS LAST, last_activity_at DESC, contact_id ASC);

CREATE INDEX IF NOT EXISTS contact_inbox_projection_recency_outbound_idx
  ON contact_inbox_projection (last_outbound_at DESC NULLS LAST, last_activity_at DESC, contact_id ASC);

CREATE INDEX IF NOT EXISTS contact_memberships_project_contact_idx
  ON contact_memberships (project_id, contact_id);
