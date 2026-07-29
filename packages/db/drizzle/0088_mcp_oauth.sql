-- Brick 2 of PRD #677. Adds OAuth authorization-server storage for the MCP
-- connector. Only hashed client secrets, authorization codes, and tokens are
-- persisted.

CREATE TABLE "mcp_oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_hash" text NOT NULL,
  "name" text NOT NULL,
  "allowed_redirect_uris" jsonb NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_unique"
  ON "mcp_oauth_clients" ("client_id");

CREATE INDEX "mcp_oauth_clients_revoked_at_idx"
  ON "mcp_oauth_clients" ("revoked_at");

CREATE TABLE "mcp_oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_code_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "scope" text NOT NULL,
  "resource" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_oauth_authorization_codes_client_id_mcp_oauth_clients_client_id_fk"
    FOREIGN KEY ("client_id")
    REFERENCES "public"."mcp_oauth_clients"("client_id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "mcp_oauth_authorization_codes_user_id_users_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade
    ON UPDATE no action
);

CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_hash_unique"
  ON "mcp_oauth_authorization_codes" ("authorization_code_hash");

CREATE INDEX "mcp_oauth_authorization_codes_client_id_idx"
  ON "mcp_oauth_authorization_codes" ("client_id");

CREATE INDEX "mcp_oauth_authorization_codes_user_id_idx"
  ON "mcp_oauth_authorization_codes" ("user_id");

CREATE INDEX "mcp_oauth_authorization_codes_expires_at_idx"
  ON "mcp_oauth_authorization_codes" ("expires_at");

CREATE TABLE "mcp_oauth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "access_token_hash" text NOT NULL,
  "refresh_token_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "scope" text NOT NULL,
  "resource" text NOT NULL,
  "token_family_id" uuid NOT NULL,
  "authorization_code_hash" text,
  "rotated_from_token_id" uuid,
  "access_expires_at" timestamp with time zone NOT NULL,
  "refresh_expires_at" timestamp with time zone NOT NULL,
  "rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_oauth_tokens_client_id_mcp_oauth_clients_client_id_fk"
    FOREIGN KEY ("client_id")
    REFERENCES "public"."mcp_oauth_clients"("client_id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "mcp_oauth_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade
    ON UPDATE no action
);

CREATE UNIQUE INDEX "mcp_oauth_tokens_access_hash_unique"
  ON "mcp_oauth_tokens" ("access_token_hash");

CREATE UNIQUE INDEX "mcp_oauth_tokens_refresh_hash_unique"
  ON "mcp_oauth_tokens" ("refresh_token_hash");

CREATE INDEX "mcp_oauth_tokens_client_id_idx"
  ON "mcp_oauth_tokens" ("client_id");

CREATE INDEX "mcp_oauth_tokens_user_id_idx"
  ON "mcp_oauth_tokens" ("user_id");

CREATE INDEX "mcp_oauth_tokens_family_id_idx"
  ON "mcp_oauth_tokens" ("token_family_id");

CREATE INDEX "mcp_oauth_tokens_access_expires_at_idx"
  ON "mcp_oauth_tokens" ("access_expires_at");

CREATE INDEX "mcp_oauth_tokens_refresh_expires_at_idx"
  ON "mcp_oauth_tokens" ("refresh_expires_at");
