ALTER TABLE "canonical_event_ledger"
ADD COLUMN "content_fingerprint" text;

CREATE INDEX "canonical_event_ledger_contact_channel_fingerprint_idx"
ON "canonical_event_ledger" ("contact_id", "channel", "content_fingerprint");
