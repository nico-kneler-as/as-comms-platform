import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  ACCESS_TOKEN_TTL_SECONDS,
  authorizeMcpClient,
  exchangeMcpAuthorizationCode,
  MCP_READ_SCOPE,
  OFFLINE_ACCESS_SCOPE,
  PKCE_CHALLENGE_METHOD,
  refreshMcpAccessToken,
  validateMcpAccessToken,
  type McpOAuthStore
} from "../../src/server/mcp/oauth/core"
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  resolveMcpOAuthMetadataConfig
} from "../../src/server/mcp/oauth/metadata"

const MCP_PUBLIC_URL = "https://as.example.com/api/mcp"
const CLIENT_ID = "client_test"
const CLIENT_SECRET = "top-secret"
const USER_ID = "user-1"
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"
const LOOPBACK_LOCALHOST = "http://localhost/callback"
const LOOPBACK_127 = "http://127.0.0.1/callback"

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function pkceS256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

function buildClient() {
  const now = "2026-07-29T12:00:00.000Z"

  return {
    id: "11111111-1111-4111-8111-111111111111",
    clientId: CLIENT_ID,
    clientSecretHash: sha256Hex(CLIENT_SECRET),
    name: "Claude Connector",
    allowedRedirectUris: [REDIRECT_URI, LOOPBACK_LOCALHOST, LOOPBACK_127],
    revokedAt: null,
    createdAt: now,
    updatedAt: now
  }
}

class InMemoryMcpOAuthStore implements McpOAuthStore {
  readonly clients = new Map<string, ReturnType<typeof buildClient>>()
  readonly authorizationCodes = new Map<string, {
    id: string
    authorizationCodeHash: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    scope: string
    resource: string
    expiresAt: string
    consumedAt: string | null
    createdAt: string
    updatedAt: string
  }>()
  readonly tokensByAccessHash = new Map<string, {
    id: string
    accessTokenHash: string
    refreshTokenHash: string
    clientId: string
    userId: string
    scope: string
    resource: string
    tokenFamilyId: string
    authorizationCodeHash: string | null
    rotatedFromTokenId: string | null
    accessExpiresAt: string
    refreshExpiresAt: string
    rotatedAt: string | null
    revokedAt: string | null
    createdAt: string
    updatedAt: string
  }>()
  readonly tokensByRefreshHash = new Map<string, ReturnType<InMemoryMcpOAuthStore["tokensByAccessHash"]["get"]>>()
  nextCodeId = 1
  nextTokenId = 1

  constructor() {
    this.clients.set(CLIENT_ID, buildClient())
  }

  async findClientByClientId(clientId: string) {
    return this.clients.get(clientId) ?? null
  }

