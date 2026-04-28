CREATE TABLE message_attachments (
  id text PRIMARY KEY,
  source_evidence_id text NOT NULL
    REFERENCES source_evidence_log(id) ON DELETE CASCADE,
  provider text NOT NULL,
  gmail_attachment_id text NOT NULL,
  mime_type text NOT NULL,
  filename text,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_attachments_source_idx
  ON message_attachments(source_evidence_id);
