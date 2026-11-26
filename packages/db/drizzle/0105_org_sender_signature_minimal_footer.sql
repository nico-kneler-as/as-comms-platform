-- Per cross-org sender: a signature appended to plain (Normal) emails, and a
-- minimal footer (a single "Unsubscribe" link: no postal address, no
-- "view in browser" line). Nico, 2026-11-16: Gregg's sender looks like a
-- personal letter; every other sender keeps the standard footer.
ALTER TABLE "org_senders" ADD COLUMN "signature" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "org_senders" ADD COLUMN "minimal_footer" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "org_senders"
SET "minimal_footer" = true, "updated_at" = now()
WHERE "email" = 'gtreinish@adventurescientists.org';