  async createAuthorizationCode(input: {
    authorizationCodeHash: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    scope: string
    resource: string
    expiresAt: string
  }) {
    const now = "2026-07-29T12:00:00.000Z"
    const record = {
      id: `00000000-0000-4000-8000-${this.nextCodeId.toString().padStart(12, "0")}`,
      authorizationCodeHash: input.authorizationCodeHash,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope,
      resource: input.resource,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.nextCodeId += 1
    this.authorizationCodes.set(record.authorizationCodeHash, record)
    return record
  }

  async findAuthorizationCodeByHash(authorizationCodeHash: string) {
    return this.authorizationCodes.get(authorizationCodeHash) ?? null
  }

  async consumeAuthorizationCode(authorizationCodeHash: string, consumedAt: Date) {
    const record = this.authorizationCodes.get(authorizationCodeHash)
    if (
      !record ||
      record.consumedAt !== null ||
      new Date(record.expiresAt).getTime() <= consumedAt.getTime()
    ) {
      return null
    }

    const consumedRecord = {
      ...record,
      consumedAt: consumedAt.toISOString(),
      updatedAt: consumedAt.toISOString()
    }
    this.authorizationCodes.set(authorizationCodeHash, consumedRecord)
    return consumedRecord
  }

  async createTokenFamily(input: {
    accessTokenHash: string
    refreshTokenHash: string
    clientId: string
    userId: string
    scope: string
    resource: string
    tokenFamilyId: string
    authorizationCodeHash?: string | null
    rotatedFromTokenId?: string | null
    accessExpiresAt: string
    refreshExpiresAt: string
  }) {
    const now = "2026-07-29T12:00:00.000Z"
    const record = {
      id: `00000000-0000-4000-8000-${this.nextTokenId.toString().padStart(12, "0")}`,
      accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      resource: input.resource,
      tokenFamilyId: input.tokenFamilyId,
      authorizationCodeHash: input.authorizationCodeHash ?? null,
      rotatedFromTokenId: input.rotatedFromTokenId ?? null,
      accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.nextTokenId += 1
    this.tokensByAccessHash.set(record.accessTokenHash, record)
    this.tokensByRefreshHash.set(record.refreshTokenHash, record)
    return record
  }

  async findTokenByAccessTokenHash(accessTokenHash: string) {
    return this.tokensByAccessHash.get(accessTokenHash) ?? null
  }

  async findTokenByRefreshTokenHash(refreshTokenHash: string) {
    return this.tokensByRefreshHash.get(refreshTokenHash) ?? null
  }

  async rotateRefreshToken(input: {
    accessTokenHash: string
    refreshTokenHash: string
    clientId: string
    userId: string
    scope: string
    resource: string
    tokenFamilyId: string
    authorizationCodeHash?: string | null
    accessExpiresAt: string
    refreshExpiresAt: string
    rotatedFromRefreshTokenHash: string
    rotatedAt: Date
  }) {
    const current = this.tokensByRefreshHash.get(input.rotatedFromRefreshTokenHash)
    if (
      !current ||
      current.rotatedAt !== null ||
      current.revokedAt !== null ||
      new Date(current.refreshExpiresAt).getTime() <= input.rotatedAt.getTime()
    ) {
      return null
    }

    const rotatedCurrent = {
      ...current,
      rotatedAt: input.rotatedAt.toISOString(),
      updatedAt: input.rotatedAt.toISOString()
    }
    this.tokensByAccessHash.set(rotatedCurrent.accessTokenHash, rotatedCurrent)
    this.tokensByRefreshHash.set(rotatedCurrent.refreshTokenHash, rotatedCurrent)

    return this.createTokenFamily({
      accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      resource: input.resource,
      tokenFamilyId: input.tokenFamilyId,
      authorizationCodeHash: input.authorizationCodeHash ?? null,
      rotatedFromTokenId: rotatedCurrent.id,
      accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt
    })
  }

  async revokeTokenFamily(tokenFamilyId: string, revokedAt: Date) {
    let count = 0
    const revokedAtIso = revokedAt.toISOString()

    for (const [accessHash, token] of this.tokensByAccessHash.entries()) {
      if (token.tokenFamilyId !== tokenFamilyId || token.revokedAt !== null) {
        continue
      }

      const revokedToken = {
        ...token,
        revokedAt: revokedAtIso,
        updatedAt: revokedAtIso
      }
      count += 1
      this.tokensByAccessHash.set(accessHash, revokedToken)
      this.tokensByRefreshHash.set(revokedToken.refreshTokenHash, revokedToken)
    }

    return count
  }

  async revokeTokensByAuthorizationCodeHash(authorizationCodeHash: string, revokedAt: Date) {
    let count = 0
    const revokedAtIso = revokedAt.toISOString()

    for (const [accessHash, token] of this.tokensByAccessHash.entries()) {
      if (
        token.authorizationCodeHash !== authorizationCodeHash ||
        token.revokedAt !== null
      ) {
        continue
      }

      const revokedToken = {
        ...token,
        revokedAt: revokedAtIso,
        updatedAt: revokedAtIso
      }
      count += 1
      this.tokensByAccessHash.set(accessHash, revokedToken)
      this.tokensByRefreshHash.set(revokedToken.refreshTokenHash, revokedToken)
    }

    return count
  }

  async revokeAllTokensForUser(userId: string, revokedAt: Date) {
    let count = 0
    const revokedAtIso = revokedAt.toISOString()

    for (const [accessHash, token] of this.tokensByAccessHash.entries()) {
      if (token.userId !== userId || token.revokedAt !== null) {
        continue
      }

      const revokedToken = {
        ...token,
        revokedAt: revokedAtIso,
        updatedAt: revokedAtIso
      }
      count += 1
      this.tokensByAccessHash.set(accessHash, revokedToken)
      this.tokensByRefreshHash.set(revokedToken.refreshTokenHash, revokedToken)
    }

    return count
  }
}

function buildAuthorizeInput(overrides: Partial<Parameters<typeof authorizeMcpClient>[0]> = {}) {
  return {
    store: new InMemoryMcpOAuthStore(),
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    responseType: "code",
    codeChallenge: pkceS256("verifier-1234567890123456789012345678901234567890123"),
    codeChallengeMethod: PKCE_CHALLENGE_METHOD,
    scope: `${MCP_READ_SCOPE} ${OFFLINE_ACCESS_SCOPE}`,
    resource: MCP_PUBLIC_URL,
    state: "state-1",
    userId: USER_ID,
    now: new Date("2026-07-29T12:00:00.000Z"),
    expectedResource: MCP_PUBLIC_URL,
    ...overrides
  }
}

describe("mcp oauth core", () => {
  it("accepts the Claude callback redirect URI and the RFC 8252 loopback callbacks", async () => {
    for (const redirectUri of [
      REDIRECT_URI,
      "http://localhost:53211/callback",
      "http://127.0.0.1:9999/callback"
    ]) {
      const result = await authorizeMcpClient(
        buildAuthorizeInput({
          redirectUri
        })
      )

      expect(result.kind).toBe("success")
    }
  })

  it("rejects unsupported, non-loopback, and unregistered redirect URIs without redirecting", async () => {
    for (const redirectUri of [
      "https://sub.claude.ai/api/mcp/auth_callback",
      "http://example.com/callback",
      "http://localhost:53211/other",
      "https://claude.ai/other"
    ]) {
      const result = await authorizeMcpClient(
        buildAuthorizeInput({
          redirectUri
        })
      )

      expect(result).toEqual({
        kind: "plain_error",
        status: 400,
        message: "Invalid redirect_uri."
      })
    }
  })

  it("rejects missing PKCE challenges and plain challenges at authorize time", async () => {
    const missingChallenge = await authorizeMcpClient(
      buildAuthorizeInput({
        codeChallenge: null
      })
    )
    const plainChallenge = await authorizeMcpClient(
      buildAuthorizeInput({
        codeChallengeMethod: "plain"
      })
    )

    expect(missingChallenge).toMatchObject({
      kind: "redirect_error",
      error: "invalid_request"
    })
    expect(plainChallenge).toMatchObject({
      kind: "redirect_error",
      error: "invalid_request"
    })
  })

  it("exchanges an authorization code when the PKCE verifier matches", async () => {
    const store = new InMemoryMcpOAuthStore()
    const codeVerifier = "verifier-1234567890123456789012345678901234567890123"
    const authorizeResult = await authorizeMcpClient(
      buildAuthorizeInput({
        store,
        codeChallenge: pkceS256(codeVerifier)
      })
    )

    if (authorizeResult.kind !== "success") {
      throw new Error("Expected authorization success.")
    }

    const tokenResult = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(tokenResult).toMatchObject({
      kind: "success",
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: `${MCP_READ_SCOPE} ${OFFLINE_ACCESS_SCOPE}`,
      resource: MCP_PUBLIC_URL,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS
    })
  })

  it("rejects a mismatched PKCE verifier with invalid_grant", async () => {
    const store = new InMemoryMcpOAuthStore()
    const authorizeResult = await authorizeMcpClient(buildAuthorizeInput({ store }))

    if (authorizeResult.kind !== "success") {
      throw new Error("Expected authorization success.")
    }

    const tokenResult = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier: "wrong-verifier-1234567890123456789012345678901234567890123",
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(tokenResult).toMatchObject({
      kind: "error",
      error: "invalid_grant",
      status: 400
    })
  })

  it("enforces single-use authorization codes and revokes tokens on replay", async () => {
    const store = new InMemoryMcpOAuthStore()
    const codeVerifier = "verifier-1234567890123456789012345678901234567890123"
    const authorizeResult = await authorizeMcpClient(
      buildAuthorizeInput({
        store,
        codeChallenge: pkceS256(codeVerifier)
      })
    )

    if (authorizeResult.kind !== "success") {
      throw new Error("Expected authorization success.")
    }

    const firstExchange = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(firstExchange.kind).toBe("success")

    const replayExchange = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:31.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(replayExchange).toMatchObject({
      kind: "error",
      error: "invalid_grant",
      status: 400
    })

    const revokedTokens = [...store.tokensByAccessHash.values()]
    expect(revokedTokens).toHaveLength(1)
    expect(revokedTokens[0]?.revokedAt).not.toBeNull()
  })

  it("rejects expired codes, redirect mismatches, and client mismatches with invalid_grant", async () => {
    const store = new InMemoryMcpOAuthStore()
    const authorizeResult = await authorizeMcpClient(buildAuthorizeInput({ store }))
    store.clients.set("different-client", {
      ...buildClient(),
      id: "77777777-7777-4777-8777-777777777777",
      clientId: "different-client",
      clientSecretHash: sha256Hex("different-secret")
    })

    if (authorizeResult.kind !== "success") {
      throw new Error("Expected authorization success.")
    }

    const expired = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier: "verifier-1234567890123456789012345678901234567890123",
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:03:01.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })
    const redirectMismatch = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier: "verifier-1234567890123456789012345678901234567890123",
      redirectUri: "http://localhost:53211/callback",
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })
    const clientMismatch = await exchangeMcpAuthorizationCode({
      store,
      clientId: "different-client",
      clientSecret: "different-secret",
      code: authorizeResult.code,
      codeVerifier: "verifier-1234567890123456789012345678901234567890123",
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    for (const result of [expired, redirectMismatch, clientMismatch]) {
      expect(result).toMatchObject({
        kind: "error",
        error: "invalid_grant",
        status: 400
      })
    }
  })

  it("rotates refresh tokens and revokes the family when a rotated refresh token is reused", async () => {
    const store = new InMemoryMcpOAuthStore()
    const codeVerifier = "verifier-1234567890123456789012345678901234567890123"
    const authorizeResult = await authorizeMcpClient(
      buildAuthorizeInput({
        store,
        codeChallenge: pkceS256(codeVerifier)
      })
    )

    if (authorizeResult.kind !== "success") {
      throw new Error("Expected authorization success.")
    }

    const initialTokenResult = await exchangeMcpAuthorizationCode({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorizeResult.code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:30.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    if (initialTokenResult.kind !== "success") {
      throw new Error("Expected token exchange success.")
    }

    const rotated = await refreshMcpAccessToken({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: initialTokenResult.refreshToken,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:05:00.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(rotated.kind).toBe("success")
    if (rotated.kind !== "success") {
      throw new Error("Expected refresh success.")
    }
    expect(rotated.refreshToken).not.toBe(initialTokenResult.refreshToken)
    expect(rotated.accessToken).not.toBe(initialTokenResult.accessToken)

    const replay = await refreshMcpAccessToken({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: initialTokenResult.refreshToken,
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:05:01.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(replay).toMatchObject({
      kind: "error",
      error: "invalid_grant",
      status: 400
    })

    const familyTokens = [...store.tokensByAccessHash.values()].filter(
      (token) => token.tokenFamilyId === store.tokensByAccessHash.values().next().value?.tokenFamilyId
    )
    expect(familyTokens.every((token) => token.revokedAt !== null)).toBe(true)
  })

  it("rejects expired refresh tokens with invalid_grant", async () => {
    const store = new InMemoryMcpOAuthStore()
    const token = await store.createTokenFamily({
      accessTokenHash: sha256Hex("access-token"),
      refreshTokenHash: sha256Hex("refresh-token"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: `${MCP_READ_SCOPE} ${OFFLINE_ACCESS_SCOPE}`,
      resource: MCP_PUBLIC_URL,
      tokenFamilyId: "22222222-2222-4222-8222-222222222222",
      authorizationCodeHash: null,
      accessExpiresAt: "2026-07-29T12:30:00.000Z",
      refreshExpiresAt: "2026-07-29T12:00:00.000Z"
    })

    expect(token.refreshTokenHash).toBe(sha256Hex("refresh-token"))

    const refreshResult = await refreshMcpAccessToken({
      store,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: "refresh-token",
      resource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z"),
      expectedResource: MCP_PUBLIC_URL,
      isUserAuthorized: async () => true
    })

    expect(refreshResult).toMatchObject({
      kind: "error",
      error: "invalid_grant",
      status: 400
    })
  })

  it("validates access tokens, rejects revoked or wrong-resource tokens, and enforces token expiry", async () => {
    const store = new InMemoryMcpOAuthStore()
    await store.createTokenFamily({
      accessTokenHash: sha256Hex("valid-access-token"),
      refreshTokenHash: sha256Hex("valid-refresh-token"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: `${MCP_READ_SCOPE} ${OFFLINE_ACCESS_SCOPE}`,
      resource: MCP_PUBLIC_URL,
      tokenFamilyId: "33333333-3333-4333-8333-333333333333",
      authorizationCodeHash: null,
      accessExpiresAt: "2026-07-29T13:00:00.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z"
    })
    await store.createTokenFamily({
      accessTokenHash: sha256Hex("expired-access-token"),
      refreshTokenHash: sha256Hex("expired-refresh-token"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: MCP_READ_SCOPE,
      resource: MCP_PUBLIC_URL,
      tokenFamilyId: "44444444-4444-4444-8444-444444444444",
      authorizationCodeHash: null,
      accessExpiresAt: "2026-07-29T11:59:59.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z"
    })
    await store.createTokenFamily({
      accessTokenHash: sha256Hex("wrong-resource-access-token"),
      refreshTokenHash: sha256Hex("wrong-resource-refresh-token"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: MCP_READ_SCOPE,
      resource: "https://as.example.com/api/other",
      tokenFamilyId: "55555555-5555-4555-8555-555555555555",
      authorizationCodeHash: null,
      accessExpiresAt: "2026-07-29T13:00:00.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z"
    })

    const revokedRecord = await store.createTokenFamily({
      accessTokenHash: sha256Hex("revoked-access-token"),
      refreshTokenHash: sha256Hex("revoked-refresh-token"),
      clientId: CLIENT_ID,
      userId: USER_ID,
      scope: MCP_READ_SCOPE,
      resource: MCP_PUBLIC_URL,
      tokenFamilyId: "66666666-6666-4666-8666-666666666666",
      authorizationCodeHash: null,
      accessExpiresAt: "2026-07-29T13:00:00.000Z",
      refreshExpiresAt: "2026-08-28T12:00:00.000Z"
    })
    await store.revokeTokenFamily(revokedRecord.tokenFamilyId, new Date("2026-07-29T12:00:00.000Z"))

    const valid = await validateMcpAccessToken({
      store,
      accessToken: "valid-access-token",
      expectedResource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z")
    })
    const expired = await validateMcpAccessToken({
      store,
      accessToken: "expired-access-token",
      expectedResource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z")
    })
    const wrongResource = await validateMcpAccessToken({
      store,
      accessToken: "wrong-resource-access-token",
      expectedResource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z")
    })
    const revoked = await validateMcpAccessToken({
      store,
      accessToken: "revoked-access-token",
      expectedResource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z")
    })
    const missing = await validateMcpAccessToken({
      store,
      accessToken: "missing-access-token",
      expectedResource: MCP_PUBLIC_URL,
      now: new Date("2026-07-29T12:00:01.000Z")
    })

    expect(valid).toMatchObject({
      kind: "success",
      scopes: [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE]
    })

    for (const result of [expired, wrongResource, revoked, missing]) {
      expect(result).toMatchObject({
        kind: "error",
        status: 401
      })
    }
  })

  it("builds metadata with the exact resource, S256 support, and no registration endpoint", () => {
    const metadata = resolveMcpOAuthMetadataConfig(MCP_PUBLIC_URL)
    const protectedResourceMetadata = createProtectedResourceMetadata(metadata)
    const authorizationServerMetadata = createAuthorizationServerMetadata(metadata)

    expect(protectedResourceMetadata).toMatchObject({
      resource: MCP_PUBLIC_URL,
      authorization_servers: [metadata.issuer],
      scopes_supported: [MCP_READ_SCOPE]
    })
    expect(authorizationServerMetadata).toMatchObject({
      issuer: metadata.issuer,
      authorization_endpoint: `${metadata.issuer}/authorize`,
      token_endpoint: `${metadata.issuer}/token`,
      code_challenge_methods_supported: [PKCE_CHALLENGE_METHOD],
      scopes_supported: [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE]
    })
    expect("registration_endpoint" in authorizationServerMetadata).toBe(false)
  })
})
