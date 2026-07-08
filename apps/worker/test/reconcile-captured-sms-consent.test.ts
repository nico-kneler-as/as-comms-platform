import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import { salesforceLiveCaptureBatchPayloadSchema } from "@as-comms/contracts";
import type { ConsentRecord } from "@as-comms/domain";

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
