import { describe, expect, it, vi } from "vitest";

import {
  resolveCanonicalChannel,
  type NormalizedCanonicalEventIntake,
  type NormalizedContactGraphUpsertInput
} from "@as-comms/contracts";
import type {
  NormalizedCanonicalEventResult,
  NormalizedContactGraphResult
} from "@as-comms/domain";

import { createStage1IngestService } from "../src/ingest/index.js";

function buildContactGraphResult(
  input: NormalizedContactGraphUpsertInput
): NormalizedContactGraphResult {
  return {
    contact: input.contact,
    identities: input.identities ?? [],
    memberships: input.memberships ?? []
  };
}

function buildAppliedCanonicalEventResult(
  input: NormalizedCanonicalEventIntake
): NormalizedCanonicalEventResult {
  return {
    outcome: "applied",
    sourceEvidence: input.sourceEvidence,
    canonicalEvent: {
      id: input.canonicalEvent.id,
      contactId: "contact:salesforce:003-stage1",
      eventType: input.canonicalEvent.eventType,
      channel: resolveCanonicalChannel(input.canonicalEvent.eventType),
      occurredAt: input.canonicalEvent.occurredAt,
      contentFingerprint: null,
      sourceEvidenceId: input.sourceEvidence.id,
      idempotencyKey: input.canonicalEvent.idempotencyKey,
      provenance: {
        primaryProvider: input.sourceEvidence.provider,
        primarySourceEvidenceId: input.sourceEvidence.id,
        supportingSourceEvidenceIds: (input.supportingSources ?? []).map(
          (source) => source.sourceEvidenceId
        ),
        winnerReason:
          input.sourceEvidence.provider === "gmail" &&
          (input.supportingSources ?? []).some(
            (source) => source.provider === "salesforce"
          )
            ? "gmail_wins_duplicate_collapse"
            : "single_source",
        sourceRecordType: input.sourceEvidence.providerRecordType,
        sourceRecordId: input.sourceEvidence.providerRecordId,
        messageKind: input.communicationClassification?.messageKind ?? null,
        campaignRef:
          input.communicationClassification?.campaignRef === undefined
            ? null
            : {
                providerCampaignId:
                  input.communicationClassification.campaignRef
                    ?.providerCampaignId ?? null,
                providerAudienceId:
                  input.communicationClassification.campaignRef
                    ?.providerAudienceId ?? null,
                providerMessageName:
                  input.communicationClassification.campaignRef
                    ?.providerMessageName ?? null
              },
        threadRef:
          input.communicationClassification?.threadRef === undefined
            ? null
            : {
                crossProviderCollapseKey:
                  input.communicationClassification.threadRef
                    ?.crossProviderCollapseKey ?? null,
                providerThreadId:
                  input.communicationClassification.threadRef
                    ?.providerThreadId ?? null
              },
        direction: input.communicationClassification?.direction ?? null
      },
      reviewState: "clear"
    },
    timelineProjection: {
      id: `timeline:${input.canonicalEvent.id}`,
      contactId: "contact:salesforce:003-stage1",
      canonicalEventId: input.canonicalEvent.id,
      occurredAt: input.canonicalEvent.occurredAt,
      sortKey: `${input.canonicalEvent.occurredAt}::${input.canonicalEvent.id}`,
      eventType: input.canonicalEvent.eventType,
      summary: input.canonicalEvent.summary,
      channel: resolveCanonicalChannel(input.canonicalEvent.eventType),
      primaryProvider: input.sourceEvidence.provider,
      reviewState: "clear"
    },
    inboxProjection: null,
    identityCase: null,
    routingCase: null,
    auditEvidence: null
  };
}

