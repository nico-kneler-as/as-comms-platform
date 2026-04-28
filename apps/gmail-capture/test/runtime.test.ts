import { describe, expect, it } from "vitest";

import { readGmailCaptureRuntimeConfig } from "../src/index.js";

describe("Gmail capture runtime config", () => {
  it("requires launch-scope Gmail env for service boot", () => {
    const config = readGmailCaptureRuntimeConfig({
      PORT: "3011",
      GMAIL_CAPTURE_TOKEN: "gmail-token",
      GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
      GMAIL_PROJECT_INBOX_ALIASES:
        "project-antarctica@example.org,project-oceans@example.org",
      GMAIL_GOOGLE_OAUTH_CLIENT_ID: "gmail-oauth-client-id",
      GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "gmail-oauth-client-secret",
      GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "gmail-oauth-refresh-token"
    });

    expect(config.port).toBe(3011);
    expect(config.service.liveAccount).toBe("volunteers@adventurescientists.org");
    expect(config.attachments.attachmentVolumePath).toBe("./tmp/attachments");
    expect(config.attachments.maxAttachmentBytesPerAttachment).toBe(52_428_800);
  });

  it("fails closed when required Gmail capture env is missing", () => {
    expect(() =>
      readGmailCaptureRuntimeConfig({
        PORT: "3011",
        GMAIL_CAPTURE_TOKEN: "gmail-token",
        GMAIL_PROJECT_INBOX_ALIASES: "project-antarctica@example.org",
        GMAIL_GOOGLE_OAUTH_CLIENT_ID: "gmail-oauth-client-id",
        GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "gmail-oauth-client-secret",
        GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "gmail-oauth-refresh-token"
      })
    ).toThrow("GMAIL_LIVE_ACCOUNT is required.");
  });

  it("fails closed when the live Gmail account is not volunteers@...", () => {
    expect(() =>
      readGmailCaptureRuntimeConfig({
        PORT: "3011",
        GMAIL_CAPTURE_TOKEN: "gmail-token",
        GMAIL_LIVE_ACCOUNT: "project-antarctica@example.org",
        GMAIL_PROJECT_INBOX_ALIASES: "project-antarctica@example.org",
        GMAIL_GOOGLE_OAUTH_CLIENT_ID: "gmail-oauth-client-id",
        GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "gmail-oauth-client-secret",
        GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "gmail-oauth-refresh-token"
      })
    ).toThrow("GMAIL_LIVE_ACCOUNT must be a volunteers@... address.");
  });
});
