ALTER TABLE "salesforce_contact_states"
  ALTER COLUMN "raw_state" DROP NOT NULL;

ALTER TABLE "salesforce_contact_states"
  ADD COLUMN "has_opted_out_of_email" boolean NOT NULL DEFAULT false;

CREATE INDEX "salesforce_contact_states_opted_out_email_idx"
  ON "salesforce_contact_states" ("normalized_email")
  WHERE "has_opted_out_of_email";
