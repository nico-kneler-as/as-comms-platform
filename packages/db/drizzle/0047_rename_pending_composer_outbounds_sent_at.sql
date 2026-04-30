-- Rename pending_composer_outbounds.sent_at → attempted_at.
--
-- Background: the column was set at INSERT time, not on Gmail provider success.
-- "sent_at" was misleading — it represents the timestamp of the send attempt,
-- not confirmation that the message hit Gmail's wire. The application infers
-- "actually sent" from sent_rfc822_message_id IS NOT NULL.

ALTER TABLE "pending_composer_outbounds"
  RENAME COLUMN "sent_at" TO "attempted_at";
