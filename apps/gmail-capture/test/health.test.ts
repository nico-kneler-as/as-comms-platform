import { describe, expect, it, vi } from "vitest";

import {
  handleGmailHealthRequest,
  readGmailCaptureRuntimeConfig
} from "../src/index.js";

function createConfig() {
  return readGmailCaptureRuntimeConfig({
    GMAIL_CAPTURE_TOKEN: "gmail-token",
    GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
    GMAIL_PROJECT_INBOX_ALIASES:
      "project-antarctica@example.org,project-oceans@example.org",
    GMAIL_GOOGLE_OAUTH_CLIENT_ID: "gmail-oauth-client-id",
    GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "gmail-oauth-client-secret",
    GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "gmail-oauth-refresh-token"
  });
}

describe("Gmail /health", () => {
  it("returns healthy when OAuth token exchange succeeds", async () => {
    const result = await handleGmailHealthRequest(createConfig(), {
      fetchImplementation: vi.fn(() =>
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      ) as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z"),
      version: "gmail-sha"
    });

    expect(result).toEqual({
      service: "gmail",
      status: "healthy",
      checkedAt: "2026-04-20T16:00:00.000Z",
      detail: null,
      version: "gmail-sha"
    });
  });

  it("returns disconnected when Google reports a revoked refresh token", async () => {
    const result = await handleGmailHealthRequest(createConfig(), {
      fetchImplementation: vi.fn(() =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked."
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      ) as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z")
    });

    expect(result).toMatchObject({
      service: "gmail",
      status: "disconnected",
      detail:
        "OAuth refresh token expired, was revoked, or lost required permissions."
    });
  });

  it("returns needs_attention when the token exchange request fails", async () => {
    const result = await handleGmailHealthRequest(createConfig(), {
      fetchImplementation: vi.fn(() => {
        throw new TypeError("network failure");
      }) as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z")
    });

    expect(result).toMatchObject({
      service: "gmail",
      status: "needs_attention",
      detail: "OAuth token exchange request failed."
    });
  });
});
