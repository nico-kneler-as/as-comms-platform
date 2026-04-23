ALTER TABLE "gmail_message_details"
ADD COLUMN "from_header" text,
ADD COLUMN "to_header" text,
ADD COLUMN "cc_header" text;
