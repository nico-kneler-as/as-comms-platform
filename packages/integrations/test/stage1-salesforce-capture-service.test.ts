import { describe, expect, it, vi } from "vitest";

import {
  createSalesforceApiClient,
  createSalesforceCapturePort,
  createSalesforceCaptureService,
  type CaptureServiceHttpRequest,
  type SalesforceApiClient,
  type SalesforceCaptureService
} from "../src/index.js";

const testJwtPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZiGf3MNY60bp4
CO6yPUNMCQn6hJ8nwy6wdP9S0ydG2Yk5jkElTUN+92jE/6YhbI6/N4Qq1nQu3mmf
79hWzhIGg8nmET4zEesXk3pM0fJ0PmvxJ1lYj8bt6YYe2jgtPwoL81bm4kGfhMlO
zyuiPEyfx1VnHzjfwArRrzVcv0MuvB7+yE7x5Mm0Br5z0fM6lkL+HghwuZl7z/aq
jG9G5yEeDSYjTQri/UH6SEdb3EkIspFaHZWK2Oal6nzP0zvtH0BY4vDlL7eQn0h2
eWQf2b3JSLc2Qsnl7jM/QKkpbZh/KD72x2f8JwvaP3nVvLod4j1d0wjSDV4olpry
t03r94c7AgMBAAECggEABc9h+PFd1k9vB+3d1WvABd0SycSNm7jtOZ8FCm0s95fb
o+ZezLOlc8N5sUmnLhxnZNVhoN+rvCLmQm7uVNHb7s+F8Jj0WwMt8p0kbH2wW3o2
L15LNYhG0rf9o2fNT1AFp+JIkE+P6rMFQvK2UjIdjGQ7F0F3fG7fr+3Qw7qgN2uu
S7hL4U3VskJVNjm9I7Vv3T6gA8EMwEtfiCwlDV+eq3T9ZLMAglMR6IY2QqjTuY2V
LP0JQ18cYyJGm1wbJ9Hly6FW54bIMaIJ+V4NXj+HA0SxMUDfW1VnY6wNgomq7zQz
R6KyrVsfE81GHw/0bKSVV2Sg5tL2n1X2UywoGTeAwQKBgQDyyDHK4Jx5jo+uK4xV
BpjFQonbkWfnY5ow5zA0dGLwB1x80vKR5pE6DOsK2BUp2lN0M0jEnA9f1yxHyNwY
HErG5oD+YtWQHn2tpO8B7vbB2el5LO7e8d3KY0pn7B5zqSgqNyoPR6jAKr5a9o5s
u5B9mBdlRtnzv77V4th8nYwBhQKBgQDlOq1A2p7Vn/Xs6mWTfrPK9lHoU5m+NLCc
SQPRQGA2Wtr6L4Hq4sWBd/8+HTRkY/1JHk9mOVoz3v4uCaE0M3PjFzSiWNuS+1mX
HOX0zu2fp2wjoUCUcCsQ4qyQqLuIQRu2A2MZd0pi/8n0pwzx36HOY6eNBl5z99LI
TQqdn3zEFwKBgQDBfDUt7eUhGbv1yyjMjTAyrip8iFi5xNx/NNBz21se3GfwlI88
I1x6BsF3wS0AU5mB82EhktI3UBJ0K2lJdnVy40kG9ye0HVfQx+iVG9GZxYhRAh8+
I1PgHdfSDV+vJ3zx6GjYhTtVE4q8t5NvLta9Y/QaPzYDZExQx0hr3PNo7QKBgQCt
9is8VIf9PqAJAGYGU5+8JY4yQXw+FVf8lAQa0P7BXJf38If2Y9ef5mJ2kdlF3Bj8
YrNWf7UNBw+7x4g0+yB8qKs9WQ8j3HTYOCl6B0a7rP1e5wAeFDQis7GeD/NLkP6x
5q6+7PtR+FctKoBfHq2LJt7FDVSmNPmBrZi5PoE5tQKBgAqJxX3iX1/2nnmQpNkH
gSDc4Jm9W0fH9FhPj6m8wV6kIxvOBObWnW1wunL7YQ1DLwdhFNnX+4ZaFQLiXPKC
mz8ZbGCj2DhKD1mBnWkQdbLHF+Q5/AR9gNiVHLClEeN9wE85KqaLSMycEkUS0t89
WlsbLfFo7L5Fv1zFpM+8zDyg
-----END PRIVATE KEY-----`;

function createSalesforceServiceConfig() {
  return {
    bearerToken: "salesforce-token",
    loginUrl: "https://test.salesforce.com",
    clientId: "client-id",
    username: "worker@example.org",
    jwtPrivateKey: testJwtPrivateKey,
    contactCaptureMode: "cdc_compatible" as const,
    membershipCaptureMode: "cdc_compatible" as const
  };
}

function getRequestBodyAsString(body: unknown): string {
  return typeof body === "string" ? body : "";
}

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
  const contactRow = {
    Id: "003-stage1",
    Name: "Stage One Volunteer",
    Email: "volunteer@example.org",
    Phone: "+15555550123",
    Volunteer_ID_Plain__c: "VOL-123",
    CreatedDate: "2026-01-01T00:00:00.000Z",
    LastModifiedDate: "2026-01-05T00:00:00.000Z"
  };
  const membershipRow = {
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
  };
  const taskRow = {
    Id: "00T-task-1",
    WhoId: "003-stage1",
    TaskSubtype: "Email",
    Subject: "Outbound follow-up",
    Description: "Logged outbound follow-up from Task",
    CreatedDate: "2026-01-05T00:02:00.000Z",
    LastModifiedDate: "2026-01-05T00:03:00.000Z"
  };

  return {
    queryAll(soql) {
      if (soql.includes(" FROM Contact ")) {
        if (soql.includes(" WHERE Id IN ")) {
          return Promise.resolve(
            soql.includes("'003-stage1'") ? [contactRow] : []
          );
        }

        return Promise.resolve([contactRow]);
      }

      if (soql.includes(" FROM Expedition_Members__c ")) {
        if (soql.includes(" WHERE Id IN ")) {
          return Promise.resolve(
            soql.includes("'a01-membership-1'") ? [membershipRow] : []
          );
        }

        if (soql.includes(" WHERE Contact__c IN ")) {
          return Promise.resolve(
            soql.includes("'003-stage1'") ? [membershipRow] : []
          );
        }

        return Promise.resolve([membershipRow]);
      }

      if (soql.includes(" FROM Task ")) {
        if (soql.includes(" WHERE Id IN ")) {
          return Promise.resolve(soql.includes("'00T-task-1'") ? [taskRow] : []);
        }

        if (soql.includes(" WHERE WhoId IN ")) {
          return Promise.resolve(soql.includes("'003-stage1'") ? [taskRow] : []);
        }

        return Promise.resolve([taskRow]);
      }

      return Promise.resolve([]);
    }
  };
}

function extractQuotedIds(soql: string): string[] {
  return Array.from(soql.matchAll(/'([^']+)'/g), (match) => match[1] ?? "");
}

describe("Salesforce capture service", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
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
      createSalesforceServiceConfig(),
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
    const queries: string[] = [];
    const baseApiClient = createFakeSalesforceApiClient();
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            queries.push(soql);
            return baseApiClient.queryAll(soql);
          }
        },
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
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "FROM Expedition_Members__c WHERE Contact__c != null AND ((CreatedDate >= 2026-01-01T00:00:00.000Z AND CreatedDate < 2026-01-06T00:00:00.000Z)"
        ),
        expect.stringContaining(
          "Date_Training_Sent__c >= 2026-01-01 AND Date_Training_Sent__c < 2026-01-06"
        ),
        expect.stringContaining(
          "Date_Training_Completed__c >= 2026-01-01 AND Date_Training_Completed__c < 2026-01-06"
        ),
        expect.stringContaining(
          "Date_First_Sample_Collected__c >= 2026-01-01 AND Date_First_Sample_Collected__c < 2026-01-06"
        ),
        expect.stringContaining(
          "FROM Task WHERE Who.Type = 'Contact' AND CreatedDate >= 2026-01-01T00:00:00.000Z AND CreatedDate < 2026-01-06T00:00:00.000Z"
        )
      ])
    );
    expect(
      queries.some((query) => query.includes("WhoId LIKE '003%'"))
    ).toBe(false);
  });

  it("expands task communications for membership-scoped historical backfills", async () => {
    const queries: string[] = [];
    const baseApiClient = createFakeSalesforceApiClient();
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            queries.push(soql);
            return baseApiClient.queryAll(soql);
          }
        },
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:salesforce:historical:membership-scope",
      correlationId: "corr:salesforce:historical:membership-scope",
      traceId: null,
      batchId: "batch:salesforce:historical:membership-scope",
      syncStateId: "sync:salesforce:historical:membership-scope",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: null,
      windowEnd: null,
      recordIds: ["a01-membership-1"],
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
          recordId: "00T-task-1",
          salesforceContactId: "003-stage1"
        })
      ])
    );
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FROM Task WHERE WhoId IN ('003-stage1')")
      ])
    );
  });

  it("uses contact-safe task filters for live window capture batches", async () => {
    const queries: string[] = [];
    const baseApiClient = createFakeSalesforceApiClient();
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            queries.push(soql);
            return baseApiClient.queryAll(soql);
          }
        },
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    await service.captureLiveBatch({
      version: 1,
      jobId: "job:salesforce:live:window-scope",
      correlationId: "corr:salesforce:live:window-scope",
      traceId: null,
      batchId: "batch:salesforce:live:window-scope",
      syncStateId: "sync:salesforce:live:window-scope",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-06T00:00:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "FROM Task WHERE Who.Type = 'Contact' AND LastModifiedDate >= 2026-01-01T00:00:00.000Z AND LastModifiedDate < 2026-01-06T00:00:00.000Z"
        )
      ])
    );
    expect(
      queries.some((query) => query.includes("WhoId LIKE '003%'"))
    ).toBe(false);
  });

  it("keeps date-only lifecycle milestones on live captures keyed by LastModifiedDate", async () => {
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: createFakeSalesforceApiClient(),
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:salesforce:live:lifecycle-window",
      correlationId: "corr:salesforce:live:lifecycle-window",
      traceId: null,
      batchId: "batch:salesforce:live:lifecycle-window",
      syncStateId: "sync:salesforce:live:lifecycle-window",
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
          recordType: "lifecycle_milestone",
          recordId: "a01-membership-1:Expedition_Members__c.Date_Training_Sent__c",
          milestone: "received_training",
          occurredAt: "2026-01-03T00:00:00.000Z"
        })
      ])
    );
  });

  it("supports membership-scoped replays when the org does not expose a role field", async () => {
    const queries: string[] = [];
    const baseApiClient = createFakeSalesforceApiClient();
    const service = createSalesforceCaptureService(
      {
        ...createSalesforceServiceConfig(),
        membershipRoleField: null
      },
      {
        apiClient: {
          queryAll: (soql) => {
            queries.push(soql);
            return baseApiClient.queryAll(soql);
          }
        },
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:salesforce:live:no-role-field",
      correlationId: "corr:salesforce:live:no-role-field",
      traceId: null,
      batchId: "batch:salesforce:live:no-role-field",
      syncStateId: "sync:salesforce:live:no-role-field",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: null,
      windowEnd: null,
      recordIds: ["a01-membership-1"],
      maxRecords: 25
    });

    expect(queries.some((query) => query.includes("Role__c"))).toBe(false);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "contact_snapshot",
          salesforceContactId: "003-stage1",
          memberships: [
            expect.objectContaining({
              projectId: "project-antarctica",
              expeditionId: "expedition-antarctica",
              role: null,
              status: "active"
            })
          ]
        }),
        expect.objectContaining({
          recordType: "lifecycle_milestone",
          salesforceContactId: "003-stage1",
          routing:
            expect.objectContaining({
              projectId: "project-antarctica",
              expeditionId: "expedition-antarctica"
            }) as unknown
        })
      ])
    );
  });

  it("maps expedition-linked auto email tasks to task_communication with routing context", async () => {
    const contactRow = {
      Id: "003-auto",
      Name: "Auto Email Volunteer",
      Email: "auto@example.org",
      Phone: "+15555550124",
      Volunteer_ID_Plain__c: "VOL-124",
      CreatedDate: "2026-01-01T00:00:00.000Z",
      LastModifiedDate: "2026-01-05T00:00:00.000Z"
    };
    const membershipRow = {
      Id: "a01-membership-auto",
      Contact__c: "003-auto",
      Project__c: "project-auto",
      Project__r: { Name: "Project Auto" },
      Expedition__c: "expedition-auto",
      Expedition__r: { Name: "Expedition Auto" },
      Status__c: "trip_planning",
      CreatedDate: "2026-01-02T00:00:00.000Z",
      LastModifiedDate: "2026-01-05T00:01:00.000Z"
    };
    const autoEmailTaskRow = {
      Id: "00T-auto-email",
      WhoId: "003-auto",
      WhatId: "a01-membership-auto",
      TaskSubtype: "Task",
      Subject: "→ Email: Start your training",
      Description: "Auto-sent training reminder",
      CreatedDate: "2026-01-05T00:02:00.000Z",
      LastModifiedDate: "2026-01-05T00:03:00.000Z"
    };
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            if (soql.includes(" FROM Contact ")) {
              if (soql.includes(" WHERE Id IN ")) {
                return Promise.resolve(
                  soql.includes("'003-auto'") ? [contactRow] : []
                );
              }

              return Promise.resolve([contactRow]);
            }

            if (soql.includes(" FROM Expedition_Members__c ")) {
              if (soql.includes(" WHERE Id IN ")) {
                return Promise.resolve(
                  soql.includes("'a01-membership-auto'") ? [membershipRow] : []
                );
              }

              if (soql.includes(" WHERE Contact__c IN ")) {
                return Promise.resolve(
                  soql.includes("'003-auto'") ? [membershipRow] : []
                );
              }

              return Promise.resolve([membershipRow]);
            }

            if (soql.includes(" FROM Task ")) {
              if (soql.includes(" WHERE Id IN ")) {
                return Promise.resolve(
                  soql.includes("'a01-membership-auto'") ? [] : []
                );
              }

              if (soql.includes(" WHERE WhoId IN ")) {
                return Promise.resolve(
                  soql.includes("'003-auto'") ? [autoEmailTaskRow] : []
                );
              }

              return Promise.resolve([autoEmailTaskRow]);
            }

            return Promise.resolve([]);
          }
        },
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureLiveBatch({
      version: 1,
      jobId: "job:salesforce:live:auto-email",
      correlationId: "corr:salesforce:live:auto-email",
      traceId: null,
      batchId: "batch:salesforce:live:auto-email",
      syncStateId: "sync:salesforce:live:auto-email",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: null,
      windowEnd: null,
      recordIds: ["a01-membership-auto"],
      maxRecords: 25
    });

    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "task_communication",
          recordId: "00T-auto-email",
          channel: "email",
          salesforceContactId: "003-auto",
          routing: {
            required: true,
            projectId: "project-auto",
            expeditionId: "expedition-auto",
            projectName: "Project Auto",
            expeditionName: "Expedition Auto"
          }
        })
      ])
    );
    expect(
      result.records.filter(
        (record) =>
          record.recordType === "task_unmapped_channel" &&
          record.recordId === "00T-auto-email"
      )
    ).toEqual([]);
  });

  it("expands task communications for membership-scoped historical backfills", async () => {
    const queries: string[] = [];
    const baseApiClient = createFakeSalesforceApiClient();
    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            queries.push(soql);
            return baseApiClient.queryAll(soql);
          }
        },
        now: () => new Date("2026-01-05T00:05:00.000Z")
      }
    );

    const result = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:salesforce:historical:membership-scope",
      correlationId: "corr:salesforce:historical:membership-scope",
      traceId: null,
      batchId: "batch:salesforce:historical:membership-scope",
      syncStateId: "sync:salesforce:historical:membership-scope",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: null,
      windowEnd: null,
      recordIds: ["a01-membership-1"],
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
          recordId: "00T-task-1",
          salesforceContactId: "003-stage1"
        })
      ])
    );
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FROM Task WHERE WhoId IN ('003-stage1')")
      ])
    );
  });

  it("keeps live Salesforce capture CDC-compatible at the contract level while using the same provider-close batch shape", async () => {
    const service = createSalesforceCaptureService(
      {
        ...createSalesforceServiceConfig(),
        timeoutMs: 1_000
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

  it("chunks large contact and membership fan-out queries during historical backfills", async () => {
    const touchedContactCount = 450;
    const contactChunkSizes: number[] = [];
    const membershipChunkSizes: number[] = [];
    const touchedContactIds = Array.from({ length: touchedContactCount }, (_, index) =>
      `003-stage1-${String(index).padStart(4, "0")}`
    );
    const contactRows = touchedContactIds.map((contactId, index) => ({
      Id: contactId,
      Name: `Volunteer ${String(index).padStart(4, "0")}`,
      Email: `volunteer-${String(index).padStart(4, "0")}@example.org`,
      Phone: `+1555000${String(index).padStart(4, "0")}`,
      Volunteer_ID_Plain__c: `VOL-${String(index).padStart(4, "0")}`,
      CreatedDate: "2026-01-01T00:00:00.000Z",
      LastModifiedDate: "2026-01-15T12:00:00.000Z"
    }));
    const membershipRows = touchedContactIds.map((contactId, index) => ({
      Id: `a01-membership-${String(index).padStart(4, "0")}`,
      Contact__c: contactId,
      Project__c: `project-${String(index).padStart(4, "0")}`,
      Project__r: {
        Name: `Project ${String(index).padStart(4, "0")}`
      },
      Expedition__c: `expedition-${String(index).padStart(4, "0")}`,
      Expedition__r: {
        Name: `Expedition ${String(index).padStart(4, "0")}`
      },
      Status__c: "active",
      CreatedDate: "2026-01-10T00:00:00.000Z",
      LastModifiedDate: "2026-01-15T12:00:00.000Z",
      Date_Training_Sent__c: null,
      Date_Training_Completed__c: null,
      Date_First_Sample_Collected__c: null
    }));

    const service = createSalesforceCaptureService(
      createSalesforceServiceConfig(),
      {
        apiClient: {
          queryAll: (soql) => {
            if (
              soql.includes("FROM Expedition_Members__c WHERE Contact__c != null AND ((")
            ) {
              return Promise.resolve(membershipRows);
            }

            if (soql.includes("FROM Task ")) {
              return Promise.resolve([]);
            }

            if (
              soql.includes("FROM Contact WHERE LastModifiedDate >=") &&
              !soql.includes(" WHERE Id IN ")
            ) {
              return Promise.resolve([]);
            }

            if (soql.includes("FROM Contact WHERE Id IN ")) {
              const ids = extractQuotedIds(soql);
              contactChunkSizes.push(ids.length);
              return Promise.resolve(
                contactRows.filter((row) => ids.includes(row.Id))
              );
            }

            if (soql.includes("FROM Expedition_Members__c WHERE Contact__c IN ")) {
              const ids = extractQuotedIds(soql);
              membershipChunkSizes.push(ids.length);
              return Promise.resolve(
                membershipRows.filter((row) => ids.includes(row.Contact__c))
              );
            }

            return Promise.resolve([]);
          }
        },
        now: () => new Date("2026-01-20T00:00:00.000Z")
      }
    );

    const result = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:salesforce:historical:chunked-fanout",
      correlationId: "corr:salesforce:historical:chunked-fanout",
      traceId: null,
      batchId: "batch:salesforce:historical:chunked-fanout",
      syncStateId: "sync:salesforce:historical:chunked-fanout",
      attempt: 1,
      maxAttempts: 3,
      provider: "salesforce",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-02-01T00:00:00.000Z",
      recordIds: [],
      maxRecords: 25
    });

    expect(contactChunkSizes).toEqual([200, 200, 50]);
    expect(membershipChunkSizes).toEqual([200, 200, 50]);
    expect(result.records).toHaveLength(25);
    expect(result.records[0]).toMatchObject({
      recordType: "lifecycle_milestone",
      sourceField: "Expedition_Members__c.CreatedDate",
      salesforceContactId: "003-stage1-0000"
    });
    expect(result.nextCursor).not.toBeNull();
  });

  it("uses the JWT bearer grant for Salesforce token exchange without password credentials", async () => {
    const fixedNow = new Date("2026-04-01T12:00:00.000Z");
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();

      if (url === "https://login.example.test/services/oauth2/token") {
        return Promise.resolve(
          new Response(
          JSON.stringify({
            access_token: "token-123",
            instance_url: "https://instance.example.test"
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
          records: [],
          done: true
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
        )
      );
    });

    const client = createSalesforceApiClient(
      {
        ...createSalesforceServiceConfig(),
        loginUrl: "https://login.example.test/custom/path",
        jwtExpirationSeconds: 180
      },
      {
        fetchImplementation,
        now: () => fixedNow
      }
    );

    await client.queryAll("SELECT Id FROM Contact");

    const tokenCall = fetchImplementation.mock.calls[0];
    const tokenBody = getRequestBodyAsString(tokenCall?.[1]?.body);
    const params = new URLSearchParams(tokenBody);
    const assertion = params.get("assertion");

    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    );
    expect(assertion).toEqual(expect.any(String));
    expect(params.has("client_secret")).toBe(false);
    expect(params.has("password")).toBe(false);
    expect(params.has("username")).toBe(false);

    const assertionPayload = JSON.parse(
      Buffer.from(assertion?.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as Record<string, unknown>;
    const expectedExp = Math.floor(fixedNow.getTime() / 1000) + 180;

    expect(assertionPayload).toMatchObject({
      iss: "client-id",
      sub: "worker@example.org",
      aud: "https://login.example.test",
      exp: expectedExp
    });
  });

  it("includes the Salesforce response body in token exchange errors when available", async () => {
    const client = createSalesforceApiClient(createSalesforceServiceConfig(), {
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "user hasn't approved this consumer"
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json"
            }
          }
        )
        )
    });

    await expect(client.queryAll("SELECT Id FROM Contact")).rejects.toThrow(
      "invalid_grant"
    );
  });
});
