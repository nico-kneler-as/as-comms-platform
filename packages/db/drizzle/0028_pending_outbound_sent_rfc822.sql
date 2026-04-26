ALTER TABLE pending_composer_outbounds
  ADD COLUMN sent_rfc822_message_id TEXT,
  ADD COLUMN failed_detail TEXT;

CREATE INDEX pending_composer_outbounds_sent_rfc822_idx
  ON pending_composer_outbounds (sent_rfc822_message_id)
  WHERE sent_rfc822_message_id IS NOT NULL;
