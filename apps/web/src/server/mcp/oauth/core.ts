import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  CreateMcpOAuthAuthorizationCodeInput,
  CreateMcpOAuthTokenInput,
  McpOAuthAuthorizationCodeRecord,
  McpOAuthClientRecord,
  McpOAuthTokenRecord,
} from "@as-comms/contracts";

export const MCP_READ_SCOPE = "mcp:read";
export const OFFLINE_ACCESS_SCOPE = "offline_access";
export const AUTHORIZATION_CODE_TTL_SECONDS = 120;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PKCE_CHALLENGE_METHOD = "S256";

const CLAUDE_CALLBACK_URL = "https://claude.ai/api/mcp/auth_callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOOPBACK_PATH = "/callback";

export type OAuthErrorCode =
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_scope"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type";

export interface OAuthErrorResult {
  readonly kind: "error";
  readonly error: OAuthErrorCode;
  readonly errorDescription: string;
  readonly status: number;
}

export interface OAuthRedirectErrorResult {
  readonly kind: "redirect_error";
  readonly redirectUri: string;
  readonly error: OAuthErrorCode;
  readonly errorDescription: string;
  readonly state: string | null;
}

export interface OAuthPlainErrorResult {
  readonly kind: "plain_error";
  readonly status: number;
  readonly message: string;
}

export interface AuthorizationSuccessResult {
  readonly kind: "success";
  readonly redirectUri: string;
  readonly state: string | null;
  readonly code: string;
}

export interface TokenSuccessResult {
  readonly kind: "success";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly resource: string;
  readonly userId: string;
  readonly clientId: string;
}

export interface AccessTokenValidationResult {
  readonly kind: "success";
  readonly token: McpOAuthTokenRecord;
  readonly scopes: readonly string[];
}

export interface McpOAuthStore {
  findClientByClientId(clientId: string): Promise<McpOAuthClientRecord | null>;
  createAuthorizationCode(
    input: CreateMcpOAuthAuthorizationCodeInput,
  ): Promise<McpOAuthAuthorizationCodeRecord>;
  findAuthorizationCodeByHash(
    authorizationCodeHash: string,
  ): Promise<McpOAuthAuthorizationCodeRecord | null>;
  consumeAuthorizationCode(
    authorizationCodeHash: string,
    consumedAt: Date,
  ): Promise<McpOAuthAuthorizationCodeRecord | null>;
  createTokenFamily(
    input: CreateMcpOAuthTokenInput,
  ): Promise<McpOAuthTokenRecord>;
  findTokenByAccessTokenHash(
    accessTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null>;
  findTokenByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null>;
  rotateRefreshToken(input: {
    readonly accessTokenHash: string;
    readonly refreshTokenHash: string;
    readonly clientId: string;
    readonly userId: string;
    readonly scope: string;
    readonly resource: string;
    readonly tokenFamilyId: string;
    readonly authorizationCodeHash?: string | null;
    readonly accessExpiresAt: string;
    readonly refreshExpiresAt: string;
    readonly rotatedFromRefreshTokenHash: string;
    readonly rotatedAt: Date;
  }): Promise<McpOAuthTokenRecord | null>;
  revokeTokenFamily(tokenFamilyId: string, revokedAt: Date): Promise<number>;
  revokeTokensByAuthorizationCodeHash(
    authorizationCodeHash: string,
    revokedAt: Date,
  ): Promise<number>;
  revokeAllTokensForUser(userId: string, revokedAt: Date): Promise<number>;
}

interface ScopeResult {
  readonly scopes: readonly string[];
  readonly scope: string;
}

interface ValidatedClientResult {
  readonly client: McpOAuthClientRecord;
}

function isOAuthErrorResult(value: unknown): value is OAuthErrorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: string }).kind === "error"
  );
}

function createErrorResult(
  error: OAuthErrorCode,
  errorDescription: string,
  status: number,
): OAuthErrorResult {
  return {
    kind: "error",
    error,
    errorDescription,
    status,
  };
}

function toHexSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toPkceCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildScopeResult(requestedScope: string | null | undefined): ScopeResult | OAuthErrorResult {
  if (requestedScope === undefined || requestedScope === null || requestedScope.trim() === "") {
    return {
      scopes: [MCP_READ_SCOPE],
      scope: MCP_READ_SCOPE,
    };
  }

  const requestedScopes = requestedScope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueScopes = [...new Set(requestedScopes)];

  if (!uniqueScopes.includes(MCP_READ_SCOPE)) {
    return createErrorResult(
      "invalid_scope",
      "The requested scope must include mcp:read.",
      400,
    );
  }

  for (const scope of uniqueScopes) {
    if (scope !== MCP_READ_SCOPE && scope !== OFFLINE_ACCESS_SCOPE) {
      return createErrorResult(
        "invalid_scope",
        "The requested scope is not supported.",
        400,
      );
    }
  }

  const scopes = uniqueScopes.includes(OFFLINE_ACCESS_SCOPE)
    ? [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE]
    : [MCP_READ_SCOPE];

  return {
    scopes,
    scope: scopes.join(" "),
  };
}

function isLoopbackRedirect(rawRedirectUri: string): boolean {
  try {
    const parsed = new URL(rawRedirectUri);

    return (
      parsed.protocol === "http:" &&
      LOOPBACK_HOSTS.has(parsed.hostname) &&
      parsed.pathname === LOOPBACK_PATH &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function isSupportedRedirectUri(rawRedirectUri: string): boolean {
  return rawRedirectUri === CLAUDE_CALLBACK_URL || isLoopbackRedirect(rawRedirectUri);
}

function redirectUriMatchesRegistration(
  requestedRedirectUri: string,
  registeredRedirectUri: string,
): boolean {
  if (requestedRedirectUri === registeredRedirectUri) {
    return true;
  }

  if (!isLoopbackRedirect(requestedRedirectUri) || !isLoopbackRedirect(registeredRedirectUri)) {
    return false;
  }

  const requested = new URL(requestedRedirectUri);
  const registered = new URL(registeredRedirectUri);

  return (
    requested.protocol === registered.protocol &&
    requested.hostname === registered.hostname &&
    requested.pathname === registered.pathname
  );
}

function isRegisteredRedirectUri(
  requestedRedirectUri: string,
  registeredRedirectUris: readonly string[],
): boolean {
  return registeredRedirectUris.some((registeredRedirectUri) =>
    redirectUriMatchesRegistration(requestedRedirectUri, registeredRedirectUri),
  );
}

function resolveResource(
  resource: string | null | undefined,
  expectedResource: string,
): string | OAuthErrorResult {
  const resolvedResource =
    resource === undefined || resource === null || resource.trim() === ""
      ? expectedResource
      : resource;

  if (resolvedResource !== expectedResource) {
    return createErrorResult(
      "invalid_request",
      "The resource parameter is invalid.",
      400,
    );
  }

  return resolvedResource;
}

function encodeRedirectError(input: {
  readonly redirectUri: string;
  readonly error: OAuthErrorCode;
  readonly errorDescription: string;
  readonly state: string | null;
}): OAuthRedirectErrorResult {
  return {
    kind: "redirect_error",
    redirectUri: input.redirectUri,
    error: input.error,
    errorDescription: input.errorDescription,
    state: input.state,
  };
}

async function validateClient(
  store: McpOAuthStore,
  input: {
    readonly clientId: string | null | undefined;
    readonly clientSecret: string | null | undefined;
  },
): Promise<ValidatedClientResult | OAuthErrorResult> {
  if (!input.clientId || input.clientId.trim() === "") {
    return createErrorResult("invalid_client", "The client_id is required.", 401);
  }

  if (!input.clientSecret || input.clientSecret.trim() === "") {
    return createErrorResult("invalid_client", "The client_secret is required.", 401);
  }

  const client = await store.findClientByClientId(input.clientId);
  if (client === null) {
    return createErrorResult("invalid_client", "The client is invalid.", 401);
  }

  if (client.revokedAt !== null) {
    return createErrorResult("invalid_client", "The client is revoked.", 401);
  }

  const providedSecretHash = toHexSha256(input.clientSecret);
  if (!timingSafeStringEqual(providedSecretHash, client.clientSecretHash)) {
    return createErrorResult("invalid_client", "The client is invalid.", 401);
  }

  return { client };
}

function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

function expiresAtFromNow(now: Date, ttlSeconds: number): string {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

function isExpired(isoTimestamp: string, now: Date): boolean {
  return new Date(isoTimestamp).getTime() <= now.getTime();
}

function parseScopes(scope: string): readonly string[] {
  return scope.split(/\s+/).map((value) => value.trim()).filter(Boolean);
}

export async function authorizeMcpClient(input: {
  readonly store: McpOAuthStore;
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  readonly responseType: string | null;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
  readonly scope: string | null;
  readonly resource: string | null;
  readonly state: string | null;
  readonly userId: string;
  readonly now: Date;
  readonly expectedResource: string;
}): Promise<AuthorizationSuccessResult | OAuthRedirectErrorResult | OAuthPlainErrorResult> {
  if (!input.clientId || input.clientId.trim() === "") {
    return {
      kind: "plain_error",
      status: 400,
      message: "Missing client_id.",
    };
  }

  const client = await input.store.findClientByClientId(input.clientId);
  if (client === null) {
    return {
      kind: "plain_error",
      status: 400,
      message: "Unknown client_id.",
    };
  }

  const rawRedirectUri = input.redirectUri ?? "";
  const hasValidRedirectUri =
    rawRedirectUri.length > 0 &&
    isSupportedRedirectUri(rawRedirectUri) &&
    isRegisteredRedirectUri(rawRedirectUri, client.allowedRedirectUris);

  if (!hasValidRedirectUri) {
    return {
      kind: "plain_error",
      status: 400,
      message: "Invalid redirect_uri.",
    };
  }

  if (client.revokedAt !== null) {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: "unauthorized_client",
      errorDescription: "The client is revoked.",
      state: input.state,
    });
  }

  if (input.responseType !== "code") {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: "unsupported_response_type",
      errorDescription: "Only response_type=code is supported.",
      state: input.state,
    });
  }

  if (!input.codeChallenge || input.codeChallenge.trim() === "") {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: "invalid_request",
      errorDescription: "A PKCE code_challenge is required.",
      state: input.state,
    });
  }

  if (input.codeChallengeMethod !== PKCE_CHALLENGE_METHOD) {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: "invalid_request",
      errorDescription: "Only PKCE S256 is supported.",
      state: input.state,
    });
  }

  const scopeResult = buildScopeResult(input.scope);
  if (isOAuthErrorResult(scopeResult)) {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: scopeResult.error,
      errorDescription: scopeResult.errorDescription,
      state: input.state,
    });
  }

  const resourceResult = resolveResource(input.resource, input.expectedResource);
  if (isOAuthErrorResult(resourceResult)) {
    return encodeRedirectError({
      redirectUri: rawRedirectUri,
      error: resourceResult.error,
      errorDescription: resourceResult.errorDescription,
      state: input.state,
    });
  }

  const code = createOpaqueToken();
  const authorizationCodeHash = toHexSha256(code);
  await input.store.createAuthorizationCode({
    authorizationCodeHash,
    clientId: client.clientId,
    userId: input.userId,
    redirectUri: rawRedirectUri,
    codeChallenge: input.codeChallenge,
    scope: scopeResult.scope,
    resource: resourceResult,
    expiresAt: expiresAtFromNow(input.now, AUTHORIZATION_CODE_TTL_SECONDS),
  });

  return {
    kind: "success",
    redirectUri: rawRedirectUri,
    state: input.state,
    code,
  };
}

