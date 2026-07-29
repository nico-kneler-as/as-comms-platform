import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRecord } from "@as-comms/domain";

import { POST } from "../../app/token/route";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

const CLIENT_ID = "client_test";
const CLIENT_SECRET = "top-secret";
const USER_ID = "user-1";
const RESOURCE = "https://as.example.com/api/mcp";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pkceS256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function buildUserRecord(
  overrides: Partial<UserRecord> = {},
): UserRecord {
  const now = new Date("2026-07-29T12:00:00.000Z");

  return {
    id: USER_ID,
    name: "Operator One",
    email: "operator@adventurescientists.org",
    emailVerified: null,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function formRequest(body: URLSearchParams): Request {
  return new Request("http://localhost/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

describe("token route", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    await runtime.context.settings.users.upsert(buildUserRecord());
    await runtime.runtime.oauth.createClient({
      clientId: CLIENT_ID,
      clientSecretHash: sha256Hex(CLIENT_SECRET),
      name: "Claude Connector",
      allowedRedirectUris: [REDIRECT_URI, "http://localhost/callback"],
    });
    vi.stubEnv("MCP_PUBLIC_URL", RESOURCE);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (runtime !== null) {
      await runtime.dispose();
      runtime = null;
    }
  });

  it("accepts form-urlencoded authorization_code exchanges", async () => {
    if (runtime === null) {
      throw new Error("Missing test runtime.");
    }

    const codeVerifier = "verifier-1234567890123456789012345678901234567890123";
    const code = "authorization-code";
    await runtime.runtime.oauth.createAuthorizationCode({
      authorizationCodeHash: sha256Hex(code),
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: pkceS256(codeVerifier),
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      expiresAt: "2026-07-29T12:02:00.000Z",
    });

    const response = await POST(
      formRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
          redirect_uri: REDIRECT_URI,
          resource: RESOURCE,
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:read offline_access",
    });
  });

  it("rejects JSON requests with a proper RFC 6749 error instead of throwing", async () => {
    const response = await POST(
      new Request("http://localhost/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      error_description:
        "The token endpoint requires application/x-www-form-urlencoded.",
    });
  });
});
