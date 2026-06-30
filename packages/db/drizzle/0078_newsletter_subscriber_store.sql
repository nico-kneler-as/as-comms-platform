-- Brick 1 of PRD #584. Adds the dependency-free newsletter audience store
-- imported from Mailchimp and kept separate from contact/volunteer identity.

CREATE TABLE "newsletter_subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "status" text DEFAULT 'subscribed' NOT NULL,
  "member_rating" integer,
  "optin_time" timestamp with time zone,
  "optin_ip" text,
  "confirm_time" timestamp with time zone,
  "confirm_ip" text,
  "last_changed_at" timestamp with time zone,
  "interests" text,
  "tags" text,
  "source" text DEFAULT 'mailchimp_import' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "newsletter_subscribers_email_unique"
  ON "newsletter_subscribers" ("email");

CREATE INDEX "newsletter_subscribers_member_rating_idx"
  ON "newsletter_subscribers" ("member_rating");

CREATE INDEX "newsletter_subscribers_last_changed_at_idx"
  ON "newsletter_subscribers" ("last_changed_at");

CREATE TABLE "newsletter_suppressions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "reason" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "newsletter_suppressions_reason_check"
    CHECK ("newsletter_suppressions"."reason" IN ('unsubscribed', 'cleaned', 'platform_optout'))
);

CREATE UNIQUE INDEX "newsletter_suppressions_email_unique"
  ON "newsletter_suppressions" ("email");
