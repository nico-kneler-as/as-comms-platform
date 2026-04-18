import { describe, expect, it } from "vitest";

import {
  createGmailCaptureService,
  createGmailMailboxApiClient,
  gmailMessageRecordSchema
} from "../src/index.js";
import { sha256Json } from "../src/capture-services/shared.js";

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

describe("Gmail capture service", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () => Promise.resolve(null)
        }
      }
    );

    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/historical",
      headers: {},
      bodyText: JSON.stringify({
        version: 1
      })
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: "unauthorized"
    });
  });

  it("rejects invalid payloads before touching the provider client", async () => {
    let listCalls = 0;
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        apiClient: {
          listMessageIds: () => {
            listCalls += 1;
            return Promise.resolve([]);
          },
          getMessage: () => Promise.resolve(null)
        }
      }
    );

    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/historical",
      headers: {
        authorization: "Bearer gmail-token"
      },
      bodyText: JSON.stringify({
        version: 1,
        jobId: "job:gmail:historical:1",
        correlationId: "corr:gmail:historical:1",
        traceId: null,
        batchId: "batch:gmail:historical:1",
        syncStateId: "sync:gmail:historical:1",
        attempt: 1,
        maxAttempts: 3,
        provider: "gmail",
        mode: "historical",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: null,
        windowStart: null,
        windowEnd: null,
        recordIds: [],
        maxRecords: 25
      })
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: "invalid_request"
    });
    expect(listCalls).toBe(0);
  });

  it("fails closed for historical Gmail API capture and points operators to the .mbox import path", async () => {
    let listCalls = 0;
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: [
          "project-antarctica@example.org",
          "project-oceans@example.org"
        ],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        apiClient: {
          listMessageIds: () => {
            listCalls += 1;
            return Promise.resolve([]);
          },
          getMessage: () => Promise.resolve(null)
        },
        now: () => new Date("2026-01-03T00:05:00.000Z")
      }
    );
    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/historical",
      headers: {
        authorization: "Bearer gmail-token"
      },
      bodyText: JSON.stringify({
        version: 1,
        jobId: "job:gmail:historical:1",
        correlationId: "corr:gmail:historical:1",
        traceId: null,
        batchId: "batch:gmail:historical:1",
        syncStateId: "sync:gmail:historical:1",
        attempt: 1,
        maxAttempts: 3,
        provider: "gmail",
        mode: "historical",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: null,
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-04T00:00:00.000Z",
        recordIds: [],
        maxRecords: 25
      })
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: "invalid_request",
      message:
        "Launch-scope Gmail historical backfill now uses the worker .mbox import path, not the Gmail capture service."
    });
    expect(listCalls).toBe(0);
  });

  it("keeps live Gmail polling on volunteers@... while preserving alias context", async () => {
    const queriedMailboxes: string[] = [];
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: [
          "project-antarctica@example.org",
          "project-oceans@example.org"
        ],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        apiClient: {
          listMessageIds: ({ mailbox }) => {
            queriedMailboxes.push(mailbox);
            return Promise.resolve(["gmail-live-1"]);
          },
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-live-1",
              snippet: "Outbound follow-up from volunteers",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              headers: {
                Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                From:
                  "Project Oceans <project-oceans@example.org>",
                To: "Volunteer <volunteer@example.org>",
                Subject: "Checking in",
                "Message-ID": "<gmail-live-1@example.org>"
              }
            })
        },
        now: () => new Date("2026-01-05T00:01:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:gmail:live:1",
      correlationId: "corr:gmail:live:1",
      traceId: null,
      batchId: "batch:gmail:live:1",
      syncStateId: "sync:gmail:live:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "gmail",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-05T00:00:00.000Z",
      windowEnd: "2026-01-05T00:05:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(queriedMailboxes).toEqual(["volunteers@example.org"]);
    expect(result.records[0]).toMatchObject({
      recordType: "message",
      direction: "outbound",
      subject: "Checking in",
      bodyTextPreview: "Outbound follow-up from volunteers",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-oceans@example.org"
    });
  });

  it("keeps live Gmail checksum material backward-compatible when Subject is fetched", async () => {
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-oceans@example.org"],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        apiClient: {
          listMessageIds: () => Promise.resolve(["gmail-live-1"]),
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-live-1",
              snippet: "Outbound follow-up from volunteers",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              headers: {
                Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                From: "Project Oceans <project-oceans@example.org>",
                To: "Volunteer <volunteer@example.org>",
                Subject: "Checking in",
                "Message-ID": "<gmail-live-1@example.org>"
              }
            })
        },
        now: () => new Date("2026-01-05T00:01:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:gmail:live:compat",
      correlationId: "corr:gmail:live:compat",
      traceId: null,
      batchId: "batch:gmail:live:compat",
      syncStateId: "sync:gmail:live:compat",
      attempt: 1,
      maxAttempts: 3,
      provider: "gmail",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-05T00:00:00.000Z",
      windowEnd: "2026-01-05T00:05:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      recordType: "message",
      subject: "Checking in"
    });
    const record = gmailMessageRecordSchema.parse(result.records[0]);

    expect(record.checksum).toBe(
      sha256Json({
        id: "gmail-live-1",
        threadId: "thread-live-1",
        internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
        snippet: "Outbound follow-up from volunteers",
        headers: {
          Date: "Mon, 05 Jan 2026 00:00:00 +0000",
          From: "Project Oceans <project-oceans@example.org>",
          To: "Volunteer <volunteer@example.org>",
          "Message-ID": "<gmail-live-1@example.org>"
        }
      })
    );
  });

  it("uses OAuth refresh-token exchange before polling the live mailbox", async () => {
    const requests: {
      readonly url: string;
      readonly method: string;
      readonly headers: Headers;
      readonly bodyText: string;
    }[] = [];
    const client = createGmailMailboxApiClient(
      {
        bearerToken: "gmail-token",
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        oauthClientId: "gmail-oauth-client-id",
        oauthClientSecret: "gmail-oauth-client-secret",
        oauthRefreshToken: "gmail-oauth-refresh-token"
      },
      {
        fetchImplementation: (input, init) => {
          const url = resolveRequestUrl(input);
          const method = init?.method ?? "GET";
          const headers = new Headers(init?.headers);
          const bodyText =
            typeof init?.body === "string" ? init.body : "";

          requests.push({
            url,
            method,
            headers,
            bodyText
          });

          if (url === "https://oauth2.googleapis.com/token") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  access_token: "gmail-access-token",
                  expires_in: 3600
                }),
                {
                  status: 200,
                  headers: {
                    "content-type": "application/json"
                  }
                }
              )
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                messages: []
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              }
            )
          );
        }
      }
    );

    await client.listMessageIds({
      mailbox: "volunteers@example.org",
      query: "after:1 before:2 -in:chats"
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(requests[0]?.bodyText).toBe(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "gmail-oauth-client-id",
        client_secret: "gmail-oauth-client-secret",
        refresh_token: "gmail-oauth-refresh-token"
      }).toString()
    );
    expect(requests[1]?.headers.get("authorization")).toBe(
      "Bearer gmail-access-token"
    );
    expect(requests[1]?.url).toContain(
      "/gmail/v1/users/volunteers%40example.org/messages"
    );
  });
});
