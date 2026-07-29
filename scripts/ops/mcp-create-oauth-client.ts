#!/usr/bin/env tsx
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  createDatabaseConnection,
  createMcpOAuthRepositoryFromConnection,
} from "@as-comms/db";

const DEFAULT_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "http://localhost/callback",
  "http://127.0.0.1/callback",
] as const;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createClientId(): string {
  return `mcp_${randomBytes(16).toString("hex")}`;
}

function createClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function runMcpCreateOAuthClientCommand(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
    },
  });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const clientId = createClientId();
  const clientSecret = createClientSecret();
  const connection = createDatabaseConnection({ connectionString });

  try {
    const oauth = createMcpOAuthRepositoryFromConnection(connection);
    await oauth.createClient({
      clientId,
      clientSecretHash: sha256Hex(clientSecret),
      name:
        typeof values.name === "string" && values.name.trim().length > 0
          ? values.name.trim()
          : "Claude MCP connector",
      allowedRedirectUris: [...DEFAULT_REDIRECT_URIS],
    });

    console.log(`client_id=${clientId}`);
    console.log(`client_secret=${clientSecret}`);
    console.log(
      `allowed_redirect_uris=${DEFAULT_REDIRECT_URIS.join(",")}`,
    );
  } finally {
    const sql = (connection as { sql?: { end?: () => Promise<void> } }).sql;
    if (sql && typeof sql.end === "function") {
      await sql.end();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runMcpCreateOAuthClientCommand();
}
