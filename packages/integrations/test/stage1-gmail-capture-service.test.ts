import { describe, expect, it } from "vitest";

import {
  createGmailCaptureService
} from "../src/index.js";

describe("Gmail capture service", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const service = createGmailCaptureService(
      {
        bearerToken: "gmail-token",
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
