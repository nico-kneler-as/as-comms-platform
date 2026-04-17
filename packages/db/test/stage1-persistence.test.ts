import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("Stage 1 persistence service", () => {
  it("deduplicates source evidence and keeps conflicting replays explicit", async () => {
    const { persistence, repositories } = await createTestStage1Context();

    const firstResult = await persistence.recordSourceEvidence({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1"
    });

    const duplicateResult = await persistence.recordSourceEvidence({
      id: "sev_2",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:02:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1"
    });

    const conflictResult = await persistence.recordSourceEvidence({
      id: "sev_3",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:03:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1-v2.json",
      idempotencyKey: "gmail:message:gmail-message-1-v2",
      checksum: "checksum-2"
    });

    if (firstResult.outcome === "conflict") {
      throw new Error("Expected the first source evidence write to insert cleanly.");
    }

    expect(firstResult.outcome).toBe("inserted");
    expect(duplicateResult).toEqual({
      outcome: "duplicate",
      record: firstResult.record
    });
    expect(conflictResult.outcome).toBe("conflict");
    if (conflictResult.outcome === "conflict") {
      expect(conflictResult.reason).toBe("provider_record_mismatch");
      expect(conflictResult.conflictingRecords).toEqual([firstResult.record]);
    }

    await expect(
      repositories.sourceEvidence.listByProviderRecord({
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1"
      })
    ).resolves.toEqual([firstResult.record]);
  });

  it("keeps live Gmail re-polls duplicate-safe when Subject is newly fetched", async () => {
    const { persistence } = await createTestStage1Context();
    const legacyChecksumPayload = {
      id: "gmail-live-1",
      threadId: "thread-live-1",
      internalDate: String(Date.parse("2026-01-05T00:00:00.000Z")),
      snippet: "Outbound follow-up from volunteers",
      headers: {
        Date: "Mon, 05 Jan 2026 00:00:00 +0000",
        From: "Project Oceans <project-oceans@example.org>",
        To: "Volunteer <volunteer@example.org>",
        "Message-ID": "<gmail-live-1@example.org>"
      }
    };
    const replayChecksumPayload = {
      ...legacyChecksumPayload,
      headers: {
        ...legacyChecksumPayload.headers,
        Subject: "Checking in"
      }
    };
    const legacyChecksum = sha256Json(legacyChecksumPayload);
    const replayCompatibilityChecksum = sha256Json({
      ...replayChecksumPayload,
      headers: Object.fromEntries(
        Object.entries(replayChecksumPayload.headers).filter(
          ([name]) => name !== "Subject"
        )
      )
    });

    expect(replayCompatibilityChecksum).toBe(legacyChecksum);

    const firstResult = await persistence.recordSourceEvidence({
      id: "sev_live_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-live-1",
      receivedAt: "2026-01-05T00:01:00.000Z",
      occurredAt: "2026-01-05T00:00:00.000Z",
      payloadRef: "gmail://volunteers@example.org/messages/gmail-live-1",
      idempotencyKey: "gmail:message:gmail-live-1",
      checksum: legacyChecksum
    });

    if (firstResult.outcome === "conflict") {
      throw new Error("Expected the first live Gmail source evidence write to insert.");
    }

    const replayResult = await persistence.recordSourceEvidence({
      id: "sev_live_2",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-live-1",
      receivedAt: "2026-01-05T00:02:00.000Z",
      occurredAt: "2026-01-05T00:00:00.000Z",
      payloadRef: "gmail://volunteers@example.org/messages/gmail-live-1",
      idempotencyKey: "gmail:message:gmail-live-1",
      checksum: replayCompatibilityChecksum
    });

    expect(replayResult).toEqual({
      outcome: "duplicate",
      record: firstResult.record
    });
  });

  it("deduplicates canonical events by idempotency key and blocks mismatched replays", async () => {
    const { persistence } = await createTestStage1Context();

    await persistence.upsertCanonicalContact({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const sourceEvidenceResult = await persistence.recordSourceEvidence({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1"
    });

    if (sourceEvidenceResult.outcome === "conflict") {
      throw new Error("Expected source evidence fixture to insert cleanly.");
    }

    const canonicalEvent = {
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.inbound" as const,
      channel: "email" as const,
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceId: sourceEvidenceResult.record.id,
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail" as const,
        primarySourceEvidenceId: sourceEvidenceResult.record.id,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source" as const,
        sourceRecordType: null,
        sourceRecordId: null,
        messageKind: null,
        campaignRef: null,
        threadRef: null,
        direction: null
      },
      reviewState: "clear" as const
    };

    const firstResult = await persistence.persistCanonicalEvent(canonicalEvent);
    const duplicateResult = await persistence.persistCanonicalEvent({
      ...canonicalEvent,
      id: "evt_2"
    });
    const conflictResult = await persistence.persistCanonicalEvent({
      ...canonicalEvent,
      id: "evt_3",
      reviewState: "needs_routing_review"
    });

    if (firstResult.outcome === "conflict") {
      throw new Error("Expected the first canonical event write to insert cleanly.");
    }

    expect(firstResult.outcome).toBe("inserted");
    expect(duplicateResult).toEqual({
      outcome: "duplicate",
      record: firstResult.record
    });
    expect(conflictResult.outcome).toBe("conflict");
    if (conflictResult.outcome === "conflict") {
      expect(conflictResult.reason).toBe("idempotency_key_mismatch");
      expect(conflictResult.existing).toEqual(firstResult.record);
    }
  });

  it("uses the Salesforce contact anchor when upserting canonical contact state", async () => {
    const { persistence, repositories } = await createTestStage1Context();

    const firstContact = await persistence.upsertCanonicalContact({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: null,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const mergedContact = await persistence.upsertCanonicalContact({
      id: "contact_2",
      salesforceContactId: "003-stage1",
      displayName: "Updated Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });

    expect(mergedContact.id).toBe(firstContact.id);
    expect(mergedContact.createdAt).toBe(firstContact.createdAt);
    expect(mergedContact.primaryEmail).toBe("volunteer@example.org");
    expect(mergedContact.primaryPhone).toBe("+15555550123");

    await expect(repositories.contacts.findById(firstContact.id)).resolves.toEqual(
      mergedContact
    );
  });

  it("persists projections, sync state, and audit evidence through the service layer", async () => {
    const { persistence, repositories } = await createTestStage1Context();

    await persistence.upsertCanonicalContact({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const sourceEvidenceResult = await persistence.recordSourceEvidence({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1"
    });

    if (sourceEvidenceResult.outcome === "conflict") {
      throw new Error("Expected source evidence fixture to insert cleanly.");
    }

    const eventResult = await persistence.persistCanonicalEvent({
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceId: sourceEvidenceResult.record.id,
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: sourceEvidenceResult.record.id,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: null,
        sourceRecordId: null,
        messageKind: null,
        campaignRef: null,
        threadRef: null,
        direction: null
      },
      reviewState: "clear"
    });

    if (eventResult.outcome === "conflict") {
      throw new Error("Expected canonical event fixture to insert cleanly.");
    }

    const inbox = await persistence.saveInboxProjection({
      contactId: "contact_1",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      snippet: "Outbound follow-up",
      lastCanonicalEventId: eventResult.record.id,
      lastEventType: "communication.email.outbound"
    });

    const timeline = await persistence.saveTimelineProjection({
      id: "timeline_1",
      contactId: "contact_1",
      canonicalEventId: eventResult.record.id,
      occurredAt: "2026-01-01T00:00:00.000Z",
      sortKey: "2026-01-01T00:00:00.000Z::evt_1",
      eventType: "communication.email.outbound",
      summary: "Outbound email sent",
      channel: "email",
      primaryProvider: "gmail",
      reviewState: "clear"
    });

    const sync = await persistence.saveSyncState({
      id: "sync_1",
      scope: "provider",
      provider: "gmail",
      jobType: "live_ingest",
      cursor: "cursor-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-01T01:00:00.000Z",
      status: "succeeded",
      parityPercent: 100,
      freshnessP95Seconds: 60,
      freshnessP99Seconds: 120,
      lastSuccessfulAt: "2026-01-01T01:00:00.000Z",
      deadLetterCount: 0
    });

    const audit = await persistence.recordAuditEvidence({
      id: "audit_1",
      actorType: "system",
      actorId: "stage1-service-test",
      action: "projection_refreshed",
      entityType: "contact",
      entityId: "contact_1",
      occurredAt: "2026-01-01T01:05:00.000Z",
      result: "recorded",
      policyCode: "stage1.service.test",
      metadataJson: {
        canonicalEventId: eventResult.record.id
      }
    });

    expect(inbox.contactId).toBe("contact_1");
    expect(timeline.canonicalEventId).toBe(eventResult.record.id);
    expect(sync.parityPercent).toBe(100);
    expect(sync.freshnessP95Seconds).toBe(60);
    expect(sync.freshnessP99Seconds).toBe(120);
    await expect(
      repositories.inboxProjection.findByContactId("contact_1")
    ).resolves.toEqual(inbox);
    await expect(
      repositories.timelineProjection.findByCanonicalEventId(
        eventResult.record.id
      )
    ).resolves.toEqual(timeline);
    await expect(
      repositories.syncState.findLatest({
        scope: "provider",
        provider: "gmail",
        jobType: "live_ingest"
      })
    ).resolves.toEqual(sync);
    await expect(
      repositories.auditEvidence.listByEntity({
        entityType: "contact",
        entityId: "contact_1"
      })
    ).resolves.toEqual([audit]);
  });
});
