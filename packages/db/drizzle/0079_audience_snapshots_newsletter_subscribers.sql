ALTER TABLE "audience_snapshots"
  ALTER COLUMN "contact_id" DROP NOT NULL;

ALTER TABLE "audience_snapshots"
  ADD COLUMN "newsletter_subscriber_id" uuid;

ALTER TABLE "audience_snapshots"
  ADD CONSTRAINT "audience_snapshots_newsletter_subscriber_id_newsletter_subscribers_id_fk"
  FOREIGN KEY ("newsletter_subscriber_id")
  REFERENCES "public"."newsletter_subscribers"("id")
  ON DELETE restrict
  ON UPDATE no action;

DROP INDEX "audience_snapshots_run_contact_unique";

CREATE INDEX "audience_snapshots_newsletter_subscriber_id_idx"
  ON "audience_snapshots" ("newsletter_subscriber_id");

CREATE UNIQUE INDEX "audience_snapshots_run_contact_unique"
  ON "audience_snapshots" ("campaign_run_id", "contact_id")
  WHERE "contact_id" IS NOT NULL;

CREATE UNIQUE INDEX "audience_snapshots_run_newsletter_subscriber_unique"
  ON "audience_snapshots" ("campaign_run_id", "newsletter_subscriber_id")
  WHERE "newsletter_subscriber_id" IS NOT NULL;

ALTER TABLE "audience_snapshots"
  ADD CONSTRAINT "audience_snapshots_recipient_check"
  CHECK (num_nonnulls("contact_id", "newsletter_subscriber_id") = 1);
