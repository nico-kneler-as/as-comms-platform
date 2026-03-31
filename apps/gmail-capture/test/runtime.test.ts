import { describe, expect, it } from "vitest";

import { readGmailCaptureRuntimeConfig } from "../src/index.js";

describe("Gmail capture runtime config", () => {
  it("requires launch-scope Gmail env for service boot", () => {
    const config = readGmailCaptureRuntimeConfig({
      PORT: "3011",
      GMAIL_CAPTURE_TOKEN: "gmail-token",
      GMAIL_HISTORICAL_MAILBOXES:
        "project-antarctica@example.org,project-oceans@example.org",
      GMAIL_LIVE_ACCOUNT: "volunteers@example.org",
      GMAIL_PROJECT_INBOX_ALIASES:
        "project-antarctica@example.org,project-oceans@example.org",
      GMAIL_GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL:
        "capture-service@example.iam.gserviceaccount.com",
      GMAIL_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"
    });

    expect(config.port).toBe(3011);
    expect(config.service.liveAccount).toBe("volunteers@example.org");
    expect(config.service.historicalMailboxes).toEqual([
      "project-antarctica@example.org",
      "project-oceans@example.org"
    ]);
  });

  it("fails closed when required Gmail capture env is missing", () => {
    expect(() =>
      readGmailCaptureRuntimeConfig({
        PORT: "3011",
        GMAIL_CAPTURE_TOKEN: "gmail-token",
        GMAIL_HISTORICAL_MAILBOXES: "project-antarctica@example.org",
        GMAIL_PROJECT_INBOX_ALIASES: "project-antarctica@example.org",
        GMAIL_GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL:
          "capture-service@example.iam.gserviceaccount.com",
        GMAIL_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"
      })
    ).toThrow("GMAIL_LIVE_ACCOUNT is required.");
  });
});
