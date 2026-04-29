import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  cutoverCheckpointBatchPayloadSchema,
  gmailHistoricalCaptureBatchPayloadSchema,
  mailchimpHistoricalCaptureBatchPayloadSchema,
  parityCheckBatchPayloadSchema,
  projectionRebuildBatchPayloadSchema,
  replayBatchPayloadSchema,
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema
} from "@as-comms/contracts";
import { importGmailMboxRecords } from "@as-comms/integrations";

import {
  Stage1NonRetryableJobError,
  Stage1RetryableJobError
} from "../src/orchestration/index.js";
import {
  buildCapturedBatch,
  createEmptyCapturePorts,
  createTestWorkerContext,
  type TestWorkerContext
} from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";

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

function buildSalesforceLivePayload(input: {
  readonly syncStateId: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
}) {
  return salesforceLiveCaptureBatchPayloadSchema.parse({
    version: 1,
    jobId: `job:${input.syncStateId}`,
    correlationId: `corr:${input.syncStateId}`,
    traceId: null,
    batchId: `batch:${input.syncStateId}`,
    syncStateId: input.syncStateId,
    attempt: input.attempt ?? 1,
    maxAttempts: input.maxAttempts ?? 3,
    provider: "salesforce",
    mode: "live",
    jobType: "live_ingest",
    cursor: "salesforce:cursor:live",
    checkpoint: "salesforce:checkpoint:live",
    windowStart: "2026-01-05T00:00:00.000Z",
    windowEnd: "2026-01-05T00:05:00.000Z",
    recordIds: [],
    maxRecords: 100
  });
}

function buildGmailMessageRecord(
  overrides: Partial<{
    readonly recordId: string;
    readonly direction: "inbound" | "outbound";
    readonly occurredAt: string;
    readonly receivedAt: string;
    readonly payloadRef: string;
    readonly checksum: string;
    readonly snippet: string;
    readonly subject: string | null;
    readonly fromHeader: string | null;
    readonly toHeader: string | null;
    readonly ccHeader: string | null;
    readonly snippetClean: string;
    readonly bodyTextPreview: string;
    readonly dsnOriginalMessageId: string | null;
    readonly threadId: string | null;
    readonly rfc822MessageId: string | null;
    readonly normalizedParticipantEmails: readonly string[];
    readonly salesforceContactId: string | null;
    readonly volunteerIdPlainValues: readonly string[];
    readonly normalizedPhones: readonly string[];
    readonly supportingRecords: readonly {
      readonly provider: "salesforce";
      readonly providerRecordType: string;
      readonly providerRecordId: string;
    }[];
    readonly crossProviderCollapseKey: string | null;
  }> = {}
) {
  return {
    recordType: "message" as const,
    recordId: "gmail-message-1",
    direction: "outbound" as const,
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:01:00.000Z",
    payloadRef: "payloads/gmail/gmail-message-1.json",
    checksum: "checksum-1",
    snippet: "Following up by email",
    subject: null,
    fromHeader: "Project Team <orcas@adventurescientists.org>",
    toHeader: "Volunteer <volunteer@example.org>",
    ccHeader: null,
    snippetClean: "Following up by email",
    bodyTextPreview: "Following up by email",
    dsnOriginalMessageId: null,
    threadId: "thread-1",
    rfc822MessageId: "<message-1@example.org>",
    normalizedParticipantEmails: ["volunteer@example.org"],
    salesforceContactId,
    volunteerIdPlainValues: [],
    normalizedPhones: ["+15555550123"],
    supportingRecords: [
      {
        provider: "salesforce" as const,
        providerRecordType: "task_communication",
        providerRecordId: "task-1"
      }
    ],
    crossProviderCollapseKey: "collapse:email:1",
    ...overrides
  };
}

