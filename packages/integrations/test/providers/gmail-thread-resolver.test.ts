import { describe, expect, it, vi } from "vitest";

import { resolveLiveGmailThreadId } from "../../src/index.js";

function hasRequestUrl(input: unknown): input is { url: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    typeof input.url === "string"
  );
}

function resolveRequestUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (hasRequestUrl(input)) {
    return input.url;
  }

  throw new Error("Expected request input to be a string, URL, or Request-like object.");
}

function createFetchMock(input?: {
  readonly tokenResponse?: Response;
  readonly lookupResponse?: Response;
  readonly lookupError?: Error;
}) {
  return vi.fn(
    (
      request: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestUrl = resolveRequestUrl(request);

      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          input?.tokenResponse ??
            new Response(
              JSON.stringify({
                access_token: "gmail-access-token",
                expires_in: 3600,
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        );
      }

      if (
        requestUrl.startsWith(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        )
      ) {
        if (input?.lookupError !== undefined) {
          throw input.lookupError;
        }

        expect(init?.method).toBe("GET");

        return Promise.resolve(
          input?.lookupResponse ??
            new Response(
              JSON.stringify({
                messages: [{ threadId: "live-thread-123" }],
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        );
      }

      throw new Error(
        `Unexpected URL: ${requestUrl} with method ${init?.method ?? "GET"}`,
      );
    },
  );
}

const baseConfig = {
  liveAccount: "volunteers@adventurescientists.org",
  oauthClient: {
    clientId: "gmail-oauth-client-id",
    clientSecret: "gmail-oauth-client-secret",
    tokenUri: "https://oauth2.googleapis.com/token",
  },
  oauthRefreshToken: "gmail-oauth-refresh-token",
  fetchImplementation: fetch,
  timeoutMs: 15_000,
  now: () => new Date("2026-04-30T20:14:00.000Z"),
} as const;

describe("resolveLiveGmailThreadId", () => {
  it("resolves a thread id when Gmail returns a matching message", async () => {
    const fetchImplementation = createFetchMock();

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "resolved",
      threadId: "live-thread-123",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    const lookupCall = fetchImplementation.mock.calls[1];
    const requestUrl = new URL(resolveRequestUrl(lookupCall?.[0]));
    expect(requestUrl.searchParams.get("q")).toBe(
      "rfc822msgid:<parent-message@example.org>",
    );
    expect(requestUrl.searchParams.get("maxResults")).toBe("1");
    expect(requestUrl.searchParams.get("format")).toBe("minimal");
  });

  it("returns not_found when Gmail returns an empty messages array", async () => {
    const fetchImplementation = createFetchMock({
      lookupResponse: new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    });

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<missing-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "not_found",
    });
  });

  it("returns not_found when rfc822MessageId is null without calling Gmail", async () => {
    const fetchImplementation = createFetchMock();

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: null,
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "not_found",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("returns auth_error on HTTP 401", async () => {
    const fetchImplementation = createFetchMock({
      lookupResponse: new Response("Invalid Credentials", {
        status: 401,
      }),
    });

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "auth_error",
      detail: "Invalid Credentials",
    });
  });

  it("returns transient on HTTP 500", async () => {
    const fetchImplementation = createFetchMock({
      lookupResponse: new Response("Backend error", {
        status: 500,
      }),
    });

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "transient",
      detail: "Backend error",
    });
  });

  it("returns transient on network error", async () => {
    const fetchImplementation = createFetchMock({
      lookupError: new Error("socket hang up"),
    });

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "transient",
      detail: "Gmail thread lookup request failed.",
    });
  });

  it("returns transient on timeout", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    const fetchImplementation = createFetchMock({
      lookupError: timeoutError,
    });

    const result = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
      },
    });

    expect(result).toEqual({
      kind: "transient",
      detail: "Gmail thread lookup timed out.",
    });
  });

  it("reuses the access token cache when it is warm", async () => {
    const fetchImplementation = createFetchMock();
    const accessTokenCache = new Map<
      string,
      { readonly accessToken: string; readonly expiresAtEpochSeconds: number }
    >();

    const firstResult = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
        accessTokenCache,
      },
    });
    const secondResult = await resolveLiveGmailThreadId({
      rfc822MessageId: "<parent-message@example.org>",
      config: {
        ...baseConfig,
        fetchImplementation,
        accessTokenCache,
      },
    });

    expect(firstResult).toEqual({
      kind: "resolved",
      threadId: "live-thread-123",
    });
    expect(secondResult).toEqual({
      kind: "resolved",
      threadId: "live-thread-123",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(
      fetchImplementation.mock.calls.filter(
        ([request]) =>
          resolveRequestUrl(request) === "https://oauth2.googleapis.com/token",
      ),
    ).toHaveLength(1);
  });
});
