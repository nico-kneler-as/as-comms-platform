import { describe, expect, it } from "vitest";

import {
  createGmailCapturePort,
  createMailchimpCapturePort
} from "../src/index.js";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
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

describe("Stage 1 provider capture ports", () => {
  it("posts Gmail historical batch payloads to the configured capture endpoint", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const port = createGmailCapturePort(
      {
        baseUrl: "https://capture.example.test/gmail",
        bearerToken: "gmail-token",
        timeoutMs: 1_000
      },
      {
        fetchImplementation: (input, init) => {
          requestInit = init;
          requestUrl = resolveRequestUrl(input);

          return Promise.resolve(createJsonResponse({
            records: [
              {
                recordType: "message",
                recordId: "gmail-message-1",
                direction: "inbound",
                occurredAt: "2026-01-01T00:00:00.000Z",
                receivedAt: "2026-01-01T00:01:00.000Z",
                payloadRef: "capture://gmail/gmail-message-1",
                checksum: "checksum-1",
                snippet: "Hello from Gmail",
                normalizedParticipantEmails: ["volunteer@example.org"],
                salesforceContactId: "003-stage1",
                volunteerIdPlainValues: [],
                normalizedPhones: [],
                supportingRecords: [],
                crossProviderCollapseKey: "thread:1",
                threadId: "thread-1",
                rfc822MessageId: "<message-1@example.org>"
              }
            ],
            nextCursor: "gmail:cursor:1",
            checkpoint: "gmail:checkpoint:1"
          }));
        }
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
      windowEnd: "2026-01-01T01:00:00.000Z",
      recordIds: ["gmail-message-1"],
      maxRecords: 25
    });

    expect(requestUrl).toBe("https://capture.example.test/gmail/historical");
    expect(requestInit?.method).toBe("POST");
    expect(
      (requestInit?.headers as Record<string, string> | undefined)?.authorization
    ).toBe("Bearer gmail-token");
    expect(result.nextCursor).toBe("gmail:cursor:1");
    expect(result.records[0]?.recordType).toBe("message");
  });

  it("keeps transition-period Mailchimp capture responses in provider-close record shapes", async () => {
    const port = createMailchimpCapturePort(
      {
        baseUrl: "https://capture.example.test/mailchimp",
        bearerToken: "mailchimp-token",
        timeoutMs: 1_000
      },
      {
        fetchImplementation: () =>
          Promise.resolve(createJsonResponse({
            records: [
              {
                recordType: "campaign_member_activity",
                recordId: "campaign-activity-1",
                activityType: "clicked",
                occurredAt: "2026-01-03T00:00:00.000Z",
                receivedAt: "2026-01-03T00:01:00.000Z",
                payloadRef: "capture://mailchimp/campaign-activity-1",
                checksum: "checksum-1",
                normalizedEmail: "volunteer@example.org",
                salesforceContactId: "003-stage1",
                volunteerIdPlainValues: [],
                normalizedPhones: [],
                campaignId: "campaign-1",
                audienceId: "audience-1",
                memberId: "member-1",
                snippet: "Clicked the campaign CTA"
              },
              {
                recordType: "audience_mutation",
                recordId: "audience-1"
              }
            ],
            nextCursor: null,
            checkpoint: "mailchimp:checkpoint:1"
          }))
      }
    );

    const result = await port.captureTransitionBatch({
      version: 1,
      jobId: "job:mailchimp:transition:1",
      correlationId: "corr:mailchimp:transition:1",
      traceId: null,
      batchId: "batch:mailchimp:transition:1",
      syncStateId: "sync:mailchimp:transition:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "mailchimp",
      mode: "transition_live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-03T00:00:00.000Z",
      windowEnd: "2026-01-03T01:00:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(result.checkpoint).toBe("mailchimp:checkpoint:1");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.recordType).toBe("campaign_member_activity");
    expect(result.records[1]?.recordType).toBe("audience_mutation");
  });

  it("marks retryable HTTP failures explicitly for worker retry handling", async () => {
    const port = createGmailCapturePort(
      {
        baseUrl: "https://capture.example.test/gmail",
        bearerToken: "gmail-token",
        timeoutMs: 1_000
      },
      {
        fetchImplementation: () =>
          Promise.resolve(
            createJsonResponse(
            {
              error: "temporary_unavailable"
            },
            503
            )
          )
      }
    );

    await expect(
      port.captureLiveBatch({
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
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-01T01:00:00.000Z",
        recordIds: [],
        maxRecords: 25
      })
    ).rejects.toMatchObject({
      name: "ProviderCaptureHttpError",
      retryable: true,
      status: 503
    });
  });
});
