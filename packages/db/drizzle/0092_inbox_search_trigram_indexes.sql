CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS contacts_display_name_trgm_idx
  ON contacts USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_primary_email_trgm_idx
  ON contacts USING gin (primary_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_primary_phone_trgm_idx
  ON contacts USING gin (primary_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contact_inbox_projection_snippet_trgm_idx
  ON contact_inbox_projection USING gin (snippet gin_trgm_ops);

CREATE INDEX IF NOT EXISTS gmail_message_details_subject_trgm_idx
  ON gmail_message_details USING gin (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gmail_message_details_from_header_trgm_idx
  ON gmail_message_details USING gin (from_header gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gmail_message_details_to_header_trgm_idx
  ON gmail_message_details USING gin (to_header gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gmail_message_details_cc_header_trgm_idx
  ON gmail_message_details USING gin (cc_header gin_trgm_ops);

CREATE INDEX IF NOT EXISTS salesforce_communication_details_subject_trgm_idx
  ON salesforce_communication_details USING gin (subject gin_trgm_ops);
