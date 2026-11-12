CREATE TABLE "audience_lists" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "members_replaced_at" timestamp with time zone,
  "members_replaced_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_list_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_id" text NOT NULL REFERENCES "audience_lists"("id") ON DELETE CASCADE,
  "normalized_email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audience_list_members_list_email_unique" UNIQUE ("list_id", "normalized_email")
);
--> statement-breakpoint
CREATE INDEX "audience_list_members_normalized_email_idx" ON "audience_list_members" USING btree ("normalized_email");
--> statement-breakpoint
CREATE TABLE "email_opt_outs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_email" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text,
  "source" text NOT NULL,
  "source_run_id" text REFERENCES "campaign_runs"("id") ON DELETE SET NULL,
  "opted_out_at" timestamp with time zone NOT NULL,
  "cleared_at" timestamp with time zone,
  "cleared_by_source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_opt_outs_scope_type_check" CHECK ("scope_type" IN ('all', 'list')),
  CONSTRAINT "email_opt_outs_scope_shape_check" CHECK (("scope_type" = 'list') = ("scope_id" IS NOT NULL)),
  CONSTRAINT "email_opt_outs_cleared_shape_check" CHECK (("cleared_at" IS NULL) = ("cleared_by_source" IS NULL))
);
--> statement-breakpoint
-- One active opt-out per email and scope; cleared rows stay for the audit trail.
CREATE UNIQUE INDEX "email_opt_outs_active_all_unique" ON "email_opt_outs" USING btree ("normalized_email") WHERE "scope_type" = 'all' AND "cleared_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "email_opt_outs_active_list_unique" ON "email_opt_outs" USING btree ("normalized_email", "scope_id") WHERE "scope_type" = 'list' AND "cleared_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "campaign_runs" ADD COLUMN "audience_list_id" text REFERENCES "audience_lists"("id") ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO "audience_lists" ("id", "name") VALUES ('insiders', 'Insiders') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "email_opt_outs" ("normalized_email", "scope_type", "scope_id", "source", "opted_out_at")
SELECT lower(btrim("email")), 'all', NULL, 'backfill_salesforce_outbox', min("occurred_at")
FROM "salesforce_subscription_outbox"
WHERE "event_kind" = 'all_opt_out' AND btrim("email") <> ''
GROUP BY lower(btrim("email"))
ON CONFLICT DO NOTHING;
