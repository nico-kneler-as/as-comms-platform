CREATE INDEX IF NOT EXISTS gmail_message_details_rfc822_idx
  ON gmail_message_details (rfc822_message_id)
  WHERE rfc822_message_id IS NOT NULL;
