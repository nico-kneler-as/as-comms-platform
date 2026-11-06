CREATE TABLE "salesforce_contact_states" (
  "normalized_email" text PRIMARY KEY,
  "state_code" text,
  "raw_state" text NOT NULL,
  "salesforce_contact_id" text NOT NULL,
  "salesforce_last_modified_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone NOT NULL
);

CREATE INDEX "salesforce_contact_states_state_code_idx"
  ON "salesforce_contact_states" ("state_code");
