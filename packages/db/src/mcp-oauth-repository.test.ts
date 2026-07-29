import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { UserRecord } from "@as-comms/domain";

import {
  createMcpOAuthRepository,
  users,
} from "./index.js";
import { createTestStage1Context } from "./test-helpers.js";

const CLIENT_ID = "client_test";
const CLIENT_SECRET = "top-secret";
const USER_ID = "user-1";
const RESOURCE = "https://as.example.com/api/mcp";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

describe("mcp oauth repository", () => {
  const contexts: Awaited<ReturnType<typeof createTestStage1Context>>[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("enforces authorization code single-use under concurrent redemption", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await context.settings.users.upsert(buildUserRecord());
    const repository = createMcpOAuthRepository(context.db);
    await repository.createClient({
      clientId: CLIENT_ID,
      clientSecretHash: sha256Hex(CLIENT_SECRET),
      name: "Claude Connector",
      allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    await repository.createAuthorizationCode({
      authorizationCodeHash: sha256Hex("authorization-code"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      expiresAt: "2026-07-29T12:02:00.000Z",
    });

    const consumedAt = new Date("2026-07-29T12:00:30.000Z");
    const [first, second] = await Promise.all([
      repository.consumeAuthorizationCode(
        sha256Hex("authorization-code"),
        consumedAt,
      ),
      repository.consumeAuthorizationCode(
        sha256Hex("authorization-code"),
        consumedAt,
      ),
    ]);

    expect([first, second].filter((value) => value !== null)).toHaveLength(1);
  });

  it("persists refresh rotation by marking the old token rotated and inserting the new token", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await context.settings.users.upsert(buildUserRecord());
    const repository = createMcpOAuthRepository(context.db);
    // Seed the FK parent. `mcp_oauth_tokens.client_id` references
    // `mcp_oauth_clients.client_id`, and PGlite enforces it — without this the
    // insert fails with 23503 rather than exercising rotation.
    await repository.createClient({
      clientId: CLIENT_ID,
      clientSecretHash: sha256Hex(CLIENT_SECRET),
      name: "Claude Connector",
      allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    const original = await repository.createTokenFamily({
      accessTokenHash: sha256Hex("access-token-1"),
      refreshTokenHash: sha256Hex("refresh-token-1"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      tokenFamilyId: "11111111-1111-4111-8111-111111111111",
      authorizationCodeHash: sha256Hex("authorization-code"),
      accessExpiresAt: "2026-07-29T13:00:00.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z",
    });

    const rotated = await repository.rotateRefreshToken({
      accessTokenHash: sha256Hex("access-token-2"),
      refreshTokenHash: sha256Hex("refresh-token-2"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: original.scope,
      resource: original.resource,
      tokenFamilyId: original.tokenFamilyId,
      authorizationCodeHash: original.authorizationCodeHash,
      accessExpiresAt: "2026-07-29T14:00:00.000Z",
      refreshExpiresAt: "2026-08-29T12:00:00.000Z",
      rotatedFromRefreshTokenHash: original.refreshTokenHash,
      rotatedAt: new Date("2026-07-29T12:15:00.000Z"),
    });

    expect(rotated).not.toBeNull();
    expect(rotated?.refreshTokenHash).toBe(sha256Hex("refresh-token-2"));
    expect(rotated?.rotatedFromTokenId).toBe(original.id);

    const storedOriginal = await repository.findTokenByRefreshTokenHash(
      original.refreshTokenHash,
    );
    expect(storedOriginal?.rotatedAt).toBe("2026-07-29T12:15:00.000Z");
  });

  it("cascades authorization codes and tokens when the user row is deleted", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await context.settings.users.upsert(buildUserRecord());
    const repository = createMcpOAuthRepository(context.db);
    await repository.createClient({
      clientId: CLIENT_ID,
      clientSecretHash: sha256Hex(CLIENT_SECRET),
      name: "Claude Connector",
      allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    await repository.createAuthorizationCode({
      authorizationCodeHash: sha256Hex("authorization-code"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      expiresAt: "2026-07-29T12:02:00.000Z",
    });
    await repository.createTokenFamily({
      accessTokenHash: sha256Hex("access-token-1"),
      refreshTokenHash: sha256Hex("refresh-token-1"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      tokenFamilyId: "22222222-2222-4222-8222-222222222222",
      authorizationCodeHash: sha256Hex("authorization-code"),
      accessExpiresAt: "2026-07-29T13:00:00.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z",
    });

    await context.db.delete(users).where(eq(users.id, USER_ID));

    await expect(
      repository.findAuthorizationCodeByHash(sha256Hex("authorization-code")),
    ).resolves.toBeNull();
    await expect(
      repository.findTokenByAccessTokenHash(sha256Hex("access-token-1")),
    ).resolves.toBeNull();
    await expect(
      repository.findTokenByRefreshTokenHash(sha256Hex("refresh-token-1")),
    ).resolves.toBeNull();
  });
});
