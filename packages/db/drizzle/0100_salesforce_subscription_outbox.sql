CREATE TABLE "salesforce_subscription_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"contact_id" text,
	"event_kind" text NOT NULL,
	"project_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_kind" text,
	"last_error_code" text,
	"sent_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salesforce_subscription_outbox_event_kind_check" CHECK ("event_kind" IN ('newsletter_opt_out', 'project_opt_out', 'all_opt_out', 'newsletter_signup', 'hard_bounce')),
	CONSTRAINT "salesforce_subscription_outbox_project_shape_check" CHECK (("event_kind" = 'project_opt_out' AND "project_id" IS NOT NULL) OR ("event_kind" <> 'project_opt_out' AND "project_id" IS NULL)),
	CONSTRAINT "salesforce_subscription_outbox_status_check" CHECK ("status" IN ('pending', 'sent', 'parked')),
	CONSTRAINT "salesforce_subscription_outbox_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_outbox_pending_idx" ON "salesforce_subscription_outbox" USING btree ("next_attempt_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "salesforce_subscription_outbox_email_idx" ON "salesforce_subscription_outbox" USING btree ("email");
