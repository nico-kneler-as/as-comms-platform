CREATE TABLE "broadcast_web_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_run_id" text NOT NULL UNIQUE REFERENCES "campaign_runs"("id") ON DELETE CASCADE,
  "public_token" text NOT NULL UNIQUE,
  "title" text,
  "rendered_html" text,
  "rendered_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "unpublished_at" timestamp with time zone,
  "publish_changed_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
