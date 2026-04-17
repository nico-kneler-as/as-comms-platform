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
    memberships: []
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
      memberships: []
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
      memberships: []
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
