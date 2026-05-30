ALTER TABLE "gmail_message_details"
  ADD COLUMN "from_emails" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "to_emails" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "cc_emails" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "bcc_emails" text[] NOT NULL DEFAULT '{}';
