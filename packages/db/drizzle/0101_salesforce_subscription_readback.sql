CREATE TABLE "salesforce_subscription_preferences" (
  "salesforce_record_id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL, "salesforce_contact_id" text,
  "general_newsletter" boolean NOT NULL, "oregon_shores_newsletter" boolean NOT NULL,
  "pnw_forest_monitoring" boolean NOT NULL, "beech_and_butternut" boolean NOT NULL,
  "tracking_whitebark_pine" boolean NOT NULL, "coral_reef_expansion" boolean NOT NULL,
  "monitoring_killer_whales_project" boolean NOT NULL, "unsubscribed_from_all" boolean NOT NULL,
  "unsubscribed_at" timestamp with time zone, "email_bounced" boolean NOT NULL,
  "record_creation_source" text, "is_deleted" boolean NOT NULL DEFAULT false,
  "sf_last_modified_at" timestamp with time zone NOT NULL, "sf_last_modified_by_id" text,
  "captured_at" timestamp with time zone NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_preferences_email_idx" ON "salesforce_subscription_preferences" ("email");
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_preferences_contact_idx" ON "salesforce_subscription_preferences" ("salesforce_contact_id");
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_preferences_modified_idx" ON "salesforce_subscription_preferences" ("sf_last_modified_at");
--> statement-breakpoint
CREATE TABLE "salesforce_subscription_readback_events" (
  "id" uuid PRIMARY KEY NOT NULL, "salesforce_record_id" text NOT NULL, "email" text NOT NULL,
  "field" text NOT NULL, "project_box" text, "from_value" boolean, "to_value" boolean NOT NULL,
  "sf_modified_at" timestamp with time zone NOT NULL, "sf_modified_by_username" text,
  "mode" text NOT NULL, "outcome" text NOT NULL, "contacts_matched" integer NOT NULL,
  "rows_changed" integer NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "salesforce_subscription_readback_events_field_check" CHECK ("field" IN ('general_newsletter','project_box','unsubscribed_from_all')),
  CONSTRAINT "salesforce_subscription_readback_events_box_shape_check" CHECK (("field" = 'project_box' AND "project_box" IS NOT NULL) OR ("field" <> 'project_box' AND "project_box" IS NULL)),
  CONSTRAINT "salesforce_subscription_readback_events_mode_check" CHECK ("mode" IN ('dry_run','apply')),
  CONSTRAINT "salesforce_subscription_readback_events_outcome_check" CHECK ("outcome" IN ('applied','would_apply','no_change','skipped_integration_user','skipped_form_false','skipped_platform_newer','skipped_suppressed','skipped_cleaned_address','skipped_no_projects_for_box','skipped_no_contact'))
);
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_readback_events_created_idx" ON "salesforce_subscription_readback_events" ("created_at");
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_readback_events_email_idx" ON "salesforce_subscription_readback_events" ("email");
--> statement-breakpoint
CREATE TABLE "contact_consent_clears" (
  "id" text PRIMARY KEY NOT NULL, "consent_id" text NOT NULL, "contact_id" text NOT NULL,
  "scope_type" text NOT NULL, "scope_id" text, "source" text NOT NULL, "source_run_id" text,
  "opted_out_at" timestamp with time zone NOT NULL, "cleared_at" timestamp with time zone NOT NULL,
  "cleared_by_source" text NOT NULL, "salesforce_record_id" text, "readback_event_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contact_consent_clears_source_check" CHECK ("cleared_by_source" = 'salesforce')
);
--> statement-breakpoint
CREATE INDEX "contact_consent_clears_contact_idx" ON "contact_consent_clears" ("contact_id");
--> statement-breakpoint
ALTER TABLE "contact_consent" DROP CONSTRAINT "contact_consent_source_check";
--> statement-breakpoint
ALTER TABLE "contact_consent" ADD CONSTRAINT "contact_consent_source_check" CHECK ("source" IN ('recipient_click', 'admin_action', 'provider_event', 'import', 'salesforce'));
