CREATE TABLE "salesforce_audience_lists" (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL,
  "salesforce_id" text,
  "name" text NOT NULL,
  "campaign_type" text,
  "campaign_status" text,
  "is_active" boolean NOT NULL,
  "owner_name" text,
  "member_count" integer NOT NULL DEFAULT 0,
  "salesforce_last_modified_at" timestamp with time zone,
  "synced_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "salesforce_audience_lists_kind_check"
    CHECK ("kind" IN ('campaign', 'insiders'))
);

CREATE UNIQUE INDEX "salesforce_audience_lists_salesforce_id_unique"
  ON "salesforce_audience_lists" ("salesforce_id")
  WHERE "salesforce_id" IS NOT NULL;

CREATE TABLE "salesforce_audience_list_members" (
  "list_id" text NOT NULL REFERENCES "salesforce_audience_lists"("id") ON DELETE CASCADE,
  "normalized_email" text NOT NULL,
  "salesforce_contact_id" text,
  "salesforce_lead_id" text,
  "member_status" text,
  CONSTRAINT "salesforce_audience_list_members_list_email_unique"
    UNIQUE ("list_id", "normalized_email")
);

CREATE INDEX "salesforce_audience_list_members_normalized_email_idx"
  ON "salesforce_audience_list_members" ("normalized_email");