describe("Stage 1 worker ingest service", () => {
  it("routes Gmail historical and live intake through the same normalized path", async () => {
    const applyNormalizedCanonicalEvent = vi.fn(
      (input: NormalizedCanonicalEventIntake) =>
        Promise.resolve(buildAppliedCanonicalEventResult(input))
    );
    const upsertNormalizedContactGraph = vi.fn(
      (input: NormalizedContactGraphUpsertInput) =>
        Promise.resolve(buildContactGraphResult(input))
    );
    const service = createStage1IngestService({
      applyNormalizedCanonicalEvent,
      upsertNormalizedContactGraph
    });

    const record = {
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
      salesforceContactId: "003-stage1",
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [
        {
          provider: "salesforce" as const,
          providerRecordType: "task_communication",
          providerRecordId: "task-1"
        }
      ],
      crossProviderCollapseKey: "email-thread-1"
    };

    const historicalResult = await service.ingestGmailHistoricalRecord(record);
    const liveResult = await service.ingestGmailLiveRecord(record);

    expect(historicalResult.outcome).toBe("normalized");
    expect(liveResult.outcome).toBe("normalized");
    expect(applyNormalizedCanonicalEvent).toHaveBeenCalledTimes(2);
    expect(applyNormalizedCanonicalEvent.mock.calls[0]?.[0]).toEqual(
      applyNormalizedCanonicalEvent.mock.calls[1]?.[0]
    );
    expect(
      applyNormalizedCanonicalEvent.mock.calls[0]?.[0].supportingSources
    ).toEqual([
      {
        provider: "salesforce",
        sourceEvidenceId:
          "source-evidence:salesforce:task_communication:task-1"
      }
    ]);
    expect(
      applyNormalizedCanonicalEvent.mock.calls[0]?.[0].canonicalEvent.idempotencyKey
    ).toBe("canonical-event:collapse:communication.email.outbound:email-thread-1");
    expect(upsertNormalizedContactGraph).not.toHaveBeenCalled();
  });

  it("sends Salesforce contact snapshots through the contact-graph normalization path", async () => {
    const applyNormalizedCanonicalEvent = vi.fn(
      (input: NormalizedCanonicalEventIntake) =>
        Promise.resolve(buildAppliedCanonicalEventResult(input))
    );
    const upsertNormalizedContactGraph = vi.fn(
      (input: NormalizedContactGraphUpsertInput) =>
        Promise.resolve(buildContactGraphResult(input))
    );
    const service = createStage1IngestService({
      applyNormalizedCanonicalEvent,
      upsertNormalizedContactGraph
    });

    const result = await service.ingestSalesforceHistoricalRecord({
      recordType: "contact_snapshot",
      recordId: "003-stage1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: ["+15555550123"],
      volunteerIdPlainValues: ["VOL-123"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      memberships: [
        {
          projectId: "project_1",
          projectName: "Project Antarctica",
          expeditionId: "expedition_1",
          expeditionName: "Expedition Antarctica",
          role: "volunteer",
          status: "active"
        }
      ]
    });

    expect(result).toEqual({
      outcome: "normalized",
      ingestMode: "historical",
      provider: "salesforce",
      sourceRecordType: "contact_snapshot",
      sourceRecordId: "003-stage1",
      commandKind: "contact_graph",
      sourceEvidenceId: null,
      canonicalEventId: null,
      contactId: "contact:salesforce:003-stage1"
    });
    expect(upsertNormalizedContactGraph).toHaveBeenCalledTimes(1);
    expect(applyNormalizedCanonicalEvent).not.toHaveBeenCalled();
  });

  it("defers Salesforce contact snapshots that do not have expedition memberships", async () => {
    const applyNormalizedCanonicalEvent = vi.fn(
      (input: NormalizedCanonicalEventIntake) =>
        Promise.resolve(buildAppliedCanonicalEventResult(input))
    );
    const upsertNormalizedContactGraph = vi.fn(
      (input: NormalizedContactGraphUpsertInput) =>
        Promise.resolve(buildContactGraphResult(input))
    );
    const service = createStage1IngestService({
      applyNormalizedCanonicalEvent,
      upsertNormalizedContactGraph
    });

    const result = await service.ingestSalesforceHistoricalRecord({
      recordType: "contact_snapshot",
      recordId: "003-non-volunteer",
      salesforceContactId: "003-non-volunteer",
      displayName: "Non Volunteer Contact",
      primaryEmail: "donor@example.org",
      primaryPhone: null,
      normalizedEmails: ["donor@example.org"],
      normalizedPhones: [],
      volunteerIdPlainValues: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      memberships: []
    });

    expect(result).toEqual({
      outcome: "deferred",
      ingestMode: "historical",
      provider: "salesforce",
      sourceRecordType: "contact_snapshot",
      sourceRecordId: "003-non-volunteer",
      reason: "deferred_record_family",
      detail:
        "Salesforce contact_snapshot records without expedition memberships are skipped in Stage 1."
    });
    expect(upsertNormalizedContactGraph).not.toHaveBeenCalled();
    expect(applyNormalizedCanonicalEvent).not.toHaveBeenCalled();
  });

  it("returns explicit deferred outcomes for unsupported provider records without calling normalization", async () => {
    const applyNormalizedCanonicalEvent = vi.fn(
      (input: NormalizedCanonicalEventIntake) =>
        Promise.resolve(buildAppliedCanonicalEventResult(input))
    );
    const upsertNormalizedContactGraph = vi.fn(
      (input: NormalizedContactGraphUpsertInput) =>
        Promise.resolve(buildContactGraphResult(input))
    );
    const service = createStage1IngestService({
      applyNormalizedCanonicalEvent,
      upsertNormalizedContactGraph
    });

    const result = await service.ingestMailchimpHistoricalRecord({
      recordType: "audience_mutation",
      recordId: "audience-1"
    });

    expect(result).toEqual({
      outcome: "deferred",
      ingestMode: "historical",
      provider: "mailchimp",
      sourceRecordType: "audience_mutation",
      sourceRecordId: "audience-1",
      reason: "deferred_record_family",
      detail: "Mailchimp audience_mutation records are deferred in Stage 1."
    });
    expect(applyNormalizedCanonicalEvent).not.toHaveBeenCalled();
    expect(upsertNormalizedContactGraph).not.toHaveBeenCalled();
  });

  it("surfaces review-opened and quarantined outcomes from the normalization boundary", async () => {
    const applyNormalizedCanonicalEvent = vi
      .fn<
        (input: NormalizedCanonicalEventIntake) => Promise<NormalizedCanonicalEventResult>
      >()
      .mockResolvedValueOnce({
        outcome: "needs_identity_review",
        sourceEvidence: {
          id: "source-evidence:gmail:message:gmail-message-1",
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-message-1",
          receivedAt: "2026-01-01T00:01:00.000Z",
          occurredAt: "2026-01-01T00:00:00.000Z",
          payloadRef: "payloads/gmail/gmail-message-1.json",
          idempotencyKey: "source-evidence:gmail:message:gmail-message-1",
          checksum: "checksum-1"
        },
        identityCase: {
          id: "identity-review:source-evidence:gmail:message:gmail-message-1:identity_multi_candidate",
          sourceEvidenceId: "source-evidence:gmail:message:gmail-message-1",
          candidateContactIds: ["contact_1", "contact_2"],
          reasonCode: "identity_multi_candidate",
          status: "open",
          openedAt: "2026-01-01T00:01:00.000Z",
          resolvedAt: null,
          normalizedIdentityValues: ["shared@example.org"],
          anchoredContactId: null,
          explanation: "Multiple contacts matched the same email."
        },
        auditEvidence: null
      })
      .mockResolvedValueOnce({
        outcome: "quarantined",
        sourceEvidence: {
          id: "source-evidence:salesforce:task_communication:task-1",
          provider: "salesforce",
          providerRecordType: "task_communication",
          providerRecordId: "task-1",
          receivedAt: "2026-01-01T00:02:00.000Z",
          occurredAt: "2026-01-01T00:01:00.000Z",
          payloadRef: "payloads/salesforce/task-1.json",
          idempotencyKey: "source-evidence:salesforce:task_communication:task-1",
          checksum: "checksum-task-1"
        },
        reasonCode: "duplicate_collapse_conflict",
        explanation: "Gmail must win duplicate collapse for the same outbound email.",
        existingCanonicalEvent: null,
        auditEvidence: {
          id: "audit:canonical_event:task-1:duplicate_collapse_conflict",
          actorType: "system",
          actorId: "stage1-normalization",
          action: "quarantine_duplicate_collapse",
          entityType: "canonical_event",
          entityId: "task-1",
          occurredAt: "2026-01-01T00:02:00.000Z",
          result: "recorded",
          policyCode: "stage1.quarantine.duplicate_collapse_conflict",
          metadataJson: {}
        }
      });
    const upsertNormalizedContactGraph = vi.fn(
      (input: NormalizedContactGraphUpsertInput) =>
        Promise.resolve(buildContactGraphResult(input))
    );
    const service = createStage1IngestService({
      applyNormalizedCanonicalEvent,
      upsertNormalizedContactGraph
    });

    const reviewResult = await service.ingestGmailHistoricalRecord({
      recordType: "message",
      recordId: "gmail-message-1",
      direction: "inbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      checksum: "checksum-1",
      snippet: "Who should own this?",
      threadId: "thread-1",
      rfc822MessageId: "<message-1@example.org>",
      normalizedParticipantEmails: ["shared@example.org"],
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [],
      crossProviderCollapseKey: null
    });

    const quarantineResult = await service.ingestSalesforceLiveRecord({
      recordType: "task_communication",
      recordId: "task-1",
      channel: "email",
      salesforceContactId: "003-stage1",
      occurredAt: "2026-01-01T00:01:00.000Z",
      receivedAt: "2026-01-01T00:02:00.000Z",
      payloadRef: "payloads/salesforce/task-1.json",
      checksum: "checksum-task-1",
      snippet: "Outbound email logged in CRM",
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: [],
      volunteerIdPlainValues: [],
      supportingRecords: [
        {
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-message-1"
        }
      ],
      crossProviderCollapseKey: "email-thread-1",
      messageKind: "one_to_one",
      subject: null,
      routing: {
        required: false,
        projectId: null,
        expeditionId: null,
        projectName: null,
        expeditionName: null
      }
    });

    expect(reviewResult).toEqual({
      outcome: "review_opened",
      ingestMode: "historical",
      provider: "gmail",
      sourceRecordType: "message",
      sourceRecordId: "gmail-message-1",
      commandKind: "canonical_event",
      sourceEvidenceId: "source-evidence:gmail:message:gmail-message-1",
      canonicalEventId: null,
      contactId: null,
      reviewCases: [
        {
          queue: "identity",
          caseId:
            "identity-review:source-evidence:gmail:message:gmail-message-1:identity_multi_candidate",
          reasonCode: "identity_multi_candidate"
        }
      ]
    });
    expect(quarantineResult).toEqual({
      outcome: "quarantined",
      ingestMode: "live",
      provider: "salesforce",
      sourceRecordType: "task_communication",
      sourceRecordId: "task-1",
      commandKind: "canonical_event",
      sourceEvidenceId: "source-evidence:salesforce:task_communication:task-1",
      canonicalEventId: null,
      contactId: null,
      reasonCode: "duplicate_collapse_conflict",
      explanation:
        "Gmail must win duplicate collapse for the same outbound email.",
      auditEvidenceId: "audit:canonical_event:task-1:duplicate_collapse_conflict"
    });
  });
});
