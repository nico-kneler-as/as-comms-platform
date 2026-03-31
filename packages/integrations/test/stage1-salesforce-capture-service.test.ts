import { describe, expect, it } from "vitest";

import {
  createSalesforceCapturePort,
  createSalesforceCaptureService,
  type CaptureServiceHttpRequest,
  type SalesforceApiClient,
  type SalesforceCaptureService
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

function createFetchFromService(
  service: SalesforceCaptureService
): typeof fetch {
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

function createFakeSalesforceApiClient(): SalesforceApiClient {
  return {
    queryAll(soql) {
      if (soql.includes(" FROM Contact ")) {
        return Promise.resolve([
          {
            Id: "003-stage1",
            Name: "Stage One Volunteer",
            Email: "volunteer@example.org",
            Phone: "+15555550123",
            Volunteer_ID_Plain__c: "VOL-123",
            CreatedDate: "2026-01-01T00:00:00.000Z",
            LastModifiedDate: "2026-01-05T00:00:00.000Z"
          }
        ]);
      }

      if (soql.includes(" FROM Expedition_Members__c ")) {
        return Promise.resolve([
          {
            Id: "a01-membership-1",
            Contact__c: "003-stage1",
            Project__c: "project-antarctica",
            Expedition__c: "expedition-antarctica",
            Role__c: "volunteer",
            Status__c: "active",
            CreatedDate: "2026-01-02T00:00:00.000Z",
            LastModifiedDate: "2026-01-05T00:01:00.000Z",
            Date_Training_Sent__c: "2026-01-03T00:00:00.000Z",
            Date_Training_Completed__c: "2026-01-04T00:00:00.000Z",
            Date_First_Sample_Collected__c: "2026-01-05T00:00:00.000Z"
          }
        ]);
      }

      if (soql.includes(" FROM Task ")) {
        return Promise.resolve([
          {
            Id: "00T-task-1",
            WhoId: "003-stage1",
            TaskSubtype: "Email",
            Subject: "Outbound follow-up",
            Description: "Logged outbound follow-up from Task",
            CreatedDate: "2026-01-05T00:02:00.000Z",
            LastModifiedDate: "2026-01-05T00:03:00.000Z"
          }
        ]);
      }

      return Promise.resolve([]);
    }
  };
}

describe("Salesforce capture service", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const service = createSalesforceCaptureService(
      {
        bearerToken: "salesforce-token",
        loginUrl: "https://test.salesforce.com",
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "worker@example.org",
        password: "password",
        securityToken: "security-token",
        contactCaptureMode: "cdc_compatible",
        membershipCaptureMode: "cdc_compatible"
      },
      {
        apiClient: createFakeSalesforceApiClient()
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

  it("rejects invalid payloads before querying Salesforce", async () => {
    let queryCount = 0;
    const service = createSalesforceCaptureService(
      {
        bearerToken: "salesforce-token",
        loginUrl: "https://test.salesforce.com",
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "worker@example.org",
        password: "password",
        securityToken: "security-token",
        contactCaptureMode: "cdc_compatible",
        membershipCaptureMode: "cdc_compatible"
      },
      {
        apiClient: {
          queryAll: () => {
            queryCount += 1;
            return Promise.resolve([]);
          }
        }
      }
    );

    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/live",
      headers: {
        authorization: "Bearer salesforce-token"
      },
      bodyText: JSON.stringify({
        version: 1,
        jobId: "job:salesforce:live:1",
        correlationId: "corr:salesforce:live:1",
        traceId: null,
        batchId: "batch:salesforce:live:1",
        syncStateId: "sync:salesforce:live:1",
        attempt: 1,
        maxAttempts: 3,
        provider: "salesforce",
        mode: "live",
        jobType: "live_ingest",
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
    expect(queryCount).toBe(0);
  });

  it("returns launch-scope Salesforce Contact, Expedition_Members__c, and Task records in the worker-facing provider-close shape", async () => {
    const service = createSalesforceCaptureService(
      {
        bearerToken: "salesforce-token",
        loginUrl: "https://test.salesforce.com",
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "worker@example.org",
        password: "password",
        securityToken: "security-token",
        contactCaptureMode: "cdc_compatible",
        membershipCaptureMode: "cdc_compatible"
      },
      {
        apiClient: createFakeSalesforceApiClient(),
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );
    const port = createSalesforceCapturePort(
      {
        baseUrl: "https://capture.example.test",
        bearerToken: "salesforce-token",
        timeoutMs: 1_000
      },
      {
        fetchImplementation: createFetchFromService(service)
      }
    );

    const result = await port.captureHistoricalBatch({
      version: 1,
      jobId: "job:salesforce:historical:1",
      correlationId: "corr:salesforce:historical:1",
      traceId: null,
      batchId: "batch:salesforce:historical:1",
      syncStateId: "sync:salesforce:historical:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-06T00:00:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "contact_snapshot",
          salesforceContactId: "003-stage1"
        }),
        expect.objectContaining({
          recordType: "task_communication",
          channel: "email",
          salesforceContactId: "003-stage1"
        }),
        expect.objectContaining({
          recordType: "lifecycle_milestone",
          milestone: "signed_up",
          sourceField: "Expedition_Members__c.CreatedDate"
        }),
        expect.objectContaining({
          recordType: "lifecycle_milestone",
          milestone: "received_training",
          sourceField: "Expedition_Members__c.Date_Training_Sent__c"
        }),
        expect.objectContaining({
          recordType: "lifecycle_milestone",
          milestone: "completed_training",
          sourceField: "Expedition_Members__c.Date_Training_Completed__c"
        }),
        expect.objectContaining({
          recordType: "lifecycle_milestone",
          milestone: "submitted_first_data",
          sourceField:
            "Expedition_Members__c.Date_First_Sample_Collected__c"
        })
      ])
    );
    expect(result.checkpoint).toBe("2026-01-05T00:03:00.000Z");
  });

  it("keeps live Salesforce capture CDC-compatible at the contract level while using the same provider-close batch shape", async () => {
    const service = createSalesforceCaptureService(
      {
        bearerToken: "salesforce-token",
        loginUrl: "https://test.salesforce.com",
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "worker@example.org",
        password: "password",
        securityToken: "security-token",
        contactCaptureMode: "cdc_compatible",
        membershipCaptureMode: "cdc_compatible"
      },
      {
        apiClient: createFakeSalesforceApiClient(),
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:salesforce:live:1",
      correlationId: "corr:salesforce:live:1",
      traceId: null,
      batchId: "batch:salesforce:live:1",
      syncStateId: "sync:salesforce:live:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-05T00:00:00.000Z",
      windowEnd: "2026-01-06T00:00:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "contact_snapshot",
          salesforceContactId: "003-stage1"
        }),
        expect.objectContaining({
          recordType: "task_communication",
          salesforceContactId: "003-stage1"
        })
      ])
    );
  });
});
