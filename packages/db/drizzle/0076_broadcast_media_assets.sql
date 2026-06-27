-- Brick A of PRD #567. Adds durable hosted broadcast media asset metadata.
-- Upload and object-store integration ship in later bricks.

CREATE TABLE "broadcast_media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "uploader_id" text,
  "storage_key" text NOT NULL,
  "public_url" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "broadcast_media_assets_uploader_id_users_id_fk"
    FOREIGN KEY ("uploader_id")
    REFERENCES "public"."users"("id")
    ON DELETE set null
    ON UPDATE no action
);

CREATE INDEX "broadcast_media_assets_created_at_idx"
  ON "broadcast_media_assets" ("created_at" DESC);
