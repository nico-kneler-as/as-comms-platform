import { z } from "zod";

const gmailOAuthClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tokenUri: z.string().url().default("https://oauth2.googleapis.com/token")
});

const gmailAccessTokenRequestSchema = z.object({
  oauthClient: gmailOAuthClientSchema,
  oauthRefreshToken: z.string().min(1),
  timeoutMs: z.number().int().positive().default(15_000)
});

export type GmailOAuthClient = z.input<typeof gmailOAuthClientSchema>;
type ResolvedGmailAccessTokenRequest = z.output<
  typeof gmailAccessTokenRequestSchema
>;

export interface GmailAccessTokenCacheEntry {
  readonly accessToken: string;
  readonly expiresAtEpochSeconds: number;
}

export class GmailOAuthExchangeError extends Error {
  constructor(
    readonly reason:
      | "disconnected"
      | "timeout"
      | "network"
      | "invalid_response"
      | "exchange_failed",
    message: string
  ) {
    super(message);
    this.name = "GmailOAuthExchangeError";
  }
}

const gmailTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().default(3600)
});

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isDisconnectedGmailTokenError(
  status: number,
  responseText: string
): boolean {
  if (status !== 400 && status !== 401) {
    return false;
  }

  return /(invalid_grant|revoked|permission|access_denied)/iu.test(
    responseText
  );
}

export async function exchangeGmailAccessToken(input: {
  readonly config: {
    readonly oauthClient: GmailOAuthClient;
    readonly oauthRefreshToken: string;
    readonly timeoutMs?: number;
  };
  readonly cacheKey: string;
  readonly fetchImplementation: typeof fetch;
  readonly now: () => Date;
  readonly accessTokenCache: Map<string, GmailAccessTokenCacheEntry>;
}): Promise<GmailAccessTokenCacheEntry> {
  const parsedConfig: ResolvedGmailAccessTokenRequest =
    gmailAccessTokenRequestSchema.parse(input.config);
  const nowEpochSeconds = Math.floor(input.now().getTime() / 1000);
  const cachedToken = input.accessTokenCache.get(input.cacheKey);

  if (
    cachedToken !== undefined &&
    cachedToken.expiresAtEpochSeconds - 30 > nowEpochSeconds
  ) {
    return cachedToken;
  }

  let response: Response;

  try {
    response = await input.fetchImplementation(parsedConfig.oauthClient.tokenUri, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: parsedConfig.oauthClient.clientId,
        client_secret: parsedConfig.oauthClient.clientSecret,
        refresh_token: parsedConfig.oauthRefreshToken
      }).toString(),
      signal: AbortSignal.timeout(parsedConfig.timeoutMs)
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new GmailOAuthExchangeError(
        "timeout",
        "OAuth token exchange timed out."
      );
    }

    throw new GmailOAuthExchangeError(
      "network",
      "OAuth token exchange request failed."
    );
  }

  if (!response.ok) {
    const responseText = await response.text();

    if (isDisconnectedGmailTokenError(response.status, responseText)) {
      throw new GmailOAuthExchangeError(
        "disconnected",
        "OAuth refresh token expired, was revoked, or lost required permissions."
      );
    }

    throw new GmailOAuthExchangeError(
      "exchange_failed",
      `OAuth token exchange failed with status ${String(response.status)}.`
    );
  }

  let tokenJson: z.infer<typeof gmailTokenResponseSchema>;

  try {
    tokenJson = gmailTokenResponseSchema.parse(
      JSON.parse(await response.text()) as unknown
    );
  } catch {
    throw new GmailOAuthExchangeError(
      "invalid_response",
      "OAuth token exchange returned an unexpected response."
    );
  }

  const token = {
    accessToken: tokenJson.access_token,
    expiresAtEpochSeconds: nowEpochSeconds + tokenJson.expires_in
  } satisfies GmailAccessTokenCacheEntry;
  input.accessTokenCache.set(input.cacheKey, token);

  return token;
}
