import { describe, expect, it } from "vitest";

import {
  createStage1NormalizationService,
  createStage1PersistenceService
} from "@as-comms/domain";

import { createTestStage1Context } from "./helpers.js";

async function seedContactWithEmail(
  email: string,
  input: {
    readonly contactId: string;
    readonly salesforceContactId?: string | null;
    readonly displayName: string;
  }
) {
  const context = await createTestStage1Context();
  const memberships =
    input.salesforceContactId === undefined || input.salesforceContactId === null
      ? []
      : [
          {
            id: `membership:${input.contactId}:default`,
            contactId: input.contactId,
            projectId: "project_default",
            expeditionId: "expedition_default",
            role: "volunteer",
            status: "active",
            source: "salesforce" as const
          }
        ];

  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: input.salesforceContactId ?? null,
      displayName: input.displayName,
      primaryEmail: email,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: email,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
    memberships
  });

  return context;
}

function buildOneToOneCommunicationClassification(input: {
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly direction: "inbound" | "outbound";
}) {
  return {
    messageKind: "one_to_one" as const,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    campaignRef: null,
    threadRef: {
      crossProviderCollapseKey: null,
      providerThreadId: null
    },
    direction: input.direction
  };
}

function buildAutoCommunicationClassification(input: {
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly direction: "outbound";
}) {
  return {
    messageKind: "auto" as const,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    campaignRef: null,
    threadRef: {
      crossProviderCollapseKey: null,
      providerThreadId: null
    },
    direction: input.direction
  };
}

