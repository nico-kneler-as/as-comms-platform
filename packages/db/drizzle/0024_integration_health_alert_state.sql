ALTER TABLE "integration_health"
  ADD COLUMN "degraded_since_at" timestamp with time zone,
  ADD COLUMN "last_alert_sent_at" timestamp with time zone;
