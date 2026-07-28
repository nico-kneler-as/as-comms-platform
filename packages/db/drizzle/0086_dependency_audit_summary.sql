CREATE TABLE "dependency_audit_summary" (
  "id" text PRIMARY KEY NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "exit_status" integer NOT NULL,
  "advisories_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