describe("Stage 1 normalization service", () => {
  it("upserts canonical contact graph state through the application boundary", async () => {
    const { normalization, repositories } = await createTestStage1Context();

    const result = await normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_1",
        salesforceContactId: "003-stage1",
        displayName: "Stage One Volunteer",
        primaryEmail: "volunteer@example.org",
        primaryPhone: "+15555550123",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [
        {
          id: "identity_1",
          contactId: "contact_1",
          kind: "email",
          normalizedValue: "volunteer@example.org",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "identity_2",
          contactId: "contact_1",
          kind: "phone",
          normalizedValue: "+15555550123",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberships: [
        {
          id: "membership_1",
          contactId: "contact_1",
          projectId: "project_1",
          expeditionId: "expedition_1",
          role: "volunteer",
          status: "active",
          source: "salesforce"
        }
      ]
    });

    expect(result.contact.salesforceContactId).toBe("003-stage1");
    expect(result.identities).toHaveLength(2);
    expect(result.memberships).toHaveLength(1);
    await expect(repositories.contacts.findById("contact_1")).resolves.toEqual(
      result.contact
    );
  });

  it("opens identity review instead of guessing when multiple contacts share one normalized email", async () => {
    const context = await seedContactWithEmail("shared@example.org", {
      contactId: "contact_1",
      displayName: "Contact One"
    });

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_2",
        salesforceContactId: null,
        displayName: "Contact Two",
        primaryEmail: "shared@example.org",
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [
        {
          id: "identity:contact_2:email",
          contactId: "contact_2",
          kind: "email",
          normalizedValue: "shared@example.org",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberships: []
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:05:00.000Z",
        occurredAt: "2026-01-01T00:04:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:04:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Inbound email received",
        snippet: "Who should own this?"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["shared@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(result.outcome).toBe("needs_identity_review");
    if (result.outcome === "needs_identity_review") {
      expect(result.identityCase.reasonCode).toBe("identity_multi_candidate");
      expect(result.identityCase.candidateContactIds).toEqual([
        "contact_1",
        "contact_2"
      ]);
    }

    await expect(
      context.repositories.canonicalEvents.listByContactId("contact_1")
    ).resolves.toEqual([]);
  });

  it("skips Salesforce task events for non-volunteer contacts without opening review", async () => {
    const context = await createTestStage1Context();

    await context.repositories.contacts.upsert({
      id: "contact_non_volunteer",
      salesforceContactId: "003-non-volunteer",
      displayName: "Non Volunteer Contact",
      primaryEmail: "donor@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_non_volunteer_task",
        provider: "salesforce",
        providerRecordType: "task_communication",
        providerRecordId: "00T-non-volunteer",
        receivedAt: "2026-01-01T00:03:00.000Z",
        occurredAt: "2026-01-01T00:02:00.000Z",
        payloadRef: "payloads/salesforce/00T-non-volunteer.json",
        idempotencyKey: "salesforce:task:00T-non-volunteer",
        checksum: "checksum-non-volunteer-task"
      },
      canonicalEvent: {
        id: "evt_non_volunteer_task",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:02:00.000Z",
        idempotencyKey: "canonical:salesforce:task:00T-non-volunteer",
        summary: "Outbound email sent",
        snippet: "This Salesforce task should be skipped."
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "task_communication",
        sourceRecordId: "00T-non-volunteer",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: "003-non-volunteer",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: []
      },
      supportingSources: [],
      salesforceCommunicationDetail: {
        sourceEvidenceId: "sev_non_volunteer_task",
        providerRecordId: "00T-non-volunteer",
        channel: "email",
        messageKind: "one_to_one",
        subject: "Logged outbound follow-up",
        snippet: "This Salesforce task should be skipped.",
        sourceLabel: "Salesforce Task"
      },
      salesforceEventContext: {
        sourceEvidenceId: "sev_non_volunteer_task",
        salesforceContactId: "003-non-volunteer",
        projectId: null,
        expeditionId: null,
        sourceField: null
      }
    });

    expect(result.outcome).toBe("skipped");
    if (result.outcome === "skipped") {
      expect(result.reasonCode).toBe("skipped_non_volunteer_task");
      expect(result.auditEvidence).toMatchObject({
        action: "skipped_non_volunteer_task",
        entityType: "source_evidence",
        entityId: "sev_non_volunteer_task",
        policyCode: "stage1.skip.skipped_non_volunteer_task"
      });
      expect(result.auditEvidence.metadataJson).toEqual({
        salesforceTaskId: "00T-non-volunteer",
        whoId: "003-non-volunteer"
      });
    }

    await expect(
      context.repositories.canonicalEvents.listByContactId("contact_non_volunteer")
    ).resolves.toEqual([]);
    await expect(
      context.repositories.routingReviewQueue.listOpenByReasonCode(
        "routing_missing_membership"
      )
    ).resolves.toEqual([]);
    await expect(
      context.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
        "sev_non_volunteer_task"
      ])
    ).resolves.toEqual([]);
    await expect(
      context.repositories.salesforceEventContext.listBySourceEvidenceIds([
        "sev_non_volunteer_task"
      ])
    ).resolves.toEqual([]);
  });

  it("applies Gmail-won outbound email events idempotently and drives Opened then New inbox semantics", async () => {
    const context = await seedContactWithEmail("volunteer@example.org", {
      contactId: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer"
    });

    const outboundResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:05:00.000Z",
        occurredAt: "2026-01-01T00:04:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:04:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Outbound email sent",
        snippet: "Following up by email"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: []
      },
      supportingSources: [
        {
          provider: "salesforce",
          sourceEvidenceId: "sev_2"
        }
      ]
    });

    expect(outboundResult.outcome).toBe("applied");
    if (outboundResult.outcome === "applied") {
      expect(outboundResult.canonicalEvent.provenance.winnerReason).toBe(
        "gmail_wins_duplicate_collapse"
      );
      expect(outboundResult.inboxProjection?.bucket).toBe("Opened");
      expect(outboundResult.timelineProjection.sortKey).toBe(
        "2026-01-01T00:04:00.000Z::evt_1"
      );
    }

    const duplicateResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1-duplicate",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:06:00.000Z",
        occurredAt: "2026-01-01T00:04:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1-duplicate",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:04:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Outbound email sent",
        snippet: "Following up by email"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: []
      },
      supportingSources: [
        {
          provider: "salesforce",
          sourceEvidenceId: "sev_2"
        }
      ]
    });

    expect(duplicateResult.outcome).toBe("duplicate");

    const inboundResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_3",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-2",
        receivedAt: "2026-01-01T00:11:00.000Z",
        occurredAt: "2026-01-01T00:10:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-2.json",
        idempotencyKey: "gmail:message:gmail-message-2",
        checksum: "checksum-2"
      },
      canonicalEvent: {
        id: "evt_2",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:10:00.000Z",
        idempotencyKey: "canonical:gmail-message-2",
        summary: "Inbound email received",
        snippet: "Thanks for the update"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-2",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(inboundResult.outcome).toBe("applied");
    if (inboundResult.outcome === "applied") {
      expect(inboundResult.inboxProjection?.bucket).toBe("New");
      expect(inboundResult.inboxProjection?.lastInboundAt).toBe(
        "2026-01-01T00:10:00.000Z"
      );
      expect(inboundResult.inboxProjection?.lastOutboundAt).toBe(
        "2026-01-01T00:04:00.000Z"
      );
      expect(inboundResult.inboxProjection?.snippet).toBe(
        "Thanks for the update"
      );
    }

    const timelineRows =
      await context.repositories.timelineProjection.listByContactId("contact_1");
    expect(timelineRows).toHaveLength(2);
  });

  it("keeps lastActivityAt pinned to the newest inbound or outbound one-to-one event", async () => {
    const context = await seedContactWithEmail("volunteer@example.org", {
      contactId: "contact_1",
      displayName: "Projection Invariant Contact"
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_projection_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "projection-message-1",
        receivedAt: "2026-01-01T00:01:00.000Z",
        occurredAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/gmail/projection-message-1.json",
        idempotencyKey: "gmail:message:projection-message-1",
        checksum: "checksum-projection-1"
      },
      canonicalEvent: {
        id: "evt_projection_1",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:01:00.000Z",
        idempotencyKey: "canonical:projection-message-1",
        summary: "Inbound email received",
        snippet: "Initial inbound"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "projection-message-1",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    const outbound = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_projection_2",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "projection-message-2",
        receivedAt: "2026-01-01T00:05:00.000Z",
        occurredAt: "2026-01-01T00:05:00.000Z",
        payloadRef: "payloads/gmail/projection-message-2.json",
        idempotencyKey: "gmail:message:projection-message-2",
        checksum: "checksum-projection-2"
      },
      canonicalEvent: {
        id: "evt_projection_2",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:05:00.000Z",
        idempotencyKey: "canonical:projection-message-2",
        summary: "Outbound email sent",
        snippet: "Fresh outbound reply"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "projection-message-2",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(outbound.outcome).toBe("applied");
    if (outbound.outcome === "applied") {
      expect(outbound.inboxProjection).toMatchObject({
        bucket: "New",
        lastInboundAt: "2026-01-01T00:01:00.000Z",
        lastOutboundAt: "2026-01-01T00:05:00.000Z",
        lastActivityAt: "2026-01-01T00:05:00.000Z"
      });
    }

    const inbound = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_projection_3",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "projection-message-3",
        receivedAt: "2026-01-01T00:07:00.000Z",
        occurredAt: "2026-01-01T00:07:00.000Z",
        payloadRef: "payloads/gmail/projection-message-3.json",
        idempotencyKey: "gmail:message:projection-message-3",
        checksum: "checksum-projection-3"
      },
      canonicalEvent: {
        id: "evt_projection_3",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:07:00.000Z",
        idempotencyKey: "canonical:projection-message-3",
        summary: "Inbound email received",
        snippet: "Fresh inbound follow-up"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "projection-message-3",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(inbound.outcome).toBe("applied");
    if (inbound.outcome === "applied") {
      expect(inbound.inboxProjection).toMatchObject({
        bucket: "New",
        lastInboundAt: "2026-01-01T00:07:00.000Z",
        lastOutboundAt: "2026-01-01T00:05:00.000Z",
        lastActivityAt: "2026-01-01T00:07:00.000Z"
      });
    }
  });

  it("keeps Salesforce auto task messages out of inbox projection mutation", async () => {
    const context = await seedContactWithEmail("auto@example.org", {
      contactId: "contact_1",
      displayName: "Auto Task Contact"
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_auto_task_1",
        provider: "salesforce",
        providerRecordType: "task_communication",
        providerRecordId: "task-auto-1",
        receivedAt: "2026-01-01T00:02:00.000Z",
        occurredAt: "2026-01-01T00:02:00.000Z",
        payloadRef: "payloads/salesforce/task-auto-1.json",
        idempotencyKey: "salesforce:task_communication:task-auto-1",
        checksum: "checksum-auto-task-1"
      },
      canonicalEvent: {
        id: "evt_auto_task_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:02:00.000Z",
        idempotencyKey: "canonical:task-auto-1",
        summary: "Outbound email sent",
        snippet: "Automated Salesforce follow-up"
      },
      communicationClassification: buildAutoCommunicationClassification({
        sourceRecordType: "task_communication",
        sourceRecordId: "task-auto-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["auto@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.inboxProjection).toBeNull();
    }

    await expect(
      context.repositories.inboxProjection.findByContactId("contact_1")
    ).resolves.toBeNull();
    await expect(
      context.repositories.timelineProjection.listByContactId("contact_1")
    ).resolves.toHaveLength(1);
  });

  it("keeps campaign activity out of inbox bucket mutation while preserving timeline history", async () => {
    const context = await seedContactWithEmail("campaign@example.org", {
      contactId: "contact_1",
      displayName: "Campaign Contact"
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:01:00.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Inbound email received",
        snippet: "Initial inbound"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["campaign@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    const beforeCampaign = await context.repositories.inboxProjection.findByContactId(
      "contact_1"
    );

    const campaignResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_2",
        provider: "mailchimp",
        providerRecordType: "campaign_activity",
        providerRecordId: "mailchimp-campaign-1:member-1:opened",
        receivedAt: "2026-01-01T00:03:00.000Z",
        occurredAt: "2026-01-01T00:02:00.000Z",
        payloadRef: "payloads/mailchimp/activity-1.json",
        idempotencyKey: "mailchimp:activity:1",
        checksum: "checksum-2"
      },
      canonicalEvent: {
        id: "evt_2",
        eventType: "campaign.email.opened",
        occurredAt: "2026-01-01T00:02:00.000Z",
        idempotencyKey: "canonical:mailchimp:activity:1",
        summary: "Campaign email opened",
        snippet: "Campaign open"
      },
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["campaign@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(campaignResult.outcome).toBe("applied");
    if (campaignResult.outcome === "applied") {
      expect(campaignResult.inboxProjection).toEqual(beforeCampaign);
    }

    const timelineRows =
      await context.repositories.timelineProjection.listByContactId("contact_1");
    expect(timelineRows.map((row) => row.eventType)).toEqual([
      "communication.email.inbound",
      "campaign.email.opened"
    ]);
  });

  it("opens routing review, sets unresolved overlay, and clears it after resolution", async () => {
    const context = await seedContactWithEmail("routing@example.org", {
      contactId: "contact_1",
      displayName: "Routing Contact"
    });

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_1",
        salesforceContactId: null,
        displayName: "Routing Contact",
        primaryEmail: "routing@example.org",
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [],
      memberships: [
        {
          id: "membership_1",
          contactId: "contact_1",
          projectId: "project_1",
          expeditionId: null,
          role: "volunteer",
          status: "active",
          source: "salesforce"
        },
        {
          id: "membership_2",
          contactId: "contact_1",
          projectId: "project_2",
          expeditionId: null,
          role: "volunteer",
          status: "active",
          source: "salesforce"
        }
      ]
    });

    const applied = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:02:00.000Z",
        occurredAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:01:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Inbound email received",
        snippet: "Need routing help"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        direction: "inbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["routing@example.org"],
        normalizedPhones: []
      },
      routing: {
        required: true,
        projectId: null,
        expeditionId: null
      },
      supportingSources: []
    });

    expect(applied.outcome).toBe("applied");
    if (applied.outcome === "applied") {
      expect(applied.canonicalEvent.reviewState).toBe("needs_routing_review");
      expect(applied.routingCase?.reasonCode).toBe("routing_multiple_memberships");
      expect(applied.inboxProjection?.hasUnresolved).toBe(true);
    }

    const resolved = await context.normalization.saveRoutingAmbiguityCase({
      contactId: "contact_1",
      sourceEvidenceId: "sev_1",
      reasonCode: "routing_multiple_memberships",
      status: "resolved",
      openedAt: "2026-01-01T00:02:00.000Z",
      resolvedAt: "2026-01-01T00:03:00.000Z",
      candidateMembershipIds: ["membership_1", "membership_2"],
      explanation: "Resolved to membership_1 during Stage 1 test."
    });

    expect(resolved.inboxProjection?.hasUnresolved).toBe(false);
  });

  it("keeps the Salesforce anchor, opens identity review for mismatched weaker evidence, and marks inbox unresolved", async () => {
    const context = await createTestStage1Context();

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_anchor",
        salesforceContactId: "003-anchor",
        displayName: "Anchored Contact",
        primaryEmail: "anchor@example.org",
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [],
      memberships: [
        {
          id: "membership_anchor_default",
          contactId: "contact_anchor",
          projectId: "project_anchor",
          expeditionId: "expedition_anchor",
          role: "volunteer",
          status: "active",
          source: "salesforce"
        }
      ]
    });

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_conflict",
        salesforceContactId: null,
        displayName: "Conflicting Contact",
        primaryEmail: "conflict@example.org",
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [
        {
          id: "identity_conflict_email",
          contactId: "contact_conflict",
          kind: "email",
          normalizedValue: "shared-anchor@example.org",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberships: []
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "salesforce",
        providerRecordType: "task",
        providerRecordId: "task-1",
        receivedAt: "2026-01-01T00:03:00.000Z",
        occurredAt: "2026-01-01T00:02:00.000Z",
        payloadRef: "payloads/salesforce/task-1.json",
        idempotencyKey: "salesforce:task:1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:02:00.000Z",
        idempotencyKey: "canonical:salesforce:task:1",
        summary: "Outbound email logged",
        snippet: "Salesforce-only outbound"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "task",
        sourceRecordId: "task-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: "003-anchor",
        volunteerIdPlainValues: [],
        normalizedEmails: ["shared-anchor@example.org"],
        normalizedPhones: []
      },
      supportingSources: []
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.canonicalEvent.contactId).toBe("contact_anchor");
      expect(result.canonicalEvent.reviewState).toBe("needs_identity_review");
      expect(result.identityCase?.reasonCode).toBe("identity_anchor_mismatch");
      expect(result.inboxProjection?.hasUnresolved).toBe(true);
    }
  });

  it("reuses anchored identity lookups across repeated events for the same contact evidence", async () => {
    const context = await createTestStage1Context();

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact_cached",
        salesforceContactId: "003-cached",
        displayName: "Cached Contact",
        primaryEmail: "cached@example.org",
        primaryPhone: "+15555550199",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      identities: [
        {
          id: "identity:contact_cached:email",
          contactId: "contact_cached",
          kind: "email",
          normalizedValue: "cached@example.org",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "identity:contact_cached:phone",
          contactId: "contact_cached",
          kind: "phone",
          normalizedValue: "+15555550199",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberships: [
        {
          id: "membership_cached_default",
          contactId: "contact_cached",
          projectId: "project_cached",
          expeditionId: "expedition_cached",
          role: "volunteer",
          status: "active",
          source: "salesforce"
        }
      ]
    });

    const lookupCounts = {
      anchor: 0,
      byId: 0,
      byValue: 0
    };
    const wrappedRepositories = {
      ...context.repositories,
      contacts: {
        ...context.repositories.contacts,
        findById: async (contactId: string) => {
          lookupCounts.byId += 1;
          return context.repositories.contacts.findById(contactId);
        },
        findBySalesforceContactId: async (salesforceContactId: string) => {
          lookupCounts.anchor += 1;
          return context.repositories.contacts.findBySalesforceContactId(
            salesforceContactId
          );
        }
      },
      contactIdentities: {
        ...context.repositories.contactIdentities,
        listByNormalizedValue: async (input: {
          readonly kind: "email" | "phone" | "salesforce_contact_id" | "volunteer_id_plain";
          readonly normalizedValue: string;
        }) => {
          lookupCounts.byValue += 1;
          return context.repositories.contactIdentities.listByNormalizedValue(input);
        }
      }
    };
    const normalization = createStage1NormalizationService(
      createStage1PersistenceService(wrappedRepositories)
    );

    const firstResult = await normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_cached_1",
        provider: "simpletexting",
        providerRecordType: "message",
        providerRecordId: "simpletexting-message-1",
        receivedAt: "2026-02-01T09:01:00.000Z",
        occurredAt: "2026-02-01T09:00:00.000Z",
        payloadRef: "payloads/simpletexting/message-1.json",
        idempotencyKey: "simpletexting:message:1",
        checksum: "checksum-cached-1"
      },
      canonicalEvent: {
        id: "evt_cached_1",
        eventType: "communication.sms.outbound",
        occurredAt: "2026-02-01T09:00:00.000Z",
        idempotencyKey: "canonical:simpletexting:message:1",
        summary: "Outbound SMS sent",
        snippet: "First outbound"
      },
      communicationClassification: {
        messageKind: "one_to_one",
        sourceRecordType: "message",
        sourceRecordId: "simpletexting-message-1",
        campaignRef: null,
        threadRef: {
          crossProviderCollapseKey: null,
          providerThreadId: null
        },
        direction: "outbound"
      },
      identity: {
        salesforceContactId: "003-cached",
        volunteerIdPlainValues: [],
        normalizedEmails: ["cached@example.org"],
        normalizedPhones: ["+15555550199"]
      },
      supportingSources: []
    });

    expect(firstResult.outcome).toBe("applied");
    expect(lookupCounts).toEqual({
      anchor: 1,
      byId: 1,
      byValue: 2
    });

    const secondResult = await normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_cached_2",
        provider: "simpletexting",
        providerRecordType: "message",
        providerRecordId: "simpletexting-message-2",
        receivedAt: "2026-02-01T09:06:00.000Z",
        occurredAt: "2026-02-01T09:05:00.000Z",
        payloadRef: "payloads/simpletexting/message-2.json",
        idempotencyKey: "simpletexting:message:2",
        checksum: "checksum-cached-2"
      },
      canonicalEvent: {
        id: "evt_cached_2",
        eventType: "communication.sms.inbound",
        occurredAt: "2026-02-01T09:05:00.000Z",
        idempotencyKey: "canonical:simpletexting:message:2",
        summary: "Inbound SMS received",
        snippet: "Reply inbound"
      },
      communicationClassification: {
        messageKind: "one_to_one",
        sourceRecordType: "message",
        sourceRecordId: "simpletexting-message-2",
        campaignRef: null,
        threadRef: {
          crossProviderCollapseKey: null,
          providerThreadId: null
        },
        direction: "inbound"
      },
      identity: {
        salesforceContactId: "003-cached",
        volunteerIdPlainValues: [],
        normalizedEmails: ["cached@example.org"],
        normalizedPhones: ["+15555550199"]
      },
      supportingSources: []
    });

    expect(secondResult.outcome).toBe("applied");
    expect(lookupCounts).toEqual({
      anchor: 1,
      byId: 1,
      byValue: 2
    });
  });

  it("quarantines a Salesforce-vs-Gmail outbound email tie-break violation once", async () => {
    const context = await seedContactWithEmail("tie-break@example.org", {
      contactId: "contact_1",
      displayName: "Tie Break Contact"
    });

    const firstResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "salesforce",
        providerRecordType: "task",
        providerRecordId: "task-1",
        receivedAt: "2026-01-01T00:02:00.000Z",
        occurredAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/salesforce/task-1.json",
        idempotencyKey: "salesforce:task:1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:01:00.000Z",
        idempotencyKey: "canonical:salesforce:task:1",
        summary: "Outbound email logged",
        snippet: "Should quarantine"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "task",
        sourceRecordId: "task-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["tie-break@example.org"],
        normalizedPhones: []
      },
      supportingSources: [
        {
          provider: "gmail",
          sourceEvidenceId: "sev_gmail"
        }
      ]
    });

    const secondResult = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_1",
        provider: "salesforce",
        providerRecordType: "task",
        providerRecordId: "task-1",
        receivedAt: "2026-01-01T00:02:00.000Z",
        occurredAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/salesforce/task-1.json",
        idempotencyKey: "salesforce:task:1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:01:00.000Z",
        idempotencyKey: "canonical:salesforce:task:1",
        summary: "Outbound email logged",
        snippet: "Should quarantine"
      },
      communicationClassification: buildOneToOneCommunicationClassification({
        sourceRecordType: "task",
        sourceRecordId: "task-1",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedEmails: ["tie-break@example.org"],
        normalizedPhones: []
      },
      supportingSources: [
        {
          provider: "gmail",
          sourceEvidenceId: "sev_gmail"
        }
      ]
    });

    expect(firstResult.outcome).toBe("quarantined");
    expect(secondResult.outcome).toBe("quarantined");
    if (firstResult.outcome === "quarantined") {
      expect(firstResult.reasonCode).toBe("duplicate_collapse_conflict");
    }

    const audits = await context.repositories.auditEvidence.listByEntity({
      entityType: "canonical_event",
      entityId: "canonical:salesforce:task:1"
    });
    expect(audits).toHaveLength(1);
  });
});
