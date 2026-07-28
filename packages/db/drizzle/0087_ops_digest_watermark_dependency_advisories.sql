ALTER TABLE "ops_digest_watermark"
  ADD COLUMN "reported_dependency_advisory_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
