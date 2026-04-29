import { describe, expect, it } from "vitest";

import {
  gmailLiveCaptureBatchPayloadSchema,
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema
} from "@as-comms/contracts";

import {
  buildCapturedBatch,
  createEmptyCapturePorts,
  createTestWorkerContext
} from "./helpers.js";
import { createStage1GmailMboxImportService } from "../src/ops/gmail-mbox.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";
const volunteerEmail = "volunteer@example.org";
const historicalGmailMbox = `From MAILER-DAEMON Fri Jan 04 00:00:00 2026
Date: Sun, 04 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply
Message-ID: <historical-1@example.org>

Reply from the volunteer
`;

describe("Stage 1 narrowed Gmail + Salesforce launch scope", () => {
  it("lands historical Gmail and Salesforce records in one volunteer timeline", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "contact_snapshot" as const,
            recordId: salesforceContactId,
            salesforceContactId,
            displayName: "Stage One Volunteer",
            primaryEmail: volunteerEmail,
            primaryPhone: "+15555550123",
            normalizedEmails: [volunteerEmail],
            normalizedPhones: ["+15555550123"],
            volunteerIdPlainValues: ["VOL-123"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            memberships: [
              {
                salesforceId: "a0B-membership-antarctica-historical",
                projectId: "project-antarctica",
                expeditionId: "expedition-antarctica",
                role: "volunteer",
                status: "active"
              }
            ]
          },
          {
            recordType: "lifecycle_milestone" as const,
            recordId: "lifecycle-training-completed",
            salesforceContactId,
            milestone: "completed_training" as const,
            sourceField:
              "Expedition_Members__c.Date_Training_Completed__c" as const,
            occurredAt: "2026-01-02T00:00:00.000Z",
            receivedAt: "2026-01-02T00:01:00.000Z",
            payloadRef:
              "capture://salesforce/lifecycle-training-completed.json",
            checksum: "checksum-lifecycle-training-completed",
            normalizedEmails: [volunteerEmail],
            normalizedPhones: [],
            volunteerIdPlainValues: ["VOL-123"],
            routing: {
              required: true,
              projectId: "project-antarctica",
              expeditionId: "expedition-antarctica"
            }
          },
          {
            recordType: "task_communication" as const,
            recordId: "task-outbound-1",
            channel: "email" as const,
            salesforceContactId,
            occurredAt: "2026-01-03T00:00:00.000Z",
            receivedAt: "2026-01-03T00:01:00.000Z",
            payloadRef: "capture://salesforce/task-outbound-1.json",
            checksum: "checksum-task-outbound-1",
            snippet: "Logged outbound follow-up",
            normalizedEmails: [volunteerEmail],
            normalizedPhones: [],
            volunteerIdPlainValues: ["VOL-123"],
            supportingRecords: [],
            crossProviderCollapseKey: null,
            routing: {
              required: false,
              projectId: "project-antarctica",
              expeditionId: "expedition-antarctica"
            }
          }
        ])
      );
    const context = await createTestWorkerContext({ capture });

    try {
      const gmailMboxImporter = createStage1GmailMboxImportService({
        ingest: context.ingest,
        persistence: context.persistence,
        syncState: context.syncState,
        now: () => new Date("2026-01-04T00:01:00.000Z")
      });
      const salesforceResult =
        await context.orchestration.runSalesforceHistoricalCaptureBatch(
          salesforceHistoricalCaptureBatchPayloadSchema.parse({
            version: 1,
            jobId: "job:salesforce:historical:acceptance",
            correlationId: "corr:salesforce:historical:acceptance",
            traceId: null,
            batchId: "batch:salesforce:historical:acceptance",
            syncStateId: "sync:salesforce:historical:acceptance",
            attempt: 1,
            maxAttempts: 3,
            provider: "salesforce",
            mode: "historical",
            jobType: "historical_backfill",
            cursor: null,
            checkpoint: null,
            windowStart: "2026-01-01T00:00:00.000Z",
            windowEnd: "2026-01-05T00:00:00.000Z",
            recordIds: [],
            maxRecords: 100
          })
        );
      const gmailResult = await gmailMboxImporter.importMbox({
        mboxText: historicalGmailMbox,
        mboxPath: "/tmp/project-antarctica.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        syncStateId: "sync:gmail:historical:acceptance",
        correlationId: "corr:gmail:historical:acceptance",
        traceId: null,
        receivedAt: "2026-01-04T00:01:00.000Z"
      });

      expect(salesforceResult.outcome).toBe("succeeded");
      expect(gmailResult.outcome).toBe("succeeded");

      await expect(
        context.repositories.contacts.findBySalesforceContactId(salesforceContactId)
      ).resolves.toMatchObject({
        id: contactId,
        salesforceContactId
      });

      const timelineRows =
        await context.repositories.timelineProjection.listByContactId(contactId);
      expect(timelineRows).toHaveLength(3);
      expect(timelineRows.map((row) => row.eventType)).toEqual([
        "lifecycle.completed_training",
        "communication.email.outbound",
        "communication.email.inbound"
      ]);
      expect(timelineRows.map((row) => row.summary)).toEqual([
        "Volunteer completed training",
        "Auto email sent",
        "Inbound email received"
      ]);

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toMatchObject({
        bucket: "New",
        contactId,
        hasUnresolved: false
      });
    } finally {
      await context.dispose();
    }
  });

  it("uses the same normalization path for live Gmail polling and live Salesforce updates", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "contact_snapshot" as const,
            recordId: salesforceContactId,
            salesforceContactId,
            displayName: "Stage One Volunteer",
            primaryEmail: volunteerEmail,
            primaryPhone: "+15555550123",
            normalizedEmails: [volunteerEmail],
            normalizedPhones: ["+15555550123"],
            volunteerIdPlainValues: ["VOL-123"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-05T00:00:00.000Z",
            memberships: [
              {
                salesforceId: "a0B-membership-antarctica-live",
                projectId: "project-antarctica",
                expeditionId: "expedition-antarctica",
                role: "volunteer",
                status: "active"
              }
            ]
          },
          {
            recordType: "task_communication" as const,
            recordId: "task-live-1",
            channel: "email" as const,
            salesforceContactId,
            occurredAt: "2026-01-05T00:00:00.000Z",
            receivedAt: "2026-01-05T00:01:00.000Z",
            payloadRef: "capture://salesforce/task-live-1.json",
            checksum: "checksum-task-live-1",
            snippet: "Outbound follow-up from Task",
            normalizedEmails: [volunteerEmail],
            normalizedPhones: [],
            volunteerIdPlainValues: ["VOL-123"],
            supportingRecords: [],
            crossProviderCollapseKey: null,
            routing: {
              required: false,
              projectId: "project-antarctica",
              expeditionId: "expedition-antarctica"
            }
          }
        ])
      );
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "message" as const,
            recordId: "gmail-live-inbound-1",
            direction: "inbound" as const,
            occurredAt: "2026-01-05T00:02:00.000Z",
            receivedAt: "2026-01-05T00:03:00.000Z",
            payloadRef: "capture://gmail/gmail-live-inbound-1.json",
            checksum: "checksum-gmail-live-inbound-1",
            snippet: "Live reply from the volunteer",
            threadId: "thread-live-1",
            rfc822MessageId: "<live-1@example.org>",
            capturedMailbox: "volunteers@example.org",
            projectInboxAlias: "project-antarctica@example.org",
            normalizedParticipantEmails: [volunteerEmail],
            salesforceContactId,
            volunteerIdPlainValues: [],
            normalizedPhones: [],
            supportingRecords: [],
            crossProviderCollapseKey: null
          }
        ])
      );

    const context = await createTestWorkerContext({ capture });

    try {
      const salesforceResult = await context.orchestration.runSalesforceLiveCaptureBatch(
        salesforceLiveCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:salesforce:live:acceptance",
          correlationId: "corr:salesforce:live:acceptance",
          traceId: null,
          batchId: "batch:salesforce:live:acceptance",
          syncStateId: "sync:salesforce:live:acceptance",
          attempt: 1,
          maxAttempts: 3,
          provider: "salesforce",
          mode: "live",
          jobType: "live_ingest",
          cursor: "salesforce:cursor:1",
          checkpoint: "salesforce:checkpoint:1",
          windowStart: "2026-01-05T00:00:00.000Z",
          windowEnd: "2026-01-05T00:05:00.000Z",
          recordIds: [],
          maxRecords: 100
        })
      );
      const gmailResult = await context.orchestration.runGmailLiveCaptureBatch(
        gmailLiveCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:live:acceptance",
          correlationId: "corr:gmail:live:acceptance",
          traceId: null,
          batchId: "batch:gmail:live:acceptance",
          syncStateId: "sync:gmail:live:acceptance",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "live",
          jobType: "live_ingest",
          cursor: "gmail:cursor:1",
          checkpoint: "gmail:checkpoint:1",
          windowStart: "2026-01-05T00:00:00.000Z",
          windowEnd: "2026-01-05T00:05:00.000Z",
          recordIds: [],
          maxRecords: 100
        })
      );

      expect(salesforceResult.outcome).toBe("succeeded");
      expect(gmailResult.outcome).toBe("succeeded");

      const timelineRows =
        await context.repositories.timelineProjection.listByContactId(contactId);
      expect(timelineRows.map((row) => row.eventType)).toEqual([
        "communication.email.outbound",
        "communication.email.inbound"
      ]);

      await expect(
        context.repositories.syncState.findById("sync:salesforce:live:acceptance")
      ).resolves.toMatchObject({
        scope: "provider",
        provider: "salesforce",
        jobType: "live_ingest",
        status: "succeeded"
      });
      await expect(
        context.repositories.syncState.findById("sync:gmail:live:acceptance")
      ).resolves.toMatchObject({
        scope: "provider",
        provider: "gmail",
        jobType: "live_ingest",
        status: "succeeded"
      });
    } finally {
      await context.dispose();
    }
  });
});
