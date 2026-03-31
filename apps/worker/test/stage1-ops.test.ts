import { describe, expect, it } from "vitest";

import {
  gmailLiveCaptureBatchPayloadSchema,
  parityCheckBatchPayloadSchema
} from "@as-comms/contracts";

import { buildStage1EnqueueRequest } from "../src/ops/enqueue.js";
import {
  inspectLatestSyncState,
  inspectSourceEvidenceForProviderRecord,
  inspectStage1Contact
} from "../src/ops/inspect.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";

async function seedInspectableContact(context: TestWorkerContext): Promise<void> {
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
        id: `identity:${contactId}:volunteer`,
        contactId,
        kind: "volunteer_id_plain",
        normalizedValue: "VOL-123",
        isPrimary: false,
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

  await context.normalization.applyNormalizedCanonicalEvent({
    sourceEvidence: {
      id: "source-evidence:gmail:message:gmail-message-ops-1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-ops-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "capture://gmail/gmail-message-ops-1",
      idempotencyKey: "source-evidence:gmail:message:gmail-message-ops-1",
      checksum: "checksum-gmail-message-ops-1"
    },
    canonicalEvent: {
      id: "canonical-event:gmail-message-ops-1",
      eventType: "communication.email.inbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      idempotencyKey: "canonical-event:gmail-message-ops-1",
      summary: "Inbound email received",
      snippet: "Validation reply"
    },
    identity: {
      salesforceContactId,
      volunteerIdPlainValues: ["VOL-123"],
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: []
    },
    supportingSources: []
  });

  await context.persistence.saveSyncState({
    id: "sync:gmail:live:ops",
    scope: "provider",
    provider: "gmail",
    jobType: "live_ingest",
    status: "succeeded",
    cursor: "gmail:cursor:ops",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-01T00:05:00.000Z",
    parityPercent: null,
    lastSuccessfulAt: "2026-01-01T00:05:00.000Z",
    deadLetterCount: 0,
    freshnessP95Seconds: 60,
    freshnessP99Seconds: 120
  });
}

describe("Stage 1 ops helpers", () => {
  it("builds launch-scope parity and capture job payloads with explicit defaults", () => {
    const parityRequest = buildStage1EnqueueRequest("parity-check", {});
    const gmailLiveRequest = buildStage1EnqueueRequest("gmail-live", {
      "window-start": "2026-01-01T00:00:00.000Z",
      "window-end": "2026-01-01T00:05:00.000Z"
    });
    const parityPayload = parityCheckBatchPayloadSchema.parse(parityRequest.payload);
    const gmailLivePayload = gmailLiveCaptureBatchPayloadSchema.parse(
      gmailLiveRequest.payload
    );

    expect(parityRequest.jobName).toBe("stage1.parity.check");
    expect(parityPayload.providers).toEqual(["gmail", "salesforce"]);
    expect(gmailLiveRequest.jobName).toBe("stage1.gmail.capture.live");
    expect(gmailLivePayload.provider).toBe("gmail");
    expect(gmailLivePayload.mode).toBe("live");
    expect(gmailLivePayload.maxRecords).toBe(25);
  });

  it("inspects contact, source-evidence, and sync-state outcomes for launch-scope validation", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedInspectableContact(context);

      const contactInspection = await inspectStage1Contact(context.repositories, {
        salesforceContactId
      });
      const sourceEvidence = await inspectSourceEvidenceForProviderRecord(
        context.repositories,
        {
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-message-ops-1"
        }
      );
      const syncState = await inspectLatestSyncState(context.repositories, {
        scope: "provider",
        provider: "gmail",
        jobType: "live_ingest"
      });

      expect(contactInspection.contact).toMatchObject({
        id: contactId,
        salesforceContactId
      });
      expect(contactInspection.canonicalEvents).toHaveLength(1);
      expect(contactInspection.timelineProjection).toHaveLength(1);
      expect(contactInspection.inboxProjection).toMatchObject({
        bucket: "New"
      });
      expect(sourceEvidence).toHaveLength(1);
      expect(sourceEvidence[0]).toMatchObject({
        provider: "gmail",
        providerRecordId: "gmail-message-ops-1"
      });
      expect(syncState).toMatchObject({
        id: "sync:gmail:live:ops",
        provider: "gmail",
        status: "succeeded",
        freshnessP95Seconds: 60,
        freshnessP99Seconds: 120
      });
    } finally {
      await context.dispose();
    }
  });
});
