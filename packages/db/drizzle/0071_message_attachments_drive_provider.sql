ALTER TABLE message_attachments
  ALTER COLUMN gmail_attachment_id DROP NOT NULL,
  ALTER COLUMN storage_key DROP NOT NULL,
  ADD COLUMN external_url TEXT;
