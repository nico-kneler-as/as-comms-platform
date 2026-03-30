import { describe, expect, it } from "vitest";

import {
  gmailHistoricalCaptureBatchJobName,
  gmailHistoricalCaptureBatchPayloadSchema
} from "@as-comms/contracts";

import { createTaskList } from "../src/tasks.js";
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
    memberships: []
  });
}

describe("Stage 1 worker runtime task registration", () => {
  it("registers Stage 1 task names and executes them through the existing orchestration path", async () => {
    const gmailRecord = {
      recordType: "message" as const,
      recordId: "gmail-message-runtime-1",
      direction: "inbound" as const,
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "capture://gmail/gmail-message-runtime-1",
      checksum: "checksum-runtime-1",
      snippet: "Hello from runtime",
      threadId: "thread-runtime-1",
      rfc822MessageId: "<runtime-1@example.org>",
      normalizedParticipantEmails: ["volunteer@example.org"],
      salesforceContactId,
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [],
      crossProviderCollapseKey: "collapse:runtime:1"
    };
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([gmailRecord], {
          nextCursor: "gmail:cursor:runtime:1",
          checkpoint: "gmail:checkpoint:runtime:1"
        })
      );

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const taskList = createTaskList(context.orchestration);
      const task = taskList[gmailHistoricalCaptureBatchJobName];

      expect(typeof task).toBe("function");
      if (task === undefined) {
        throw new Error("Expected Gmail historical task to be registered.");
      }

      await task(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:runtime:1",
          correlationId: "corr:gmail:runtime:1",
          traceId: null,
          batchId: "batch:gmail:runtime:1",
          syncStateId: "sync:gmail:runtime:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-01T01:00:00.000Z",
          recordIds: [gmailRecord.recordId],
          maxRecords: 10
        }),
        {} as never
      );

      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      await expect(
        context.repositories.syncState.findById("sync:gmail:runtime:1")
      ).resolves.toMatchObject({
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        status: "succeeded"
      });
    } finally {
      await context.dispose();
    }
  });
});
