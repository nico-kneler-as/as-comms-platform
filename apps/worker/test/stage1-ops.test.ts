import { describe, expect, it } from "vitest";

import {
  gmailLiveCaptureBatchPayloadSchema,
  replayBatchPayloadSchema,
  parityCheckBatchPayloadSchema
} from "@as-comms/contracts";

import { buildStage1EnqueueRequest } from "../src/ops/enqueue.js";
import { parseCliFlags } from "../src/ops/helpers.js";
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
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    projectDimensions: [
      {
        projectId: "project-stage1",
        projectName: "Project Stage 1",
        source: "salesforce"
      }
    ],
    expeditionDimensions: [
      {
        expeditionId: "expedition-stage1",
        projectId: "project-stage1",
        expeditionName: "Expedition Stage 1",
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
    communicationClassification: {
      messageKind: "one_to_one",
      sourceRecordType: "message",
      sourceRecordId: "gmail-message-ops-1",
      campaignRef: null,
      threadRef: {
        providerThreadId: "thread-ops-1"
      },
      direction: "inbound"
    },
    identity: {
      salesforceContactId,
      volunteerIdPlainValues: ["VOL-123"],
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: []
    },
    supportingSources: [],
    gmailMessageDetail: {
      sourceEvidenceId: "source-evidence:gmail:message:gmail-message-ops-1",
      providerRecordId: "gmail-message-ops-1",
      gmailThreadId: "thread-ops-1",
      rfc822MessageId: "<gmail-message-ops-1@example.org>",
      direction: "inbound",
      subject: "Validation reply subject",
      snippetClean: "Validation reply",
      bodyTextPreview: "Validation reply body preview",
      capturedMailbox: "project-stage1@example.org",
      projectInboxAlias: "project-stage1@example.org"
    }
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
    consecutiveFailureCount: 0,
    deadLetterCount: 0,
    freshnessP95Seconds: 60,
    freshnessP99Seconds: 120
  });
}

describe("Stage 1 ops helpers", () => {
  it("parses both split and equals-style CLI flags", () => {
    expect(
      parseCliFlags([
        "--campaign-id=abc123",
        "--dry-run",
        "--limit",
        "5",
      ]),
    ).toEqual({
      "campaign-id": "abc123",
      "dry-run": true,
      limit: "5",
    });
  });

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

  it("requires a capture window when historical or live capture jobs do not target explicit record ids", () => {
    expect(() => buildStage1EnqueueRequest("salesforce-historical", {})).toThrow(
      "Flags --window-start and --window-end are required for salesforce historical capture jobs when --record-ids is not provided."
    );
  });

  it("preserves colon-delimited Gmail historical provider record ids in replay jobs", () => {
    const replayRequest = buildStage1EnqueueRequest("replay", {
      provider: "gmail",
      mode: "historical",
      items:
        "message:mbox:1b9adc42d2f5975a27842ddebcda2131f5351b875b9c19de90fb264bba369487"
    });
    const replayPayload = replayBatchPayloadSchema.parse(replayRequest.payload);

    expect(replayPayload.items).toEqual([
      {
        providerRecordType: "message",
        providerRecordId:
          "mbox:1b9adc42d2f5975a27842ddebcda2131f5351b875b9c19de90fb264bba369487"
      }
    ]);
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
      expect(contactInspection.readableMemberships).toEqual([
        expect.objectContaining({
          projectId: "project-stage1",
          projectName: "Project Stage 1",
          expeditionId: "expedition-stage1",
          expeditionName: "Expedition Stage 1"
        })
      ]);
      expect(contactInspection.story).toEqual([
        expect.objectContaining({
          provider: "gmail",
          eventType: "communication.email.inbound",
          subject: "Validation reply subject",
          preview: "Validation reply body preview",
          direction: "inbound",
          capturedMailbox: "project-stage1@example.org",
          projectInboxAlias: "project-stage1@example.org"
        })
      ]);
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
        freshnessP99Seconds: 120,
        latestFailure: null
      });
    } finally {
      await context.dispose();
    }
  });

  it("surfaces the latest durable sync failure when inspecting failed sync states", async () => {
    const context = await createTestWorkerContext();

    try {
      await context.persistence.saveSyncState({
        id: "sync:salesforce:historical:ops-failed",
        scope: "provider",
        provider: "salesforce",
        jobType: "historical_backfill",
        status: "failed",
        cursor: "salesforce:cursor:failed",
        windowStart: "2026-01-02T00:00:00.000Z",
        windowEnd: "2026-01-02T00:10:00.000Z",
        parityPercent: null,
        lastSuccessfulAt: null,
        consecutiveFailureCount: 0,
        deadLetterCount: 0,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null
      });
      await context.persistence.recordAuditEvidence({
        id: "audit:sync_state:sync:salesforce:historical:ops-failed:failure:1",
        actorType: "worker",
        actorId: "stage1-orchestration",
        action: "record_sync_failure",
        entityType: "sync_state",
        entityId: "sync:salesforce:historical:ops-failed",
        occurredAt: "2026-01-02T00:10:30.000Z",
        result: "recorded",
        policyCode: "stage1.sync.failure",
        metadataJson: {
          message: "Unsupported Salesforce batch shape.",
          disposition: "non_retryable",
          retryable: false
        }
      });

      const syncState = await inspectLatestSyncState(context.repositories, {
        syncStateId: "sync:salesforce:historical:ops-failed"
      });

      expect(syncState).toMatchObject({
        id: "sync:salesforce:historical:ops-failed",
        provider: "salesforce",
        status: "failed",
        latestFailure: {
          message: "Unsupported Salesforce batch shape.",
          disposition: "non_retryable",
          retryable: false
        }
      });
    } finally {
      await context.dispose();
    }
  });
});
