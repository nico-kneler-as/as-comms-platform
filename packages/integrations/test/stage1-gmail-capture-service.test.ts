import { describe, expect, it } from "vitest";

import {
  createGmailCapturePort,
  createGmailCaptureService,
  type CaptureServiceHttpRequest,
  type GmailCaptureService,
  type GmailMailboxApiClient
} from "../src/index.js";

function toResponse(input: {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}): Response {
  return new Response(input.body, {
    status: input.status,
    headers: input.headers
  });
}

function createFetchFromService(service: GmailCaptureService): typeof fetch {
  function resolveUrl(input: unknown): string {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    if (input instanceof Request) {
      return input.url;
    }

    if (
      typeof input === "object" &&
      input !== null &&
      "url" in input &&
      typeof input.url === "string"
    ) {
      return input.url;
    }

    throw new Error("Unsupported fetch input.");
  }

  return (input, init) => {
    const request: CaptureServiceHttpRequest = {
      method: init?.method ?? "GET",
      path: new URL(resolveUrl(input)).pathname,
      headers: new Headers(init?.headers),
      bodyText: typeof init?.body === "string" ? init.body : ""
    };

    return service.handleHttpRequest(request).then(toResponse);
  };
}

describe("Gmail capture service", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        historicalMailboxes: ["project-antarctica@example.org"],
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        serviceAccountClientEmail: "capture-service@example.iam.gserviceaccount.com",
        serviceAccountPrivateKey: "test-private-key"
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
        historicalMailboxes: ["project-antarctica@example.org"],
        liveAccount: "volunteers@example.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        serviceAccountClientEmail: "capture-service@example.iam.gserviceaccount.com",
        serviceAccountPrivateKey: "test-private-key"
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

  it("returns launch-scope historical Gmail records in the same provider-close shape the worker port expects", async () => {
    const queriedMailboxes: string[] = [];
    const fakeApiClient: GmailMailboxApiClient = {
      listMessageIds: ({ mailbox }) => {
        queriedMailboxes.push(mailbox);
        if (mailbox === "project-antarctica@example.org") {
          return Promise.resolve(["gmail-message-1"]);
        }

        return Promise.resolve([]);
      },
      getMessage: ({ mailbox, messageId }) =>
        Promise.resolve({
          id: messageId,
          threadId: "thread-1",
          snippet: "Volunteer reply from the field",
          internalDate: String(Date.parse("2026-01-03T00:00:00.000Z")),
          headers: {
            Date: "Fri, 03 Jan 2026 00:00:00 +0000",
            From: "Volunteer <volunteer@example.org>",
            To: `Project Antarctica <${mailbox}>`,
            "Message-ID": "<gmail-message-1@example.org>"
          }
        })
    };
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        historicalMailboxes: [
          "project-antarctica@example.org",
          "project-oceans@example.org"
        ],
        liveAccount: "volunteers@example.org",
        projectInboxAliases: [
          "project-antarctica@example.org",
          "project-oceans@example.org"
        ],
        serviceAccountClientEmail: "capture-service@example.iam.gserviceaccount.com",
        serviceAccountPrivateKey: "test-private-key"
      },
      {
        apiClient: fakeApiClient,
        now: () => new Date("2026-01-03T00:05:00.000Z")
      }
    );
    const port = createGmailCapturePort(
      {
        baseUrl: "https://capture.example.test",
        bearerToken: "gmail-token",
        timeoutMs: 1_000
      },
      {
        fetchImplementation: createFetchFromService(service)
      }
    );

    const result = await port.captureHistoricalBatch({
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
    });

    expect(queriedMailboxes).toEqual([
      "project-antarctica@example.org",
      "project-oceans@example.org"
    ]);
    expect(result.nextCursor).toBeNull();
    expect(result.checkpoint).toBe("2026-01-03T00:00:00.000Z");
    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "message",
        recordId: "gmail-message-1",
        direction: "inbound",
        capturedMailbox: "project-antarctica@example.org",
        projectInboxAlias: "project-antarctica@example.org",
        normalizedParticipantEmails: ["volunteer@example.org"],
        crossProviderCollapseKey: "rfc822:<gmail-message-1@example.org>"
      })
    ]);
  });

  it("keeps live Gmail polling on volunteers@... while preserving alias context", async () => {
    const queriedMailboxes: string[] = [];
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
        historicalMailboxes: ["project-antarctica@example.org"],
        liveAccount: "volunteers@example.org",
        projectInboxAliases: [
          "project-antarctica@example.org",
          "project-oceans@example.org"
        ],
        serviceAccountClientEmail: "capture-service@example.iam.gserviceaccount.com",
        serviceAccountPrivateKey: "test-private-key"
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
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-oceans@example.org"
    });
  });
});
