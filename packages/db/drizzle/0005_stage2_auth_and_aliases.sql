CREATE TYPE "user_role" AS ENUM ('admin', 'operator');

CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "email_verified" timestamp with time zone,
  "image" text,
  "role" "user_role" DEFAULT 'operator' NOT NULL,
  "deactivated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");

CREATE TABLE "accounts" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY ("provider", "provider_account_id")
);

CREATE INDEX "accounts_user_id_idx" ON "accounts" ("user_id");

CREATE TABLE "sessions" (
  "session_token" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "expires" timestamp with time zone NOT NULL
);

CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");

CREATE TABLE "verification_tokens" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp with time zone NOT NULL,
  CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY ("identifier", "token")
);

CREATE TABLE "project_aliases" (
  "id" text PRIMARY KEY NOT NULL,
  "alias" text NOT NULL,
  "project_id" text REFERENCES "project_dimensions"("project_id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "updated_by" text REFERENCES "users"("id") ON DELETE set null
);

CREATE UNIQUE INDEX "project_aliases_alias_unique" ON "project_aliases" ("alias");
CREATE INDEX "project_aliases_project_idx" ON "project_aliases" ("project_id");
