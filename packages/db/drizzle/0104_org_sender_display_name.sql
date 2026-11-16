-- How a cross-org sender appears in the From header ("Gregg Treinish",
-- "Adventure Scientists"). Asked for by Nico on 2026-11-16.
ALTER TABLE "org_senders" ADD COLUMN "display_name" text NOT NULL DEFAULT 'Adventure Scientists';
--> statement-breakpoint
-- Gregg's replies must reach the inbox he reads: his sender moves from gregg@
-- to gtreinish@ (also the reply-to, which defaults to the sender), shown as
-- "Gregg Treinish". info@ and donate@ keep "Adventure Scientists".
UPDATE "org_senders"
SET "email" = 'gtreinish@adventurescientists.org',
    "display_name" = 'Gregg Treinish',
    "updated_at" = now()
WHERE "email" = 'gregg@adventurescientists.org'
  AND NOT EXISTS (
    SELECT 1 FROM "org_senders" WHERE "email" = 'gtreinish@adventurescientists.org'
  );
--> statement-breakpoint
-- Open drafts follow the sender; completed sends keep their history.
UPDATE "campaign_runs"
SET "from_email" = 'gtreinish@adventurescientists.org',
    "reply_to_email" = CASE
      WHEN "reply_to_email" IS NULL OR "reply_to_email" = 'gregg@adventurescientists.org'
        THEN 'gtreinish@adventurescientists.org'
      ELSE "reply_to_email"
    END,
    "from_name" = NULL,
    "updated_at" = now()
WHERE "state" = 'draft'
  AND "from_email" = 'gregg@adventurescientists.org';
