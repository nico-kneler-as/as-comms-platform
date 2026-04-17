import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        role: "volunteer",
        status: "active",
        source: "salesforce"
      }
    ]
  });
}

function buildGmailMessageRecord() {
  return {
    recordType: "message" as const,
    recordId: "gmail-message-1",
    direction: "outbound" as const,
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:01:00.000Z",
    payloadRef: "payloads/gmail/gmail-message-1.json",
    checksum: "checksum-1",
    snippet: "Following up by email",
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
    crossProviderCollapseKey: "collapse:email:1"
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
      const importedRecords = importGmailMboxRecords({
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
      const importedRecord = importGmailMboxRecords({
        mboxText,
        mboxPath,
        capturedMailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z"
      })[0];

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
          source: "salesforce"
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
      await expect(
        nonRetryableContext.repositories.auditEvidence.listByEntity({
          entityType: "sync_state",
          entityId: "sync:salesforce:non-retryable:1"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityType: "sync_state",
          entityId: "sync:salesforce:non-retryable:1",
          policyCode: "stage1.sync.failure",
          result: "recorded",
          metadataJson: expect.objectContaining({
            message: "Unsupported Salesforce batch shape.",
            disposition: "non_retryable",
            retryable: false
          })
        })
      ]);
    } finally {
      await nonRetryableContext.dispose();
    }
  });
});
