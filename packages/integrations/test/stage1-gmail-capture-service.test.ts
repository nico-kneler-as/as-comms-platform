import { describe, expect, it, vi } from "vitest";

import {
  createGmailCaptureService,
  createGmailMailboxApiClient,
  type GmailMessageMetadata,
  gmailMessageRecordSchema
} from "../src/index.js";
import { sha256Json } from "../src/capture-services/shared.js";

interface LoggedUnhandledHttpError {
  readonly event: string;
  readonly method: string;
  readonly path: string;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
}

function buildFullMessagePayload(input: {
  readonly bodyText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly mimeType?: string;
  readonly transferEncoding?: "7bit" | "8bit" | "base64" | "quoted-printable";
}): GmailMessageMetadata["payload"] {
  return {
    mimeType: input.mimeType ?? "text/plain",
    filename: "",
    headers: [
      ...Object.entries(input.headers).map(([name, value]) => ({
        name,
        value
      })),
      {
        name: "Content-Type",
        value: `${input.mimeType ?? "text/plain"}; charset="UTF-8"`
      },
      {
        name: "Content-Transfer-Encoding",
        value: input.transferEncoding ?? "7bit"
      }
    ],
    body: {
      data: Buffer.from(input.bodyText, "utf8").toString("base64url")
    },
    parts: []
  };
}

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
    const observedQueries: string[] = [];
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
          listMessageIds: ({ mailbox, query }) => {
            queriedMailboxes.push(mailbox);
            if (query !== null) {
              observedQueries.push(query);
            }
            return Promise.resolve(["gmail-live-1"]);
          },
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-live-1",
              labelIds: ["SENT"],
              snippet: "Outbound follow-up from volunteers",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              payload: buildFullMessagePayload({
                bodyText:
                  "Checking in with the full body.\n\nCan you confirm your availability?",
                headers: {
                  Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                  From:
                    "Project Oceans <project-oceans@example.org>",
                  To: "Volunteer <volunteer@example.org>",
                  Subject: "Checking in",
                  "Message-ID": "<gmail-live-1@example.org>"
                }
              })
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
    expect(observedQueries).toEqual([
      "after:1767571200 before:1767571500 -in:chats -in:drafts -label:DRAFT"
    ]);
    expect(result.records[0]).toMatchObject({
      recordType: "message",
      direction: "outbound",
      subject: "Checking in",
      labelIds: ["SENT"],
      bodyTextPreview:
        "Checking in with the full body.\n\nCan you confirm your availability?",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-oceans@example.org"
    });
  });

  it("logs one-line structured error payloads for unhandled live capture failures", async () => {
    const syntheticFailure = new Error("synthetic failure");
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
          listMessageIds: () => Promise.resolve([]),
          getMessage: () => Promise.resolve(null)
        }
      }
    );

    const captureLiveBatchSpy = vi
      .spyOn(service, "captureLiveBatch")
      .mockRejectedValue(syntheticFailure);

    try {
      const response = await service.handleHttpRequest({
        method: "POST",
        path: "/live",
        headers: {
          authorization: "Bearer gmail-token"
        },
        bodyText: JSON.stringify({
          version: 1,
          jobId: "job:gmail:live:error",
          correlationId: "corr:gmail:live:error",
          traceId: null,
          batchId: "batch:gmail:live:error",
          syncStateId: "sync:gmail:live:error",
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
        })
      });

      expect(response.status).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        error: "internal_error"
      });
      expect(captureLiveBatchSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();

      const loggedPayload: LoggedUnhandledHttpError = JSON.parse(
        String(errorSpy.mock.calls[0]?.[0] ?? "")
      ) as LoggedUnhandledHttpError;
      expect(loggedPayload).toMatchObject({
        event: "gmail_capture.http.unhandled_error",
        method: "POST",
        path: "/live",
        errorName: syntheticFailure.name,
        errorMessage: syntheticFailure.message,
        errorStack: syntheticFailure.stack
      });
    } finally {
      captureLiveBatchSpy.mockRestore();
      errorSpy.mockRestore();
    }
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
              labelIds: ["SENT"],
              snippet: "Outbound follow-up from volunteers",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              payload: buildFullMessagePayload({
                bodyText: "Checking in with the full body.",
                headers: {
                  Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                  From: "Project Oceans <project-oceans@example.org>",
                  To: "Volunteer <volunteer@example.org>",
                  Subject: "Checking in",
                  "Message-ID": "<gmail-live-1@example.org>"
                }
              })
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

  it("captures live Gmail bodies longer than 2000 characters without truncating them", async () => {
    const longBody = `Hello Samantha,\n\n${"A".repeat(2_600)}`;
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
          listMessageIds: () => Promise.resolve(["gmail-live-long-1"]),
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-live-long-1",
              labelIds: ["INBOX"],
              snippet: "Long inbound field update",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              payload: buildFullMessagePayload({
                bodyText: longBody,
                headers: {
                  Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                  From: "Volunteer <volunteer@example.org>",
                  To: "Project Oceans <project-oceans@example.org>",
                  Subject: "Long field update",
                  "Message-ID": "<gmail-live-long-1@example.org>"
                }
              })
            })
        },
        now: () => new Date("2026-01-05T00:01:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:gmail:live:long-body",
      correlationId: "corr:gmail:live:long-body",
      traceId: null,
      batchId: "batch:gmail:live:long-body",
      syncStateId: "sync:gmail:live:long-body",
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

    expect(result.records[0]).toMatchObject({
      recordType: "message",
      direction: "inbound",
      subject: "Long field update",
      bodyTextPreview: longBody
    });
    const record = gmailMessageRecordSchema.parse(result.records[0]);

    expect(record.bodyTextPreview).toHaveLength(longBody.length);
  });

  it("threads captured Drive anchors into the Gmail record", async () => {
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
          listMessageIds: () => Promise.resolve(["gmail-drive-anchor-1"]),
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-drive-anchor-1",
              labelIds: ["INBOX"],
              snippet: "Drive file shared",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              payload: {
                mimeType: "multipart/alternative",
                headers: [
                  { name: "From", value: "Volunteer <volunteer@example.org>" },
                  {
                    name: "To",
                    value: "Project Oceans <project-oceans@example.org>"
                  },
                  { name: "Subject", value: "Shared files" },
                  {
                    name: "Message-ID",
                    value: "<gmail-drive-anchor-1@example.org>"
                  },
                  { name: "Date", value: "Mon, 05 Jan 2026 00:00:00 +0000" },
                ],
                parts: [
                  {
                    mimeType: "text/html",
                    headers: [
                      {
                        name: "Content-Type",
                        value: 'text/html; charset="UTF-8"'
                      },
                    ],
                    body: {
                      data: Buffer.from(
                        '<a href="https://drive.google.com/file/d/abc123/view?usp=drive_link">IMG_2634.jpeg</a>',
                        "utf8",
                      ).toString("base64url"),
                    },
                  },
                ],
              },
            })
        },
        now: () => new Date("2026-01-05T00:01:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:gmail:live:drive-anchor",
      correlationId: "corr:gmail:live:drive-anchor",
      traceId: null,
      batchId: "batch:gmail:live:drive-anchor",
      syncStateId: "sync:gmail:live:drive-anchor",
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

    const record = gmailMessageRecordSchema.parse(result.records[0]);
    expect(record.driveAttachmentMetadata).toEqual([
      {
        driveFileId: "abc123",
        driveUrl:
          "https://drive.google.com/file/d/abc123/view?usp=drive_link",
        filename: "IMG_2634.jpeg",
      },
    ]);
  });

  it("captures spam-labeled inbound Gmail messages and preserves the SPAM label", async () => {
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
          listMessageIds: () => Promise.resolve(["gmail-spam-1"]),
          getMessage: ({ messageId }) =>
            Promise.resolve({
              id: messageId,
              threadId: "thread-spam-1",
              labelIds: ["INBOX", "SPAM"],
              snippet: "Question from a volunteer that Gmail marked as spam.",
              internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
              payload: buildFullMessagePayload({
                bodyText:
                  "Can my friends join me on this hex if they have accounts too?",
                headers: {
                  Date: "Mon, 05 Jan 2026 00:00:00 +0000",
                  From: "Volunteer <volunteer@example.org>",
                  To: "Project Oceans <project-oceans@example.org>",
                  Subject: "Adding others to a Hex",
                  "Message-ID": "<gmail-spam-1@example.org>"
                }
              })
            })
        },
        now: () => new Date("2026-01-05T00:01:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:gmail:live:spam",
      correlationId: "corr:gmail:live:spam",
      traceId: null,
      batchId: "batch:gmail:live:spam",
      syncStateId: "sync:gmail:live:spam",
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
      direction: "inbound",
      subject: "Adding others to a Hex",
      labelIds: ["INBOX", "SPAM"],
    });
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
    expect(new URL(requests[1]?.url ?? "").searchParams.get("includeSpamTrash"))
      .toBe("true");
  });

  it("accepts Gmail API message parts with empty body data", async () => {
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
        fetchImplementation: (input) => {
          const url = resolveRequestUrl(input);

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
                id: "gmail-empty-part-1",
                threadId: "thread-empty-part-1",
                labelIds: ["INBOX"],
                snippet: "Kirsten claimed Hex 11142.",
                internalDate: String(Date.parse("2026-05-07T02:26:39.000Z")),
                payload: {
                  mimeType: "multipart/alternative",
                  filename: "",
                  headers: [
                    {
                      name: "Date",
                      value: "Thu, 7 May 2026 02:26:39 +0000"
                    },
                    {
                      name: "From",
                      value: "Admin <admin@adventurescientists.org>"
                    },
                    {
                      name: "To",
                      value: "PNW <project-antarctica@example.org>"
                    },
                    {
                      name: "Subject",
                      value: "Hex Claimed - Required Further Coordination"
                    }
                  ],
                  body: {
                    size: 0
                  },
                  parts: [
                    {
                      mimeType: "text/plain",
                      filename: "",
                      headers: [],
                      body: {
                        data: "",
                        size: 0
                      }
                    }
                  ]
                }
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

    await expect(
      client.getMessage({
        mailbox: "volunteers@example.org",
        messageId: "gmail-empty-part-1"
      })
    ).resolves.toMatchObject({
      id: "gmail-empty-part-1",
      payload: {
        parts: [
          {
            body: {
              data: ""
            }
          }
        ]
      }
    });
  });
});
