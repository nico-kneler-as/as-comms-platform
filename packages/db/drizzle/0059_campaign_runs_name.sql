-- Brief A5: campaigns need an operator-facing internal name distinct from
-- the email subject line. Persists on campaign_runs so the campaigns list,
-- run detail, and "Duplicate this campaign" action all show the same label
-- the operator chose at draft time.

ALTER TABLE "campaign_runs"
  ADD COLUMN "name" text;