describe("Stage 1 worker orchestration service", () => {
  it("replays Gmail historical mbox-backed records through the same idempotent normalization path", async () => {
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.reject(
        new Error(
          "Gmail historical replay should load .mbox-backed records from payloadRef, not call the capture port."
        )
      );

    const context = await createTestWorkerContext({ capture });
    const tempDirectory = await mkdtemp(join(tmpdir(), "stage1-gmail-replay-"));
    const mboxPath = join(tempDirectory, "historical-proof.mbox");
    const mboxText = `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Orcas <orcas@adventurescientists.org>
Subject: Historical replay proof inbound
Message-ID: <gmail-replay-proof-1@example.org>

First replay proof message.
From MAILER-DAEMON Fri Jan 03 00:01:00 2026
Date: Fri, 03 Jan 2026 00:01:00 +0000
From: Volunteer <volunteer@example.org>
To: Orcas <orcas@adventurescientists.org>
Subject: Historical replay proof second
Message-ID: <gmail-replay-proof-2@example.org>

Second replay proof message.
`;

    try {
      await seedContact(context);
      await writeFile(mboxPath, mboxText, "utf8");
      const importedRecords = await importGmailMboxRecords({
        mboxText,
        mboxPath,
        capturedMailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["orcas@adventurescientists.org"],
        projectInboxAliasOverride: "orcas@adventurescientists.org",
        receivedAt: "2026-01-03T00:05:00.000Z"
      });
      const gmailRecord = importedRecords[1];

      expect(gmailRecord).toBeDefined();
      if (gmailRecord === undefined) {
        throw new Error("Expected a second imported Gmail historical record.");
      }

      const first = await context.ingest.ingestGmailHistoricalRecord(gmailRecord);

      const replay = await context.orchestration.runReplayBatch(
        replayBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:replay:1",
          correlationId: "corr:replay:1",
          traceId: "trace:replay:1",
          batchId: "batch:replay:1",
          syncStateId: "sync:replay:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "dead_letter_reprocess",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          items: [
            {
              providerRecordType: "message",
              providerRecordId: gmailRecord.recordId
            }
          ]
        })
      );

      expect(first.outcome).toBe("normalized");
      if (first.outcome !== "normalized") {
        throw new Error("Expected Gmail historical seed ingest to normalize.");
      }

      expect(replay.outcome).toBe("succeeded");
      if (replay.outcome !== "succeeded") {
        throw new Error("Expected replay batch to succeed.");
      }

      expect(replay.summary.normalized).toBe(0);
      expect(replay.summary.duplicate).toBe(1);
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(1);
      await expect(context.repositories.inboxProjection.countAll()).resolves.toBe(1);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
      await context.dispose();
    }
  });

  it("replays historical Gmail messages with the recorded project alias even after config drift", async () => {
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.reject(
        new Error(
          "Gmail historical replay should load .mbox-backed records from payloadRef, not call the capture port."
        )
      );

    const context = await createTestWorkerContext({
      capture,
      gmailHistoricalReplay: {
        projectInboxAliases: []
      }
    });
    const tempDirectory = await mkdtemp(join(tmpdir(), "stage1-gmail-alias-drift-"));
    const mboxPath = join(tempDirectory, "alias-drift-proof.mbox");
    const mboxText = `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Project Antarctica <project-antarctica@example.org>
To: Volunteer <volunteer@example.org>
Subject: Alias drift proof outbound
Message-ID: <gmail-replay-alias-drift@example.org>

Alias drift outbound message.
`;

    try {
      await seedContact(context);
      await writeFile(mboxPath, mboxText, "utf8");
      const importedRecord = (await importGmailMboxRecords({
        mboxText,
        mboxPath,
        capturedMailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z"
      }))[0];

      expect(importedRecord).toBeDefined();
      if (importedRecord === undefined) {
        throw new Error("Expected an imported Gmail historical record.");
      }

      expect(importedRecord).toMatchObject({
        recordType: "message",
        direction: "outbound",
        normalizedParticipantEmails: ["volunteer@example.org"],
        projectInboxAlias: "project-antarctica@example.org"
      });

      const first = await context.ingest.ingestGmailHistoricalRecord(importedRecord);
      const replay = await context.orchestration.runReplayBatch(
        replayBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:replay:alias-drift",
          correlationId: "corr:replay:alias-drift",
          traceId: "trace:replay:alias-drift",
          batchId: "batch:replay:alias-drift",
          syncStateId: "sync:replay:alias-drift",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "dead_letter_reprocess",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          items: [
            {
              providerRecordType: "message",
              providerRecordId: importedRecord.recordId
            }
          ]
        })
      );

      expect(first.outcome).toBe("normalized");
      if (first.outcome !== "normalized") {
        throw new Error("Expected the seeded Gmail historical import to normalize.");
      }

      expect(replay.outcome).toBe("succeeded");
      if (replay.outcome !== "succeeded") {
        throw new Error("Expected replay batch to succeed after alias drift.");
      }

      expect(replay.summary.normalized).toBe(0);
      expect(replay.summary.duplicate).toBe(1);
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
      await context.dispose();
    }
  });

  it("replays Salesforce fan-out batches without truncating additive read-model writes", async () => {
    let observedMaxRecords: number | null = null;
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = (payload) => {
      const parsedPayload = salesforceLiveCaptureBatchPayloadSchema.parse(payload);
      observedMaxRecords = parsedPayload.maxRecords;

      const replayedRecords = [
        {
          recordType: "task_communication" as const,
          recordId: "task-stage1-older",
          channel: "email" as const,
          salesforceContactId,
          occurredAt: "2025-12-31T23:59:00.000Z",
          receivedAt: "2026-01-01T00:00:00.000Z",
          payloadRef: "salesforce://Task/task-stage1-older",
          checksum: "checksum-task-stage1-older",
          snippet: "Older logged email",
          normalizedEmails: ["volunteer@example.org"],
          normalizedPhones: ["+15555550123"],
          volunteerIdPlainValues: [],
          supportingRecords: [],
          crossProviderCollapseKey: null,
          routing: {
            required: false,
            projectId: null,
            expeditionId: null
          }
        },
        {
          recordType: "lifecycle_milestone" as const,
          recordId: "membership-stage1:Expedition_Members__c.CreatedDate",
          salesforceContactId,
          milestone: "signed_up" as const,
          sourceField: "Expedition_Members__c.CreatedDate" as const,
          occurredAt: "2026-01-02T00:00:00.000Z",
          receivedAt: "2026-01-02T00:01:00.000Z",
          payloadRef:
            "salesforce://Expedition_Members__c/membership-stage1#CreatedDate",
          checksum: "checksum-membership-stage1-created",
          normalizedEmails: ["volunteer@example.org"],
          normalizedPhones: ["+15555550123"],
          volunteerIdPlainValues: [],
          routing: {
            required: true,
            projectId: "project-stage1",
            expeditionId: "expedition-stage1",
            projectName: "Project Stage 1",
            expeditionName: "Expedition Stage 1"
          }
        },
        {
          recordType: "contact_snapshot" as const,
          recordId: salesforceContactId,
          salesforceContactId,
          displayName: "Stage One Volunteer",
          primaryEmail: "volunteer@example.org",
          primaryPhone: "+15555550123",
          normalizedEmails: ["volunteer@example.org"],
          normalizedPhones: ["+15555550123"],
          volunteerIdPlainValues: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
          memberships: [
            {
              salesforceId: "membership-stage1",
              projectId: "project-stage1",
              projectName: "Project Stage 1",
              expeditionId: "expedition-stage1",
              expeditionName: "Expedition Stage 1",
              role: "volunteer",
              status: "active"
            }
          ]
        }
      ];

      return Promise.resolve(
        buildCapturedBatch(replayedRecords.slice(0, parsedPayload.maxRecords), {
          nextCursor:
            parsedPayload.maxRecords < replayedRecords.length
              ? "salesforce:cursor:more"
              : null,
          checkpoint: "salesforce:checkpoint:replay"
        })
      );
    };

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const replay = await context.orchestration.runReplayBatch(
        replayBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:replay:salesforce:1",
          correlationId: "corr:replay:salesforce:1",
          traceId: "trace:replay:salesforce:1",
          batchId: "batch:replay:salesforce:1",
          syncStateId: "sync:replay:salesforce:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "salesforce",
          mode: "live",
          jobType: "dead_letter_reprocess",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          items: [
            {
              providerRecordType: "lifecycle_milestone",
              providerRecordId: "membership-stage1"
            }
          ]
        })
      );

      expect(observedMaxRecords).toBe(1000);
      expect(replay.outcome).toBe("succeeded");
      if (replay.outcome !== "succeeded") {
        throw new Error("Expected Salesforce replay batch to succeed.");
      }

      await expect(
        context.repositories.projectDimensions.listByIds(["project-stage1"])
      ).resolves.toEqual([
        {
          projectId: "project-stage1",
          projectName: "Project Stage 1",
          projectAlias: null,
          source: "salesforce",
          isActive: false,
          aiKnowledgeUrl: null,
          aiKnowledgeSyncedAt: null
        }
      ]);
      await expect(
        context.repositories.expeditionDimensions.listByIds(["expedition-stage1"])
      ).resolves.toEqual([
        {
          expeditionId: "expedition-stage1",
          projectId: "project-stage1",
          expeditionName: "Expedition Stage 1",
          source: "salesforce"
        }
      ]);
      await expect(
        context.repositories.salesforceEventContext.listBySourceEvidenceIds([
          "source-evidence:salesforce:lifecycle_milestone:membership-stage1%3AExpedition_Members__c.CreatedDate"
        ])
      ).resolves.toEqual([
        {
          sourceEvidenceId:
            "source-evidence:salesforce:lifecycle_milestone:membership-stage1%3AExpedition_Members__c.CreatedDate",
          salesforceContactId,
          projectId: "project-stage1",
          expeditionId: "expedition-stage1",
          sourceField: "Expedition_Members__c.CreatedDate"
        }
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("ingests Salesforce contact snapshots before canonical replay records for unseen contacts", async () => {
    const freshSalesforceContactId = "003-stage1-fresh";
    const freshContactId = `contact:salesforce:${freshSalesforceContactId}`;
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = (payload) => {
      salesforceLiveCaptureBatchPayloadSchema.parse(payload);

      return Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "lifecycle_milestone" as const,
            recordId: "membership-stage1-fresh:Expedition_Members__c.CreatedDate",
            salesforceContactId: freshSalesforceContactId,
            milestone: "signed_up" as const,
            sourceField: "Expedition_Members__c.CreatedDate" as const,
            occurredAt: "2026-01-02T00:00:00.000Z",
            receivedAt: "2026-01-02T00:01:00.000Z",
            payloadRef:
              "salesforce://Expedition_Members__c/membership-stage1-fresh#CreatedDate",
            checksum: "checksum-membership-stage1-fresh-created",
            normalizedEmails: ["fresh@example.org"],
            normalizedPhones: ["+15555550124"],
            volunteerIdPlainValues: [],
            routing: {
              required: true,
              projectId: "project-stage1-fresh",
              expeditionId: "expedition-stage1-fresh",
              projectName: "Project Stage 1 Fresh",
              expeditionName: "Expedition Stage 1 Fresh"
            }
          },
          {
            recordType: "task_communication" as const,
            recordId: "task-stage1-fresh",
            channel: "email" as const,
            salesforceContactId: freshSalesforceContactId,
            occurredAt: "2026-01-03T00:00:00.000Z",
            receivedAt: "2026-01-03T00:01:00.000Z",
            payloadRef: "salesforce://Task/task-stage1-fresh",
            checksum: "checksum-task-stage1-fresh",
            snippet: "Fresh outbound email",
            normalizedEmails: ["fresh@example.org"],
            normalizedPhones: ["+15555550124"],
            volunteerIdPlainValues: [],
            supportingRecords: [],
            crossProviderCollapseKey: null,
            routing: {
              required: true,
              projectId: "project-stage1-fresh",
              expeditionId: "expedition-stage1-fresh",
              projectName: "Project Stage 1 Fresh",
              expeditionName: "Expedition Stage 1 Fresh"
            }
          },
          {
            recordType: "contact_snapshot" as const,
            recordId: freshSalesforceContactId,
            salesforceContactId: freshSalesforceContactId,
            displayName: "Fresh Salesforce Volunteer",
            primaryEmail: "fresh@example.org",
            primaryPhone: "+15555550124",
            normalizedEmails: ["fresh@example.org"],
            normalizedPhones: ["+15555550124"],
            volunteerIdPlainValues: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-03T00:02:00.000Z",
            memberships: [
              {
                salesforceId: "membership-stage1-fresh",
                projectId: "project-stage1-fresh",
                projectName: "Project Stage 1 Fresh",
                expeditionId: "expedition-stage1-fresh",
                expeditionName: "Expedition Stage 1 Fresh",
                role: null,
                status: "active"
              }
            ]
          }
        ])
      );
    };

    const context = await createTestWorkerContext({ capture });

    try {
      const replay = await context.orchestration.runReplayBatch(
        replayBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:replay:salesforce:fresh",
          correlationId: "corr:replay:salesforce:fresh",
          traceId: "trace:replay:salesforce:fresh",
          batchId: "batch:replay:salesforce:fresh",
          syncStateId: "sync:replay:salesforce:fresh",
          attempt: 1,
          maxAttempts: 3,
          provider: "salesforce",
          mode: "live",
          jobType: "dead_letter_reprocess",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          items: [
            {
              providerRecordType: "lifecycle_milestone",
              providerRecordId: "membership-stage1-fresh"
            }
          ]
        })
      );

      expect(replay.outcome).toBe("succeeded");
      if (replay.outcome !== "succeeded") {
        throw new Error("Expected Salesforce replay batch to succeed.");
      }

      await expect(
        context.repositories.contacts.findBySalesforceContactId(
          freshSalesforceContactId
        )
      ).resolves.toMatchObject({
        id: freshContactId,
        displayName: "Fresh Salesforce Volunteer"
      });
      await expect(
        context.repositories.canonicalEvents.listByContactId(freshContactId)
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "lifecycle.signed_up",
            contactId: freshContactId
          }),
          expect.objectContaining({
            eventType: "communication.email.outbound",
            contactId: freshContactId
          })
        ])
      );
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_missing_anchor"
        )
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("rebuilds timeline and inbox projections deterministically from canonical data", async () => {
    const gmailRecord = buildGmailMessageRecord();
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([gmailRecord], {
          nextCursor: "gmail:cursor:rebuild",
          checkpoint: "gmail:checkpoint:rebuild"
        })
      );

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const ingested = await context.orchestration.runGmailHistoricalCaptureBatch(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:rebuild-source",
          correlationId: "corr:gmail:rebuild-source",
          traceId: null,
          batchId: "batch:gmail:rebuild-source",
          syncStateId: "sync:gmail:rebuild-source",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-02T00:00:00.000Z",
          recordIds: [gmailRecord.recordId],
          maxRecords: 10
        })
      );

      expect(ingested.outcome).toBe("succeeded");
      if (ingested.outcome !== "succeeded") {
        throw new Error("Expected source ingest to succeed before rebuild.");
      }

      await context.client.exec(
        `delete from contact_timeline_projection where contact_id = '${contactId}'`
      );
      await context.client.exec(
        `delete from contact_inbox_projection where contact_id = '${contactId}'`
      );

      const rebuilt = await context.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:projection:rebuild:1",
          correlationId: "corr:projection:rebuild:1",
          traceId: null,
          batchId: "batch:projection:rebuild:1",
          syncStateId: "sync:projection:rebuild:1",
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: [contactId],
          includeReviewOverlayRefresh: true
        })
      );

      expect(rebuilt.outcome).toBe("succeeded");
      if (rebuilt.outcome !== "succeeded") {
        throw new Error("Expected projection rebuild to succeed.");
      }

      expect(rebuilt.rebuiltTimelineRows).toBe(1);
      expect(rebuilt.rebuiltInboxRows).toBe(1);
      expect(rebuilt.missingProjectionSeeds).toEqual([]);
      expect(rebuilt.discrepancies).toEqual([]);
      expect(rebuilt.syncState.scope).toBe("orchestration");
      expect(rebuilt.syncState.provider).toBeNull();

      const rebuiltAgain = await context.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:projection:rebuild:2",
          correlationId: "corr:projection:rebuild:2",
          traceId: null,
          batchId: "batch:projection:rebuild:2",
          syncStateId: "sync:projection:rebuild:2",
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: [contactId],
          includeReviewOverlayRefresh: true
        })
      );

      expect(rebuiltAgain.outcome).toBe("succeeded");
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(1);
      const inbox = await context.repositories.inboxProjection.findByContactId(contactId);
      expect(inbox?.snippet).toBe("Following up by email");
      expect(inbox?.bucket).toBe("Opened");
    } finally {
      await context.dispose();
    }
  });

  it("persists live-ingest freshness metrics for cutover readiness checks", async () => {
    const gmailRecord = buildGmailMessageRecord();
    const capture = createEmptyCapturePorts();
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            ...gmailRecord,
            recordId: "gmail-live-message-1",
            occurredAt: "2026-01-02T00:00:00.000Z",
            receivedAt: "2026-01-02T00:01:00.000Z"
          }
        ])
      );

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const result = await context.orchestration.runGmailLiveCaptureBatch({
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
        windowStart: "2026-01-02T00:00:00.000Z",
        windowEnd: "2026-01-02T00:02:00.000Z",
        recordIds: ["gmail-live-message-1"],
        maxRecords: 10
      });

      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") {
        throw new Error("Expected Gmail live batch to succeed.");
      }

      expect(result.syncState.scope).toBe("provider");
      expect(result.syncState.provider).toBe("gmail");
      expect(result.syncState.freshnessP95Seconds).toBe(60);
      expect(result.syncState.freshnessP99Seconds).toBe(60);
    } finally {
      await context.dispose();
    }
  });

  it("dead-letters Salesforce live ingest after five consecutive failures and resets after success", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () => {
      throw new Stage1RetryableJobError("Temporary Salesforce live capture failure.");
    };

    const context = await createTestWorkerContext({ capture });

    try {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await context.orchestration.runSalesforceLiveCaptureBatch(
          buildSalesforceLivePayload({
            syncStateId: "sync:salesforce:live:consecutive-failures"
          })
        );

        expect(result.outcome).toBe("failed");
        if (result.outcome !== "failed") {
          throw new Error("Expected Salesforce live failure to remain failed.");
        }

        expect(result.failure.disposition).toBe("retryable");
        expect(result.syncState.status).toBe("failed");
        expect(result.syncState.consecutiveFailureCount).toBe(attempt);
        expect(result.syncState.deadLetterCount).toBe(0);
      }

      const deadLettered = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload({
          syncStateId: "sync:salesforce:live:consecutive-failures"
        })
      );

      expect(deadLettered.outcome).toBe("failed");
      if (deadLettered.outcome !== "failed") {
        throw new Error("Expected fifth Salesforce live failure to dead-letter.");
      }

      expect(deadLettered.failure.disposition).toBe("dead_letter");
      expect(deadLettered.syncState.status).toBe("quarantined");
      expect(deadLettered.syncState.consecutiveFailureCount).toBe(5);
      expect(deadLettered.syncState.deadLetterCount).toBe(1);

      capture.salesforce.captureLiveBatch = () => Promise.resolve(buildCapturedBatch([]));
      const recovered = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload({
          syncStateId: "sync:salesforce:live:reset-after-success"
        })
      );

      expect(recovered.outcome).toBe("succeeded");
      if (recovered.outcome !== "succeeded") {
        throw new Error("Expected Salesforce live recovery batch to succeed.");
      }

      expect(recovered.syncState.consecutiveFailureCount).toBe(0);

      capture.salesforce.captureLiveBatch = () => {
        throw new Stage1RetryableJobError("Temporary Salesforce live capture failure.");
      };
      const afterReset = await context.orchestration.runSalesforceLiveCaptureBatch(
        buildSalesforceLivePayload({
          syncStateId: "sync:salesforce:live:reset-after-success"
        })
      );

      expect(afterReset.outcome).toBe("failed");
      if (afterReset.outcome !== "failed") {
        throw new Error("Expected Salesforce live failure after reset.");
      }

      expect(afterReset.syncState.consecutiveFailureCount).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("skips already-ingested Gmail live messages without duplicating events or projections", async () => {
    const gmailRecord = buildGmailMessageRecord({
      recordId: "gmail-live-duplicate-1",
      direction: "inbound",
      occurredAt: "2026-01-02T00:00:30.000Z",
      receivedAt: "2026-01-02T00:01:00.000Z",
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-live-duplicate-1",
      checksum: "checksum:gmail-live-duplicate-1",
      snippet: "Live reply from volunteer",
      snippetClean: "Live reply from volunteer",
      bodyTextPreview: "Live reply from volunteer",
      threadId: "thread-live-duplicate-1",
      rfc822MessageId: "<gmail-live-duplicate-1@example.org>",
      supportingRecords: [],
      crossProviderCollapseKey: null
    });
    const capture = createEmptyCapturePorts();
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(buildCapturedBatch([gmailRecord]));
    const logger = {
      info: vi.fn()
    };

    const context = await createTestWorkerContext({ capture, logger });

    try {
      await seedContact(context);

      const payload = {
        version: 1 as const,
        jobId: "job:gmail:live:duplicate",
        correlationId: "corr:gmail:live:duplicate",
        traceId: null,
        batchId: "batch:gmail:live:duplicate",
        syncStateId: "sync:gmail:live:duplicate:first",
        attempt: 1,
        maxAttempts: 3,
        provider: "gmail" as const,
        mode: "live" as const,
        jobType: "live_ingest" as const,
        cursor: null,
        checkpoint: null,
        windowStart: "2026-01-01T23:52:00.000Z",
        windowEnd: "2026-01-02T00:02:00.000Z",
        recordIds: ["gmail-live-duplicate-1"],
        maxRecords: 10
      };

      const first = await context.orchestration.runGmailLiveCaptureBatch(payload);

      expect(first.outcome).toBe("succeeded");
      if (first.outcome !== "succeeded") {
        throw new Error("Expected initial Gmail live batch to succeed.");
      }
      expect(first.summary.normalized).toBe(1);
      expect(first.summary.duplicate).toBe(0);
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(1);
      await expect(context.repositories.inboxProjection.countAll()).resolves.toBe(1);
      await expect(
        context.repositories.identityResolutionQueue.listOpenByContactId(contactId)
      ).resolves.toEqual([]);
      await expect(
        context.repositories.routingReviewQueue.listOpenByContactId(contactId)
      ).resolves.toEqual([]);

      const second = await context.orchestration.runGmailLiveCaptureBatch({
        ...payload,
        syncStateId: "sync:gmail:live:duplicate:second"
      });

      expect(second.outcome).toBe("succeeded");
      if (second.outcome !== "succeeded") {
        throw new Error("Expected duplicate Gmail live batch to succeed.");
      }
      expect(second.summary.normalized).toBe(0);
      expect(second.summary.duplicate).toBe(1);
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(1);
      await expect(context.repositories.inboxProjection.countAll()).resolves.toBe(1);
      await expect(
        context.repositories.identityResolutionQueue.listOpenByContactId(contactId)
      ).resolves.toEqual([]);
      await expect(
        context.repositories.routingReviewQueue.listOpenByContactId(contactId)
      ).resolves.toEqual([]);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith({
        event: "gmail_live.duplicate_skip",
        messageId: "gmail-live-duplicate-1",
        windowStart: "2026-01-01T23:52:00.000Z",
        windowEnd: "2026-01-02T00:02:00.000Z"
      });
    } finally {
      await context.dispose();
    }
  });

  it("writes Gmail DSN evidence and marks the matched pending outbound failed", async () => {
    const dsnRecord = buildGmailMessageRecord({
      recordId: "gmail-dsn-match-1",
      direction: "inbound",
      occurredAt: "2026-01-02T00:02:00.000Z",
      receivedAt: "2026-01-02T00:02:30.000Z",
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-dsn-match-1",
      checksum: "checksum:gmail-dsn-match-1",
      snippet: "Delivery Status Notification (Failure)",
      subject: "Delivery Status Notification (Failure)",
      fromHeader: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      toHeader: "Project <orcas@adventurescientists.org>",
      snippetClean: "Delivery Status Notification (Failure)",
      bodyTextPreview:
        "550 5.1.1 The email account that you tried to reach does not exist.",
      dsnOriginalMessageId: "<sent-match-1@example.org>",
      threadId: "thread-dsn-match-1",
      rfc822MessageId: "<gmail-dsn-match-1@example.org>",
      supportingRecords: [],
      crossProviderCollapseKey: null
    });
    const capture = createEmptyCapturePorts();
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(buildCapturedBatch([dsnRecord]));
    const logger = { info: vi.fn() };
    const context = await createTestWorkerContext({ capture, logger });

    try {
      await seedContact(context);
      await context.settings.users.upsert({
        id: "user:operator",
        name: "Operator",
        email: "operator@example.org",
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
        image: null,
        role: "operator",
        deactivatedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await context.repositories.pendingOutbounds.insert({
        id: "pending:dsn-match",
        fingerprint: "fp:dsn-match",
        actorId: "user:operator",
        canonicalContactId: contactId,
        projectId: null,
        fromAlias: "orcas@adventurescientists.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Prior send",
        bodyPlaintext: "Prior send body",
        bodySha256: "sha256:dsn-match",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-01-02T00:01:00.000Z"
      });
      await context.repositories.pendingOutbounds.markSentRfc822(
        "pending:dsn-match",
        "<sent-match-1@example.org>"
      );

      const result = await context.orchestration.runGmailLiveCaptureBatch({
        version: 1,
        jobId: "job:gmail:dsn:match",
        correlationId: "corr:gmail:dsn:match",
        traceId: null,
        batchId: "batch:gmail:dsn:match",
        syncStateId: "sync:gmail:dsn:match",
        attempt: 1,
        maxAttempts: 3,
        provider: "gmail",
        mode: "live",
        jobType: "live_ingest",
        cursor: null,
        checkpoint: null,
        windowStart: "2026-01-02T00:00:00.000Z",
        windowEnd: "2026-01-02T00:03:00.000Z",
        recordIds: ["gmail-dsn-match-1"],
        maxRecords: 10
      });

      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") {
        throw new Error("Expected Gmail DSN batch to succeed.");
      }
      expect(result.summary.deferred).toBe(1);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(0);
      await expect(
        context.repositories.sourceEvidence.findById(
          "source-evidence:gmail:gmail.dsn:gmail-dsn-match-1"
        )
      ).resolves.toMatchObject({
        providerRecordType: "gmail.dsn",
        providerRecordId: "gmail-dsn-match-1"
      });
      await expect(
        context.repositories.pendingOutbounds.findByFingerprint("fp:dsn-match")
      ).resolves.toMatchObject({
        id: "pending:dsn-match",
        status: "failed",
        failedReason: "bounce",
        failedDetail:
          "550 5.1.1 The email account that you tried to reach does not exist."
      });
      expect(logger.info).toHaveBeenCalledWith({
        event: "composer.bounce.matched",
        pendingOutboundId: "pending:dsn-match",
        dsnOriginalMessageId: "<sent-match-1@example.org>",
        dsnGmailMessageId: "gmail-dsn-match-1"
      });
    } finally {
      await context.dispose();
    }
  });

  it("logs unmatched Gmail DSNs without throwing or writing canonical events", async () => {
    const dsnRecord = buildGmailMessageRecord({
      recordId: "gmail-dsn-unmatched-1",
      direction: "inbound",
      occurredAt: "2026-01-02T00:04:00.000Z",
      receivedAt: "2026-01-02T00:04:30.000Z",
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-dsn-unmatched-1",
      checksum: "checksum:gmail-dsn-unmatched-1",
      snippet: "Undelivered Mail Returned to Sender",
      subject: "Undelivered Mail Returned to Sender",
      fromHeader: "mailer-daemon@googlemail.com",
      toHeader: "Project <orcas@adventurescientists.org>",
      snippetClean: "Undelivered Mail Returned to Sender",
      bodyTextPreview: "550 5.1.1 user unknown",
      dsnOriginalMessageId: "<missing-match@example.org>",
      threadId: "thread-dsn-unmatched-1",
      rfc822MessageId: "<gmail-dsn-unmatched-1@example.org>",
      supportingRecords: [],
      crossProviderCollapseKey: null
    });
    const capture = createEmptyCapturePorts();
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(buildCapturedBatch([dsnRecord]));
    const logger = { info: vi.fn() };
    const context = await createTestWorkerContext({ capture, logger });

    try {
      await seedContact(context);

      const result = await context.orchestration.runGmailLiveCaptureBatch({
        version: 1,
        jobId: "job:gmail:dsn:unmatched",
        correlationId: "corr:gmail:dsn:unmatched",
        traceId: null,
        batchId: "batch:gmail:dsn:unmatched",
        syncStateId: "sync:gmail:dsn:unmatched",
        attempt: 1,
        maxAttempts: 3,
        provider: "gmail",
        mode: "live",
        jobType: "live_ingest",
        cursor: null,
        checkpoint: null,
        windowStart: "2026-01-02T00:03:00.000Z",
        windowEnd: "2026-01-02T00:05:00.000Z",
        recordIds: ["gmail-dsn-unmatched-1"],
        maxRecords: 10
      });

      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") {
        throw new Error("Expected unmatched Gmail DSN batch to succeed.");
      }
      expect(result.summary.deferred).toBe(1);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(0);
      expect(logger.info).toHaveBeenCalledWith({
        event: "composer.bounce.unmatched",
        dsnOriginalMessageId: "<missing-match@example.org>",
        dsnGmailMessageId: "gmail-dsn-unmatched-1"
      });
    } finally {
      await context.dispose();
    }
  });

  it("clears stale inbox rows during projection rebuild when a contact has no queue-driving communication", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      await context.repositories.sourceEvidence.append({
        id: "sev:stale-salesforce-task",
        provider: "salesforce",
        providerRecordType: "task_communication",
        providerRecordId: "task-stale-1",
        receivedAt: "2026-01-01T00:01:00.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/salesforce/task-stale-1.json",
        idempotencyKey: "salesforce:task-stale-1",
        checksum: "checksum:task-stale-1"
      });

      await context.repositories.canonicalEvents.upsert({
        id: "evt:stale-salesforce-task",
        contactId,
        eventType: "communication.email.outbound",
        channel: "email",
        occurredAt: "2026-01-01T00:00:00.000Z",
        contentFingerprint: null,
        sourceEvidenceId: "sev:stale-salesforce-task",
        idempotencyKey: "canonical:task-stale-1",
        provenance: {
          primaryProvider: "salesforce",
          primarySourceEvidenceId: "sev:stale-salesforce-task",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "task_communication",
          sourceRecordId: "task-stale-1",
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: "outbound",
          notes: null
        },
        reviewState: "clear"
      });

      await context.repositories.timelineProjection.upsert({
        id: "timeline:stale-salesforce-task",
        contactId,
        canonicalEventId: "evt:stale-salesforce-task",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sortKey: "2026-01-01T00:00:00.000Z::evt:stale-salesforce-task",
        eventType: "communication.email.outbound",
        summary: "Outbound email sent",
        channel: "email",
        primaryProvider: "salesforce",
        reviewState: "clear"
      });

      await context.repositories.inboxProjection.upsert({
        contactId,
        bucket: "Opened",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: null,
        lastOutboundAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        snippet: "Outbound email sent",
        lastCanonicalEventId: "evt:stale-salesforce-task",
        lastEventType: "communication.email.outbound"
      });

      const rebuilt = await context.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:projection:clear-stale-row",
          correlationId: "corr:projection:clear-stale-row",
          traceId: null,
          batchId: "batch:projection:clear-stale-row",
          syncStateId: "sync:projection:clear-stale-row",
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: [contactId],
          includeReviewOverlayRefresh: true
        })
      );

      expect(rebuilt.outcome).toBe("succeeded");
      if (rebuilt.outcome !== "succeeded") {
        throw new Error("Expected stale-row projection rebuild to succeed.");
      }

      expect(rebuilt.rebuiltTimelineRows).toBe(1);
      expect(rebuilt.rebuiltInboxRows).toBe(0);
      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("rebuilds inbox state from Gmail events even when historical provenance messageKind is null", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      await context.repositories.sourceEvidence.append({
        id: "sev:gmail-historical-null-kind",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-null-kind-1",
        receivedAt: "2026-03-31T17:31:38.000Z",
        occurredAt: "2026-03-31T17:31:38.000Z",
        payloadRef: "payloads/gmail/gmail-null-kind-1.json",
        idempotencyKey: "gmail:null-kind-1",
        checksum: "checksum:gmail:null-kind-1"
      });

      await context.repositories.canonicalEvents.upsert({
        id: "evt:gmail-historical-null-kind",
        contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: "2026-03-31T17:31:38.000Z",
        contentFingerprint: null,
        sourceEvidenceId: "sev:gmail-historical-null-kind",
        idempotencyKey: "canonical:gmail:null-kind-1",
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: "sev:gmail-historical-null-kind",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: null,
          sourceRecordId: null,
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: null,
          notes: null
        },
        reviewState: "clear"
      });

      await context.repositories.gmailMessageDetails.upsert({
        sourceEvidenceId: "sev:gmail-historical-null-kind",
        providerRecordId: "gmail-null-kind-1",
        gmailThreadId: "thread:gmail-null-kind",
        rfc822MessageId: "<gmail-null-kind-1@example.org>",
        direction: "inbound",
        subject: "Re: Plan your Adventure Today!",
        fromHeader: "Volunteer <volunteer@example.org>",
        toHeader: "PNW Bio <pnwbio@adventurescientists.org>",
        ccHeader: null,
        snippetClean: "Thanks for checking in. I'll claim some hexes soon.",
        bodyTextPreview:
          "Thanks for checking in. I'll claim some hexes soon. A piece of feedback on the web map...",
        capturedMailbox: "pnwbio@adventurescientists.org",
        projectInboxAlias: "pnwbio@adventurescientists.org"
      });

      const rebuilt = await context.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:projection:gmail-null-kind",
          correlationId: "corr:projection:gmail-null-kind",
          traceId: null,
          batchId: "batch:projection:gmail-null-kind",
          syncStateId: "sync:projection:gmail-null-kind",
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: [contactId],
          includeReviewOverlayRefresh: true
        })
      );

      expect(rebuilt.outcome).toBe("succeeded");
      if (rebuilt.outcome !== "succeeded") {
        throw new Error("Expected Gmail null-messageKind rebuild to succeed.");
      }

      expect(rebuilt.rebuiltInboxRows).toBe(1);
      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toMatchObject({
        contactId,
        bucket: "New",
        lastInboundAt: "2026-03-31T17:31:38.000Z",
        lastCanonicalEventId: "evt:gmail-historical-null-kind"
      });
    } finally {
      await context.dispose();
    }
  });

  it("excludes internal-only forwarded staff messages during projection rebuild", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      await context.repositories.sourceEvidence.append({
        id: "sev:gmail-internal-only",
        provider: "gmail",
        providerRecordType: "internal_only_message",
        providerRecordId: "gmail-internal-only-1",
        receivedAt: "2026-03-31T18:00:00.000Z",
        occurredAt: "2026-03-31T18:00:00.000Z",
        payloadRef: "payloads/gmail/gmail-internal-only-1.json",
        idempotencyKey: "gmail:internal-only-1",
        checksum: "checksum:gmail:internal-only-1"
      });

      await context.repositories.canonicalEvents.upsert({
        id: "evt:gmail-internal-only",
        contactId,
        eventType: "communication.email.outbound",
        channel: "email",
        occurredAt: "2026-03-31T18:00:00.000Z",
        contentFingerprint: null,
        sourceEvidenceId: "sev:gmail-internal-only",
        idempotencyKey: "canonical:gmail:internal-only-1",
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: "sev:gmail-internal-only",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "internal_only_message",
          sourceRecordId: "gmail-internal-only-1",
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: null,
          notes: null
        },
        reviewState: "clear"
      });

      await context.repositories.inboxProjection.upsert({
        contactId,
        bucket: "Opened",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: null,
        lastOutboundAt: "2026-03-31T18:00:00.000Z",
        lastActivityAt: "2026-03-31T18:00:00.000Z",
        snippet: "Staff forwarded this internally.",
        lastCanonicalEventId: "evt:gmail-internal-only",
        lastEventType: "communication.email.outbound"
      });

      const rebuilt = await context.orchestration.runProjectionRebuildBatch(
        projectionRebuildBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:projection:exclude-internal-only",
          correlationId: "corr:projection:exclude-internal-only",
          traceId: null,
          batchId: "batch:projection:exclude-internal-only",
          syncStateId: "sync:projection:exclude-internal-only",
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: [contactId],
          includeReviewOverlayRefresh: true
        })
      );

      expect(rebuilt.outcome).toBe("succeeded");
      if (rebuilt.outcome !== "succeeded") {
        throw new Error("Expected internal-only rebuild to succeed.");
      }

      expect(rebuilt.rebuiltInboxRows).toBe(0);
      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("stores forwarded inbound events while leaving queue-driving inbox state untouched", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      const baseline = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-baseline-outbound",
          occurredAt: "2026-03-31T17:00:00.000Z",
          receivedAt: "2026-03-31T17:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-baseline-outbound.json",
          checksum: "checksum:baseline:outbound",
          snippet: "Baseline outbound message",
          snippetClean: "Baseline outbound message",
          bodyTextPreview: "Baseline outbound message",
          crossProviderCollapseKey: "collapse:baseline:outbound"
        })
      );

      expect(baseline.outcome).toBe("normalized");

      const inboxBefore = await context.repositories.inboxProjection.findByContactId(
        contactId
      );

      const forwarded = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-forwarded-inbound",
          direction: "inbound",
          occurredAt: "2026-03-31T18:00:00.000Z",
          receivedAt: "2026-03-31T18:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-forwarded-inbound.json",
          checksum: "checksum:forwarded:inbound",
          subject: "Fwd: Volunteer intro",
          snippet: "Forwarded volunteer intro",
          snippetClean: "Forwarded volunteer intro",
          bodyTextPreview: "Please meet this volunteer.",
          crossProviderCollapseKey: "collapse:forwarded:inbound"
        })
      );

      expect(forwarded.outcome).toBe("normalized");
      if (forwarded.outcome !== "normalized" || forwarded.canonicalEventId === null) {
        throw new Error("Expected forwarded inbound ingest to persist a canonical event.");
      }
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(2);
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(2);

      const canonicalEvent = await context.repositories.canonicalEvents.findById(
        forwarded.canonicalEventId
      );
      const timelineRow = await context.repositories.timelineProjection.findByCanonicalEventId(
        forwarded.canonicalEventId
      );
      const inboxAfter = await context.repositories.inboxProjection.findByContactId(
        contactId
      );

      expect(canonicalEvent?.provenance).toMatchObject({
        inboxProjectionExclusionReason: "forwarded_chain"
      });
      expect(timelineRow).toMatchObject({
        canonicalEventId: forwarded.canonicalEventId,
        eventType: "communication.email.inbound"
      });
      expect(inboxAfter).toEqual(inboxBefore);
      expect(inboxAfter).toMatchObject({
        bucket: "Opened",
        lastInboundAt: null,
        lastOutboundAt: "2026-03-31T17:00:00.000Z",
        lastActivityAt: "2026-03-31T17:00:00.000Z"
      });
    } finally {
      await context.dispose();
    }
  });

  it("stores forwarded outbound events while leaving inbox recency and bucket state unchanged", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      const baseline = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-baseline-inbound",
          direction: "inbound",
          occurredAt: "2026-03-31T17:00:00.000Z",
          receivedAt: "2026-03-31T17:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-baseline-inbound.json",
          checksum: "checksum:baseline:inbound",
          subject: "Question about training",
          snippet: "Can you confirm the training time?",
          snippetClean: "Can you confirm the training time?",
          bodyTextPreview: "Can you confirm the training time?",
          crossProviderCollapseKey: "collapse:baseline:inbound"
        })
      );

      expect(baseline.outcome).toBe("normalized");

      const inboxBefore = await context.repositories.inboxProjection.findByContactId(
        contactId
      );

      const forwarded = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-forwarded-outbound",
          direction: "outbound",
          occurredAt: "2026-03-31T18:00:00.000Z",
          receivedAt: "2026-03-31T18:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-forwarded-outbound.json",
          checksum: "checksum:forwarded:outbound",
          subject: "Volunteer follow-up",
          snippet: "Forwarded details about a volunteer.",
          snippetClean: "Forwarded details about a volunteer.",
          bodyTextPreview: [
            "---------- Forwarded message ---------",
            "From: Someone Else <someone@example.org>",
            "",
            "Looping this along for reference."
          ].join("\n"),
          crossProviderCollapseKey: "collapse:forwarded:outbound"
        })
      );

      expect(forwarded.outcome).toBe("normalized");
      if (forwarded.outcome !== "normalized" || forwarded.canonicalEventId === null) {
        throw new Error("Expected forwarded outbound ingest to persist a canonical event.");
      }
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(2);
      await expect(context.repositories.timelineProjection.countAll()).resolves.toBe(2);

      const canonicalEvent = await context.repositories.canonicalEvents.findById(
        forwarded.canonicalEventId
      );
      const timelineRow = await context.repositories.timelineProjection.findByCanonicalEventId(
        forwarded.canonicalEventId
      );
      const inboxAfter = await context.repositories.inboxProjection.findByContactId(
        contactId
      );

      expect(canonicalEvent?.provenance).toMatchObject({
        inboxProjectionExclusionReason: "forwarded_chain"
      });
      expect(timelineRow).toMatchObject({
        canonicalEventId: forwarded.canonicalEventId,
        eventType: "communication.email.outbound"
      });
      expect(inboxAfter).toEqual(inboxBefore);
      expect(inboxAfter).toMatchObject({
        bucket: "New",
        lastInboundAt: "2026-03-31T17:00:00.000Z",
        lastOutboundAt: null,
        lastActivityAt: "2026-03-31T17:00:00.000Z"
      });
    } finally {
      await context.dispose();
    }
  });

  it("continues to let non-forwarded Gmail messages drive inbox projection state", async () => {
    const context = await createTestWorkerContext({
      capture: createEmptyCapturePorts()
    });

    try {
      await seedContact(context);

      const baseline = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-non-forwarded-baseline",
          occurredAt: "2026-03-31T17:00:00.000Z",
          receivedAt: "2026-03-31T17:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-non-forwarded-baseline.json",
          checksum: "checksum:non-forwarded:baseline",
          snippet: "Baseline outbound message",
          snippetClean: "Baseline outbound message",
          bodyTextPreview: "Baseline outbound message",
          crossProviderCollapseKey: "collapse:non-forwarded:baseline"
        })
      );

      expect(baseline.outcome).toBe("normalized");

      const inbound = await context.ingest.ingestGmailHistoricalRecord(
        buildGmailMessageRecord({
          recordId: "gmail-non-forwarded-inbound",
          direction: "inbound",
          occurredAt: "2026-03-31T18:00:00.000Z",
          receivedAt: "2026-03-31T18:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-non-forwarded-inbound.json",
          checksum: "checksum:non-forwarded:inbound",
          subject: "Volunteer replied",
          snippet: "This is a normal inbox-driving reply.",
          snippetClean: "This is a normal inbox-driving reply.",
          bodyTextPreview: "This is a normal inbox-driving reply.",
          crossProviderCollapseKey: "collapse:non-forwarded:inbound"
        })
      );

      expect(inbound.outcome).toBe("normalized");
      if (inbound.outcome !== "normalized" || inbound.canonicalEventId === null) {
        throw new Error("Expected normal inbound ingest to persist a canonical event.");
      }

      const canonicalEvent = await context.repositories.canonicalEvents.findById(
        inbound.canonicalEventId
      );
      const inboxAfter = await context.repositories.inboxProjection.findByContactId(
        contactId
      );

      expect(canonicalEvent?.provenance.inboxProjectionExclusionReason).toBeUndefined();
      expect(inboxAfter).toMatchObject({
        bucket: "New",
        lastInboundAt: "2026-03-31T18:00:00.000Z",
        lastActivityAt: "2026-03-31T18:00:00.000Z",
        snippet: "This is a normal inbox-driving reply."
      });
    } finally {
      await context.dispose();
    }
  });

  it("produces parity snapshots and explicit cutover blockers without auto-resolving them", async () => {
    const gmailRecord = buildGmailMessageRecord();
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([gmailRecord], {
          nextCursor: "gmail:cursor:parity",
          checkpoint: "gmail:checkpoint:parity"
        })
      );

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const ingested = await context.orchestration.runGmailHistoricalCaptureBatch(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:parity-source",
          correlationId: "corr:gmail:parity-source",
          traceId: null,
          batchId: "batch:gmail:parity-source",
          syncStateId: "sync:gmail:parity-source",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-02T00:00:00.000Z",
          recordIds: [gmailRecord.recordId],
          maxRecords: 10
        })
      );

      expect(ingested.outcome).toBe("succeeded");
      await context.persistence.saveSyncState({
        id: "sync:gmail:live:1",
        scope: "provider",
        provider: "gmail",
        jobType: "live_ingest",
        cursor: "cursor:gmail:live:1",
        windowStart: "2026-01-02T00:00:00.000Z",
        windowEnd: "2026-01-02T01:00:00.000Z",
        status: "succeeded",
        parityPercent: 100,
        freshnessP95Seconds: 60,
        freshnessP99Seconds: 120,
        lastSuccessfulAt: "2026-01-02T01:00:00.000Z",
        consecutiveFailureCount: 0,
        leaseOwner: null,
        heartbeatAt: null,
        deadLetterCount: 0
      });

      const parity = await context.orchestration.runParityCheckBatch(
        parityCheckBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:parity:1",
          correlationId: "corr:parity:1",
          traceId: null,
          batchId: "batch:parity:1",
          syncStateId: "sync:parity:1",
          attempt: 1,
          maxAttempts: 3,
          jobType: "parity_snapshot",
          checkpointId: "checkpoint:parity:1",
          providers: ["gmail"],
          sampleContactIds: [contactId],
          sampleSize: 10,
          queueParityThresholdPercent: 100,
          timelineParityThresholdPercent: 100,
          evaluatedAt: "2026-01-02T02:00:00.000Z"
        })
      );

      expect(parity.outcome).toBe("succeeded");
      if (parity.outcome !== "succeeded") {
        throw new Error("Expected parity check to succeed.");
      }

      expect(parity.metrics.canonicalEventCount).toBe(1);
      expect(parity.metrics.timelineProjectionCount).toBe(1);
      expect(parity.metrics.inboxProjectionCount).toBe(1);
      expect(parity.metrics.queueRowParityPercent).toBe(100);
      expect(parity.metrics.timelineEventParityPercent).toBe(100);
      expect(parity.discrepancies).toEqual([]);
      expect(parity.syncState.scope).toBe("orchestration");
      expect(parity.syncState.provider).toBeNull();

      const cutover = await context.orchestration.runCutoverCheckpointBatch(
        cutoverCheckpointBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:cutover:1",
          correlationId: "corr:cutover:1",
          traceId: null,
          batchId: "batch:cutover:1",
          syncStateId: "sync:cutover:1",
          attempt: 1,
          maxAttempts: 3,
          jobType: "final_delta_sync",
          checkpointId: "checkpoint:cutover:1",
          providers: ["gmail"],
          evaluatedAt: "2026-01-02T02:30:00.000Z",
          requireHistoricalBackfillComplete: true,
          requireLiveIngestCoverage: true
        })
      );

      expect(cutover.outcome).toBe("succeeded");
      if (cutover.outcome !== "succeeded") {
        throw new Error("Expected cutover checkpoint to succeed.");
      }

      expect(cutover.ready).toBe(true);
      expect(cutover.syncState.scope).toBe("orchestration");
      expect(cutover.syncState.provider).toBeNull();
      expect(cutover.syncSnapshots).toHaveLength(1);
      expect(cutover.syncSnapshots[0]?.historicalBackfill?.status).toBe("succeeded");
      expect(cutover.syncSnapshots[0]?.liveIngest?.status).toBe("succeeded");
      expect(cutover.syncSnapshots[0]?.liveIngest?.freshnessP95Seconds).toBe(60);
      expect(cutover.syncSnapshots[0]?.liveIngest?.freshnessP99Seconds).toBe(120);
      expect(cutover.discrepancies).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("surfaces deferred, retryable, non-retryable, and dead-letter outcomes explicitly", async () => {
    const deferredCapture = createEmptyCapturePorts();
    deferredCapture.mailchimp.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "audience_mutation" as const,
            recordId: "audience-1"
          }
        ])
      );
    const deferredContext = await createTestWorkerContext({
      capture: deferredCapture
    });

    try {
      const deferred = await deferredContext.orchestration.runMailchimpHistoricalCaptureBatch(
        mailchimpHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:mailchimp:deferred:1",
          correlationId: "corr:mailchimp:deferred:1",
          traceId: null,
          batchId: "batch:mailchimp:deferred:1",
          syncStateId: "sync:mailchimp:deferred:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "mailchimp",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-02T00:00:00.000Z",
          recordIds: [],
          maxRecords: 10
        })
      );

      expect(deferred.outcome).toBe("succeeded");
      if (deferred.outcome !== "succeeded") {
        throw new Error("Expected deferred Mailchimp batch to succeed.");
      }

      expect(deferred.summary.deferred).toBe(1);
      expect(deferred.ingestResults[0]?.outcome).toBe("deferred");
    } finally {
      await deferredContext.dispose();
    }

    const retryableCapture = createEmptyCapturePorts();
    retryableCapture.gmail.captureHistoricalBatch = () => {
      throw new Stage1RetryableJobError("Temporary Gmail capture failure.");
    };
    const retryableContext = await createTestWorkerContext({
      capture: retryableCapture
    });

    try {
      const retryable = await retryableContext.orchestration.runGmailHistoricalCaptureBatch(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:retryable:1",
          correlationId: "corr:gmail:retryable:1",
          traceId: null,
          batchId: "batch:gmail:retryable:1",
          syncStateId: "sync:gmail:retryable:1",
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
          maxRecords: 10
        })
      );

      expect(retryable.outcome).toBe("failed");
      if (retryable.outcome !== "failed") {
        throw new Error("Expected retryable capture to fail.");
      }

      expect(retryable.failure.disposition).toBe("retryable");
      expect(retryable.syncState.status).toBe("failed");

      const deadLetter = await retryableContext.orchestration.runGmailHistoricalCaptureBatch(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:dead-letter:1",
          correlationId: "corr:gmail:dead-letter:1",
          traceId: null,
          batchId: "batch:gmail:dead-letter:1",
          syncStateId: "sync:gmail:dead-letter:1",
          attempt: 3,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          recordIds: [],
          maxRecords: 10
        })
      );

      expect(deadLetter.outcome).toBe("failed");
      if (deadLetter.outcome !== "failed") {
        throw new Error("Expected exhausted retry capture to fail.");
      }

      expect(deadLetter.failure.disposition).toBe("dead_letter");
      expect(deadLetter.syncState.status).toBe("quarantined");
      expect(deadLetter.syncState.deadLetterCount).toBe(1);
    } finally {
      await retryableContext.dispose();
    }

    const nonRetryableCapture = createEmptyCapturePorts();
    nonRetryableCapture.salesforce.captureHistoricalBatch = () => {
      throw new Stage1NonRetryableJobError("Unsupported Salesforce batch shape.");
    };
    const nonRetryableContext = await createTestWorkerContext({
      capture: nonRetryableCapture
    });

    try {
      const nonRetryable = await nonRetryableContext.orchestration.runSalesforceHistoricalCaptureBatch(
        salesforceHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:salesforce:non-retryable:1",
          correlationId: "corr:salesforce:non-retryable:1",
          traceId: null,
          batchId: "batch:salesforce:non-retryable:1",
          syncStateId: "sync:salesforce:non-retryable:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "salesforce",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: null,
          windowEnd: null,
          recordIds: [],
          maxRecords: 10
        })
      );

      expect(nonRetryable.outcome).toBe("failed");
      if (nonRetryable.outcome !== "failed") {
        throw new Error("Expected non-retryable capture to fail.");
      }

      expect(nonRetryable.failure.disposition).toBe("non_retryable");
      expect(nonRetryable.syncState.status).toBe("failed");
      const auditEvidence = await nonRetryableContext.repositories.auditEvidence.listByEntity({
        entityType: "sync_state",
        entityId: "sync:salesforce:non-retryable:1"
      });

      expect(auditEvidence).toHaveLength(1);
      expect(auditEvidence[0]).toMatchObject({
        entityType: "sync_state",
        entityId: "sync:salesforce:non-retryable:1",
        policyCode: "stage1.sync.failure",
        result: "recorded"
      });
      expect(auditEvidence[0]?.metadataJson).toMatchObject({
        message: "Unsupported Salesforce batch shape.",
        disposition: "non_retryable",
        retryable: false
      });
    } finally {
      await nonRetryableContext.dispose();
    }
  });
});