export async function exchangeMcpAuthorizationCode(input: {
  readonly store: McpOAuthStore;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly code: string | null;
  readonly codeVerifier: string | null;
  readonly redirectUri: string | null;
  readonly resource: string | null;
  readonly now: Date;
  readonly expectedResource: string;
  readonly isUserAuthorized: (userId: string) => Promise<boolean>;
}): Promise<TokenSuccessResult | OAuthErrorResult> {
  const validatedClient = await validateClient(input.store, {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
  if (isOAuthErrorResult(validatedClient)) {
    return validatedClient;
  }

  if (!input.code || input.code.trim() === "") {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (!input.codeVerifier || input.codeVerifier.trim() === "") {
    return createErrorResult("invalid_grant", "The PKCE code_verifier is invalid.", 400);
  }

  if (!input.redirectUri || input.redirectUri.trim() === "") {
    return createErrorResult("invalid_grant", "The redirect_uri is invalid.", 400);
  }

  const resourceResult = resolveResource(input.resource, input.expectedResource);
  if (isOAuthErrorResult(resourceResult)) {
    return createErrorResult("invalid_grant", "The authorization grant is invalid.", 400);
  }

  const authorizationCodeHash = toHexSha256(input.code);
  const authorizationCode = await input.store.findAuthorizationCodeByHash(
    authorizationCodeHash,
  );

  if (authorizationCode === null) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (authorizationCode.clientId !== validatedClient.client.clientId) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (authorizationCode.redirectUri !== input.redirectUri) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (authorizationCode.resource !== resourceResult) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (authorizationCode.consumedAt !== null) {
    await input.store.revokeTokensByAuthorizationCodeHash(
      authorizationCode.authorizationCodeHash,
      input.now,
    );
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  if (isExpired(authorizationCode.expiresAt, input.now)) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  const expectedChallenge = toPkceCodeChallenge(input.codeVerifier);
  if (!timingSafeStringEqual(expectedChallenge, authorizationCode.codeChallenge)) {
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  const consumedAuthorizationCode = await input.store.consumeAuthorizationCode(
    authorizationCodeHash,
    input.now,
  );
  if (consumedAuthorizationCode === null) {
    await input.store.revokeTokensByAuthorizationCodeHash(
      authorizationCode.authorizationCodeHash,
      input.now,
    );
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  const isUserAuthorized = await input.isUserAuthorized(authorizationCode.userId);
  if (!isUserAuthorized) {
    await input.store.revokeAllTokensForUser(authorizationCode.userId, input.now);
    return createErrorResult("invalid_grant", "The authorization code is invalid.", 400);
  }

  const accessToken = createOpaqueToken();
  const refreshToken = createOpaqueToken();
  const tokenFamilyId = randomUUID();
  const accessTokenHash = toHexSha256(accessToken);
  const refreshTokenHash = toHexSha256(refreshToken);

  await input.store.createTokenFamily({
    accessTokenHash,
    refreshTokenHash,
    clientId: authorizationCode.clientId,
    userId: authorizationCode.userId,
    scope: authorizationCode.scope,
    resource: authorizationCode.resource,
    tokenFamilyId,
    authorizationCodeHash: authorizationCode.authorizationCodeHash,
    accessExpiresAt: expiresAtFromNow(input.now, ACCESS_TOKEN_TTL_SECONDS),
    refreshExpiresAt: expiresAtFromNow(input.now, REFRESH_TOKEN_TTL_SECONDS),
  });

  return {
    kind: "success",
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: authorizationCode.scope,
    resource: authorizationCode.resource,
    userId: authorizationCode.userId,
    clientId: authorizationCode.clientId,
  };
}

export async function refreshMcpAccessToken(input: {
  readonly store: McpOAuthStore;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly refreshToken: string | null;
  readonly resource: string | null;
  readonly now: Date;
  readonly expectedResource: string;
  readonly isUserAuthorized: (userId: string) => Promise<boolean>;
}): Promise<TokenSuccessResult | OAuthErrorResult> {
  const validatedClient = await validateClient(input.store, {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
  if (isOAuthErrorResult(validatedClient)) {
    return validatedClient;
  }

  if (!input.refreshToken || input.refreshToken.trim() === "") {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  const resourceResult = resolveResource(input.resource, input.expectedResource);
  if (isOAuthErrorResult(resourceResult)) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  const refreshTokenHash = toHexSha256(input.refreshToken);
  const token = await input.store.findTokenByRefreshTokenHash(refreshTokenHash);

  if (token === null) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  if (token.clientId !== validatedClient.client.clientId) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  if (token.resource !== resourceResult) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  if (token.revokedAt !== null) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  if (isExpired(token.refreshExpiresAt, input.now)) {
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  if (token.rotatedAt !== null) {
    await input.store.revokeTokenFamily(token.tokenFamilyId, input.now);
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  const isUserAuthorized = await input.isUserAuthorized(token.userId);
  if (!isUserAuthorized) {
    await input.store.revokeAllTokensForUser(token.userId, input.now);
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  const nextAccessToken = createOpaqueToken();
  const nextRefreshToken = createOpaqueToken();
  const rotatedToken = await input.store.rotateRefreshToken({
    accessTokenHash: toHexSha256(nextAccessToken),
    refreshTokenHash: toHexSha256(nextRefreshToken),
    clientId: token.clientId,
    userId: token.userId,
    scope: token.scope,
    resource: token.resource,
    tokenFamilyId: token.tokenFamilyId,
    authorizationCodeHash: token.authorizationCodeHash,
    accessExpiresAt: expiresAtFromNow(input.now, ACCESS_TOKEN_TTL_SECONDS),
    refreshExpiresAt: expiresAtFromNow(input.now, REFRESH_TOKEN_TTL_SECONDS),
    rotatedFromRefreshTokenHash: refreshTokenHash,
    rotatedAt: input.now,
  });

  if (rotatedToken === null) {
    await input.store.revokeTokenFamily(token.tokenFamilyId, input.now);
    return createErrorResult("invalid_grant", "The refresh token is invalid.", 400);
  }

  return {
    kind: "success",
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: token.scope,
    resource: token.resource,
    userId: token.userId,
    clientId: token.clientId,
  };
}

export async function validateMcpAccessToken(input: {
  readonly store: McpOAuthStore;
  readonly accessToken: string | null;
  readonly expectedResource: string;
  readonly now: Date;
}): Promise<AccessTokenValidationResult | OAuthErrorResult> {
  if (!input.accessToken || input.accessToken.trim() === "") {
    return createErrorResult("invalid_request", "A bearer token is required.", 401);
  }

  const accessTokenHash = toHexSha256(input.accessToken);
  const token = await input.store.findTokenByAccessTokenHash(accessTokenHash);
  if (token === null) {
    return createErrorResult("invalid_grant", "The access token is invalid.", 401);
  }

  if (token.revokedAt !== null) {
    return createErrorResult("invalid_grant", "The access token is invalid.", 401);
  }

  if (isExpired(token.accessExpiresAt, input.now)) {
    return createErrorResult("invalid_grant", "The access token is invalid.", 401);
  }

  if (token.resource !== input.expectedResource) {
    return createErrorResult("invalid_grant", "The access token is invalid.", 401);
  }

  return {
    kind: "success",
    token,
    scopes: parseScopes(token.scope),
  };
}

export function parseTokenEndpointClientCredentials(input: {
  readonly authorizationHeader: string | null;
  readonly bodyClientId: string | null;
  readonly bodyClientSecret: string | null;
}): { readonly clientId: string | null; readonly clientSecret: string | null } | OAuthErrorResult {
  if (!input.authorizationHeader || input.authorizationHeader.trim() === "") {
    return {
      clientId: input.bodyClientId,
      clientSecret: input.bodyClientSecret,
    };
  }

  const [scheme, encodedCredentials] = input.authorizationHeader.split(" ");
  if (scheme !== "Basic" || !encodedCredentials) {
    return createErrorResult(
      "invalid_client",
      "Only HTTP Basic client authentication is supported in the Authorization header.",
      401,
    );
  }

  let decodedCredentials = "";
  try {
    decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
  } catch {
    return createErrorResult("invalid_client", "The client is invalid.", 401);
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex < 0) {
    return createErrorResult("invalid_client", "The client is invalid.", 401);
  }

  const clientId = decodedCredentials.slice(0, separatorIndex);
  const clientSecret = decodedCredentials.slice(separatorIndex + 1);

  if (
    (input.bodyClientId && input.bodyClientId !== clientId) ||
    (input.bodyClientSecret && input.bodyClientSecret !== clientSecret)
  ) {
    return createErrorResult(
      "invalid_request",
      "Conflicting client credentials were supplied.",
      400,
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

export function createTokenResponseBody(result: TokenSuccessResult): Record<string, unknown> {
  return {
    access_token: result.accessToken,
    token_type: "Bearer",
    expires_in: result.expiresIn,
    refresh_token: result.refreshToken,
    scope: result.scope,
  };
}
