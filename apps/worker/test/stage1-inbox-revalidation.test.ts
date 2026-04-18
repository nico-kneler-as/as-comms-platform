import { describe, expect, it, vi } from "vitest";

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

describe("Stage 1 worker inbox revalidation", () => {
  it("revalidates touched inbox contacts after a successful capture batch", async () => {
    const revalidateInboxViews = vi.fn().mockResolvedValue(undefined);
    const capture = createEmptyCapturePorts();
    capture.gmail.captureLiveBatch = () =>
      Promise.resolve(
        buildCapturedBatch([
          {
            recordType: "message" as const,
            recordId: "gmail-message-revalidate-1",
            direction: "inbound" as const,
            occurredAt: "2026-01-01T00:00:00.000Z",
            receivedAt: "2026-01-01T00:01:00.000Z",
            payloadRef: "capture://gmail/gmail-message-revalidate-1",
            checksum: "checksum-revalidate-1",
            snippet: "Hello from inbox revalidation",
            threadId: "thread-revalidate-1",
            rfc822MessageId: "<revalidate-1@example.org>",
            normalizedParticipantEmails: ["volunteer@example.org"],
            salesforceContactId,
            volunteerIdPlainValues: [],
            normalizedPhones: [],
            supportingRecords: [],
            crossProviderCollapseKey: "collapse:revalidate:1"
          }
        ])
      );

    const context = await createTestWorkerContext({
      capture,
      revalidateInboxViews
    });

    try {
      await seedContact(context);

      const result = await context.orchestration.runGmailLiveCaptureBatch({
        version: 1,
        jobId: "job:gmail:revalidate:1",
        correlationId: "corr:gmail:revalidate:1",
        traceId: null,
        batchId: "batch:gmail:revalidate:1",
        syncStateId: "sync:gmail:revalidate:1",
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
        maxRecords: 10
      });

      expect(result.outcome).toBe("succeeded");
      expect(revalidateInboxViews).toHaveBeenCalledWith({
        contactIds: [contactId]
      });
    } finally {
      await context.dispose();
    }
  });
});
