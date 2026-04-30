import {
  type GmailAccessTokenCacheEntry,
  GmailOAuthExchangeError,
  exchangeGmailAccessToken,
} from "./gmail-oauth.js";
import type { GmailSendConfig } from "./gmail-send.js";

export type GmailThreadResolutionResult =
  | { readonly kind: "resolved"; readonly threadId: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "auth_error"; readonly detail: string }
  | { readonly kind: "transient"; readonly detail: string };

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function readResponseDetail(response: Response): Promise<string> {
  const text = (await response.text()).trim();

  if (text.length > 0) {
    return text;
  }

  return `Gmail thread lookup failed with status ${String(response.status)}.`;
}

export async function resolveLiveGmailThreadId(input: {
  readonly rfc822MessageId: string | null;
  readonly config: GmailSendConfig;
  readonly fetchImplementation?: typeof fetch;
}): Promise<GmailThreadResolutionResult> {
  if (input.rfc822MessageId === null) {
    return { kind: "not_found" };
  }

  const now = input.config.now ?? (() => new Date());
  const accessTokenCache =
    input.config.accessTokenCache ??
    new Map<string, GmailAccessTokenCacheEntry>();
  const fetchImplementation =
    input.fetchImplementation ?? input.config.fetchImplementation;

  let accessToken: string;

  try {
    const token = await exchangeGmailAccessToken({
      config: {
        oauthClient: input.config.oauthClient,
        oauthRefreshToken: input.config.oauthRefreshToken,
        ...(input.config.timeoutMs === undefined
          ? {}
          : { timeoutMs: input.config.timeoutMs }),
      },
      cacheKey: input.config.liveAccount,
      fetchImplementation,
      now,
      accessTokenCache,
    });
    accessToken = token.accessToken;
  } catch (error) {
    if (error instanceof GmailOAuthExchangeError) {
      if (error.reason === "disconnected") {
        return {
          kind: "auth_error",
          detail: error.message,
        };
      }

      return {
        kind: "transient",
        detail: error.message,
      };
    }

    return {
      kind: "transient",
      detail: "OAuth token exchange failed unexpectedly.",
    };
  }

  const searchUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  searchUrl.search = new URLSearchParams({
    q: `rfc822msgid:${input.rfc822MessageId}`,
    maxResults: "1",
    format: "minimal",
  }).toString();

  let response: Response;

  try {
    response = await fetchImplementation(searchUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(input.config.timeoutMs ?? 15_000),
    });
  } catch (error) {
    return {
      kind: "transient",
      detail: isTimeoutError(error)
        ? "Gmail thread lookup timed out."
        : "Gmail thread lookup request failed.",
    };
  }

  if (response.status === 401) {
    return {
      kind: "auth_error",
      detail: await readResponseDetail(response),
    };
  }

  if (response.status >= 500) {
    return {
      kind: "transient",
      detail: await readResponseDetail(response),
    };
  }

  if (!response.ok) {
    return {
      kind: "not_found",
    };
  }

  const payload = (await response.json()) as {
    readonly messages?: readonly { readonly threadId?: string }[];
  };
  const threadId = payload.messages?.[0]?.threadId;

  if (typeof threadId === "string" && threadId.length > 0) {
    return {
      kind: "resolved",
      threadId,
    };
  }

  return {
    kind: "not_found",
  };
}
