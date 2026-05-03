CREATE TABLE "sms_senders" (
  "id" text PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL,
  "display_name" text NOT NULL,
  "monthly_cap" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sms_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "twilio_message_sid" text,
  "direction" text NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "phone_e164" text NOT NULL,
  "sender_id" text NOT NULL REFERENCES "sms_senders"("id") ON DELETE restrict,
  "body" text NOT NULL,
  "segments" integer DEFAULT 1 NOT NULL,
  "encoding" text NOT NULL,
  "media_urls" text[],
  "send_status" text NOT NULL,
  "failed_reason" text,
  "failed_detail" text,
  "sent_at" timestamp with time zone,
  "received_at" timestamp with time zone,
  "actor_id" text REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_messages_direction_check" CHECK ("direction" IN ('inbound', 'outbound')),
  CONSTRAINT "sms_messages_encoding_check" CHECK ("encoding" IN ('GSM-7', 'Unicode'))
);

CREATE TABLE "consent_records" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text REFERENCES "contacts"("id") ON DELETE cascade,
  "phone_e164" text NOT NULL,
  "status" text NOT NULL,
  "source" text NOT NULL,
  "source_detail" text,
  "consented_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "recorded_by_user_id" text REFERENCES "users"("id"),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "consent_records_status_check" CHECK ("status" IN ('opted_in', 'revoked')),
  CONSTRAINT "consent_records_source_check" CHECK (
    "source" IN (
      'volunteer_application_form',
      'sms_reply_yes',
      'operator_attestation',
      'salesforce_field',
      'inbound_thread'
    )
  )
);

CREATE UNIQUE INDEX "sms_senders_phone_e164_unique"
  ON "sms_senders" ("phone_e164");
CREATE INDEX "sms_messages_contact_created_idx"
  ON "sms_messages" ("contact_id", "created_at" DESC);
CREATE UNIQUE INDEX "sms_messages_twilio_sid_unique"
  ON "sms_messages" ("twilio_message_sid")
  WHERE "twilio_message_sid" IS NOT NULL;
CREATE INDEX "sms_messages_phone_e164_idx"
  ON "sms_messages" ("phone_e164");
CREATE INDEX "consent_records_phone_created_idx"
  ON "consent_records" ("phone_e164", "created_at" DESC);
CREATE INDEX "consent_records_contact_created_idx"
  ON "consent_records" ("contact_id", "created_at" DESC);
