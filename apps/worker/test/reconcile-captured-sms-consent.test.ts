import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import {
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema
} from "@as-comms/contracts";
import type { ConsentRecord } from "@as-comms/domain";
import { createSalesforceCaptureService } from "@as-comms/integrations";

import { createCapturedSmsConsentReconciler } from "../src/orchestration/reconcile-captured-sms-consent.js";
import {
  buildCapturedBatch,
  createEmptyCapturePorts,
  createTestWorkerContext,
  type TestWorkerContext
} from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";
const fixedNow = new Date("2026-07-05T12:00:00.000Z");

async function seedContact(context: TestWorkerContext): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId,
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${contactId}:salesforce`,
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships: [
      {
        id: `membership:${contactId}:project-stage1`,
        contactId,
        salesforceMembershipId: `membership:${contactId}:project-stage1:sf`,
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
}

function buildSalesforceLivePayload(syncStateId: string) {
  return salesforceLiveCaptureBatchPayloadSchema.parse({
    version: 1,
    jobId: `job:${syncStateId}`,
    correlationId: `corr:${syncStateId}`,
    traceId: null,
    batchId: `batch:${syncStateId}`,
    syncStateId,
    attempt: 1,
    maxAttempts: 3,
    provider: "salesforce",
    mode: "live",
    jobType: "live_ingest",
    cursor: "salesforce:cursor:live",
    checkpoint: "salesforce:checkpoint:live",
    windowStart: "2026-07-05T11:55:00.000Z",
    windowEnd: "2026-07-05T12:00:00.000Z",
    recordIds: [],
    maxRecords: 100
  });
}

function buildSalesforceHistoricalPayload(
  syncStateId: string,
  recordIds: readonly string[]
) {
  return salesforceHistoricalCaptureBatchPayloadSchema.parse({
    version: 1,
    jobId: `job:${syncStateId}`,
    correlationId: `corr:${syncStateId}`,
    traceId: null,
    batchId: `batch:${syncStateId}`,
    syncStateId,
    attempt: 1,
    maxAttempts: 3,
    provider: "salesforce",
    mode: "historical",
    jobType: "historical_backfill",
    cursor: null,
    checkpoint: null,
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-06T00:00:00.000Z",
    recordIds: [...recordIds],
    maxRecords: 100
  });
}

function buildContactSnapshotRecord(input?: {
  readonly salesforceContactId?: string;
  readonly displayName?: string;
  readonly primaryPhone?: string | null;
  readonly normalizedPhones?: string[];
  readonly memberships?: {
    readonly salesforceId: string | null;
    readonly projectId: string | null;
    readonly projectName: string | null;
    readonly expeditionId: string | null;
    readonly expeditionName: string | null;
    readonly textOptIn: boolean | null;
    readonly role: string | null;
    readonly status: string | null;
  }[];
}) {
  const snapshotSalesforceContactId =
    input?.salesforceContactId ?? salesforceContactId;

  return {
    recordType: "contact_snapshot" as const,
    recordId: snapshotSalesforceContactId,
    salesforceContactId: snapshotSalesforceContactId,
    displayName: input?.displayName ?? "Stage One Volunteer",
    primaryEmail: "volunteer@example.org",
    primaryPhone:
      input?.primaryPhone === undefined ? "+15555550123" : input.primaryPhone,
    normalizedEmails: ["volunteer@example.org"],
    normalizedPhones: input?.normalizedPhones ?? ["+15555550123"],
    volunteerIdPlainValues: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-05T11:59:00.000Z",
    memberships: input?.memberships ?? [
      {
        salesforceId: "membership-stage1",
        projectId: "project-stage1",
        projectName: "Project Stage 1",
        expeditionId: "expedition-stage1",
        expeditionName: "Expedition Stage 1",
        textOptIn: true,
        role: "volunteer",
        status: "active"
      }
    ]
  };
}

async function insertConsent(
  context: TestWorkerContext,
  input: {
    readonly status: ConsentRecord["status"];
    readonly source: ConsentRecord["source"];
    readonly createdAt: string;
  }
): Promise<void> {
  const createdAt = new Date(input.createdAt);

  await context.repositories.consentRecords.insert({
    id: `consent:${input.status}:${createdAt.toISOString()}`,
    contactId,
    phoneE164: "+15555550123",
    status: input.status,
    source: input.source,
    sourceDetail: null,
    consentedAt: input.status === "opted_in" ? createdAt : null,
    revokedAt: input.status === "revoked" ? createdAt : null,
    recordedByUserId: null,
    notes: `${input.status} seed`,
    createdAt,
    updatedAt: createdAt
  });
}

async function countConsentRecords(
  context: TestWorkerContext,
  contactIdToCount: string
): Promise<number> {
  const result = await context.db.execute(
    sql<{ count: number | string }>`
      select count(*)::int as count
      from consent_records
      where contact_id = ${contactIdToCount}
    `
  );
  const rows: { count: number | string }[] = Array.isArray(result)
    ? result.map((row) => row as { count: number | string })
    : [
        ...(
          (result as { readonly rows?: readonly { count: number | string }[] })
            .rows ?? []
        )
      ];

  return Number(rows[0]?.count ?? 0);
}

describe("captured Salesforce SMS consent reconcile", () => {
  it("skips contacts whose memberships never captured text opt-in without reading or writing consent", async () => {
    const consentRecords = {
      findLatestByContactIds: vi.fn(() => Promise.resolve(new Map())),
      insert: vi.fn()
    };
    const logger = { info: vi.fn() };
    const reconcile = createCapturedSmsConsentReconciler({
      consentRecords,
      contacts: {
        listByIds: vi.fn(() => Promise.resolve([]))
      },
      logger,
      now: () => fixedNow
    });

    await reconcile({
      capturedContacts: [
        {
          contactId,
          record: buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: null,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        }
      ]
    });

    expect(consentRecords.findLatestByContactIds).not.toHaveBeenCalled();
    expect(consentRecords.insert).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({
      event: "sms_consent.capture_reconcile",
      opted_in_appended: 0,
      revoked_appended: 0,
      skipped_no_phone: 0,
      skipped_no_optin_data: 1
    });
  });

  it("inserts opted_in during Salesforce live capture when a membership is opted in", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const logger = { info: vi.fn() };
    const context = await createTestWorkerContext({
      capture,
      logger,
      now: () => fixedNow
    });

    try {
      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:opt-in")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        contactId,
        phoneE164: "+15555550123",
        status: "opted_in",
        source: "salesforce_field",
        notes:
          "salesforce text opt-in enabled with no prior consent record",
        consentedAt: fixedNow,
        revokedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      expect(logger.info).toHaveBeenCalledWith({
        event: "sms_consent.capture_reconcile",
        opted_in_appended: 1,
        revoked_appended: 0,
        skipped_no_phone: 0,
        skipped_no_optin_data: 0
      });
    } finally {
      await context.dispose();
    }
  });

  it("appends revoked when Salesforce now reports all memberships opted out", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: false,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      await seedContact(context);
      await insertConsent(context, {
        status: "opted_in",
        source: "salesforce_field",
        createdAt: "2026-07-04T12:00:00.000Z"
      });

      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:opt-out")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "revoked",
        source: "salesforce_field",
        notes:
          "salesforce text opt-in absent so latest opted-in consent must be revoked",
        consentedAt: null,
        revokedAt: fixedNow
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(2);
    } finally {
      await context.dispose();
    }
  });

  it("never re-subscribes a revoked contact from the Salesforce field alone", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      await seedContact(context);
      await insertConsent(context, {
        status: "revoked",
        source: "inbound_thread",
        createdAt: "2026-07-04T12:00:00.000Z"
      });

      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:keystone")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "revoked",
        source: "inbound_thread",
        notes: "revoked seed"
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("restores a Salesforce-revoked contact when live capture reports text opt-in true", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      await seedContact(context);
      await insertConsent(context, {
        status: "revoked",
        source: "salesforce_field",
        createdAt: "2026-07-04T12:00:00.000Z"
      });

      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:restore")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "opted_in",
        source: "salesforce_field",
        notes:
          "salesforce text opt-in re-enabled; prior revocation originated from a salesforce sync, so restoring is safe",
        consentedAt: fixedNow,
        revokedAt: null
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(2);
    } finally {
      await context.dispose();
    }
  });

  it("restores a Salesforce-revoked contact on historical membership-id recapture when the snapshot comes from additionalContacts", async () => {
    const membershipId = "a01-membership-keegan";
    const capturedBatches: Awaited<
      ReturnType<
        ReturnType<typeof createSalesforceCaptureService>["captureHistoricalBatch"]
      >
    >[] = [];
    const salesforceService = createSalesforceCaptureService(
      {
        bearerToken: "salesforce-token",
        loginUrl: "https://test.salesforce.com",
        clientId: "client-id",
        username: "worker@example.org",
        jwtPrivateKey: `-----BEGIN PRIVATE KEY-----
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
-----END PRIVATE KEY-----`,
        contactCaptureMode: "cdc_compatible",
        membershipCaptureMode: "cdc_compatible"
      },
      {
        apiClient: {
          queryAll: vi.fn((soql: string) => {
            if (soql.includes(" FROM Contact ")) {
              if (soql.includes(`'${membershipId}'`)) {
                return Promise.resolve([]);
              }

              if (soql.includes(`'${salesforceContactId}'`)) {
                return Promise.resolve([
                  {
                    Id: salesforceContactId,
                    Name: "Keegan-Like Volunteer",
                    Email: "volunteer@example.org",
                    Phone: "14012199367",
                    MobilePhone: "14012199367",
                    Phone_Number__c: null,
                    Volunteer_ID_Plain__c: "VOL-123",
                    CreatedDate: "2026-01-01T00:00:00.000Z",
                    LastModifiedDate: "2026-07-05T00:00:00.000Z"
                  }
                ]);
              }

              return Promise.resolve([]);
            }

            if (soql.includes(" FROM Expedition_Members__c ")) {
              if (
                soql.includes(`'${membershipId}'`) ||
                soql.includes(`'${salesforceContactId}'`)
              ) {
                return Promise.resolve([
                  {
                    Id: membershipId,
                    Contact__c: salesforceContactId,
                    Project__c: "project-stage1",
                    Project__r: { Name: "Project Stage 1" },
                    Expedition__c: "expedition-stage1",
                    Expedition__r: { Name: "Expedition Stage 1" },
                    Role__c: "volunteer",
                    Status__c: "active",
                    Text_Opt_In__c: true,
                    CreatedDate: "2026-01-02T00:00:00.000Z",
                    LastModifiedDate: "2026-07-05T00:01:00.000Z"
                  }
                ]);
              }

              return Promise.resolve([]);
            }

            if (soql.includes(" FROM Task ")) {
              return Promise.resolve([]);
            }

            return Promise.resolve([]);
          }),
          queryAllIncludingDeleted: vi.fn(() => Promise.resolve([]))
        },
        now: () => new Date("2026-07-05T00:05:00.000Z")
      }
    );
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureHistoricalBatch = async (payload) => {
      const batch = await salesforceService.captureHistoricalBatch(payload);
      capturedBatches.push(batch);
      return batch;
    };
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      await seedContact(context);
      await insertConsent(context, {
        status: "revoked",
        source: "salesforce_field",
        createdAt: "2026-07-04T12:00:00.000Z"
      });

      const result = await context.orchestration.runSalesforceHistoricalCaptureBatch(
        buildSalesforceHistoricalPayload(
          "sync:salesforce:sms-consent:historical-restore",
          [membershipId]
        )
      );

      expect(result.outcome).toBe("succeeded");
      expect(capturedBatches).toHaveLength(1);
      expect(capturedBatches[0]?.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordType: "contact_snapshot",
            salesforceContactId,
            primaryPhone: "+14012199367",
            memberships: [expect.objectContaining({ textOptIn: true })]
          })
        ])
      );
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "opted_in",
        source: "salesforce_field",
        phoneE164: "+14012199367",
        notes:
          "salesforce text opt-in re-enabled; prior revocation originated from a salesforce sync, so restoring is safe",
        consentedAt: fixedNow,
        revokedAt: null
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(2);
    } finally {
      await context.dispose();
    }
  });

  it("does not restore an operator-revoked contact when live capture reports text opt-in true", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      await seedContact(context);
      await insertConsent(context, {
        status: "revoked",
        source: "operator_attestation",
        createdAt: "2026-07-04T12:00:00.000Z"
      });

      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:protected")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "revoked",
        source: "operator_attestation",
        notes: "revoked seed"
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("skips opted-in Salesforce snapshots without a phone and counts the skip", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            primaryPhone: null,
            normalizedPhones: [],
            memberships: [
              {
                salesforceId: "membership-stage1",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const logger = { info: vi.fn() };
    const context = await createTestWorkerContext({
      capture,
      logger,
      now: () => fixedNow
    });

    try {
      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:no-phone")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toBeNull();
      expect(logger.info).toHaveBeenCalledWith({
        event: "sms_consent.capture_reconcile",
        opted_in_appended: 0,
        revoked_appended: 0,
        skipped_no_phone: 1,
        skipped_no_optin_data: 0
      });
    } finally {
      await context.dispose();
    }
  });

  it("falls back to the platform contact primary phone before counting skipped_no_phone", async () => {
    const platformPhoneE164 = "+14065550123";
    const consentRecords = {
      findLatestByContactIds: vi.fn(() =>
        Promise.resolve(
          new Map([
            [
              contactId,
              {
                id: "consent:revoked:salesforce-field",
                contactId,
                phoneE164: platformPhoneE164,
                status: "revoked" as const,
                source: "salesforce_field" as const,
                sourceDetail: null,
                consentedAt: null,
                revokedAt: new Date("2026-07-04T12:00:00.000Z"),
                recordedByUserId: null,
                notes: "revoked seed",
                createdAt: new Date("2026-07-04T12:00:00.000Z"),
                updatedAt: new Date("2026-07-04T12:00:00.000Z")
              }
            ]
          ])
        )
      ),
      insert: vi.fn((record) => Promise.resolve(record))
    };
    const logger = { info: vi.fn() };
    const reconcile = createCapturedSmsConsentReconciler({
      consentRecords,
      contacts: {
        listByIds: vi.fn(() =>
          Promise.resolve([
            {
              id: contactId,
              salesforceContactId,
              displayName: "Stage One Volunteer",
              primaryEmail: "volunteer@example.org",
              primaryPhone: platformPhoneE164,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-07-05T11:59:00.000Z"
            }
          ])
        )
      },
      logger,
      now: () => fixedNow
    });

    await reconcile({
      capturedContacts: [
        {
          contactId,
          record: buildContactSnapshotRecord({
            primaryPhone: null,
            normalizedPhones: []
          })
        }
      ]
    });

    expect(consentRecords.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "opted_in",
        source: "salesforce_field",
        phoneE164: platformPhoneE164
      })
    );
    expect(logger.info).toHaveBeenCalledWith({
      event: "sms_consent.capture_reconcile",
      opted_in_appended: 1,
      revoked_appended: 0,
      skipped_no_phone: 0,
      skipped_no_optin_data: 0
    });
  });

  it("is idempotent across repeated Salesforce capture runs", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(buildCapturedBatch([buildContactSnapshotRecord()]));
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      const first = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:idempotent:1")
      );
      const second = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:idempotent:2")
      );

      expect(first.outcome).toBe("succeeded");
      expect(second.outcome).toBe("succeeded");
      await expect(countConsentRecords(context, contactId)).resolves.toBe(1);
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "opted_in",
        source: "salesforce_field"
      });
    } finally {
      await context.dispose();
    }
  });

  it("treats any true membership as opted in across the captured contact", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          buildContactSnapshotRecord({
            memberships: [
              {
                salesforceId: "membership-stage1-false",
                projectId: "project-stage1",
                projectName: "Project Stage 1",
                expeditionId: "expedition-stage1",
                expeditionName: "Expedition Stage 1",
                textOptIn: false,
                role: "volunteer",
                status: "active"
              },
              {
                salesforceId: "membership-stage1-true",
                projectId: "project-stage1-b",
                projectName: "Project Stage 1B",
                expeditionId: "expedition-stage1-b",
                expeditionName: "Expedition Stage 1B",
                textOptIn: true,
                role: "volunteer",
                status: "active"
              }
            ]
          })
        ])
      );
    const context = await createTestWorkerContext({
      capture,
      now: () => fixedNow
    });

    try {
      const result = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload("sync:salesforce:sms-consent:aggregate")
      );

      expect(result.outcome).toBe("succeeded");
      await expect(
        context.repositories.consentRecords.findLatestByContact(contactId)
      ).resolves.toMatchObject({
        status: "opted_in",
        source: "salesforce_field"
      });
      await expect(countConsentRecords(context, contactId)).resolves.toBe(1);
    } finally {
      await context.dispose();
    }
  });
});
