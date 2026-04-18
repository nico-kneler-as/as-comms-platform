CREATE INDEX "contact_inbox_projection_recency_idx"
ON "contact_inbox_projection" (
  coalesce("last_inbound_at", "last_activity_at") DESC,
  "last_activity_at" DESC,
  "contact_id" ASC
);
