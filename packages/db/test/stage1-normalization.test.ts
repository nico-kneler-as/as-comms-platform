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

function buildGmailOutboundEmailFixture(input: {
  readonly key: string;
  readonly email: string;
  readonly salesforceContactId: string | null;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly subject: string;
  readonly bodyTextPreview: string;
  readonly snippetClean?: string;
  readonly snippet?: string;
}) {
  return {
    sourceEvidence: {
      id: `sev_${input.key}`,
      provider: "gmail" as const,
      providerRecordType: "message",
      providerRecordId: `gmail-${input.key}`,
      receivedAt: input.receivedAt,
      occurredAt: input.occurredAt,
      payloadRef: `payloads/gmail/${input.key}.json`,
      idempotencyKey: `gmail:message:${input.key}`,
      checksum: `checksum:${input.key}`
    },
    canonicalEvent: {
      id: `evt_${input.key}`,
      eventType: "communication.email.outbound" as const,
      occurredAt: input.occurredAt,
      idempotencyKey: `canonical:${input.key}`,
      summary: "Outbound email sent",
      snippet: input.snippet ?? input.bodyTextPreview
    },
    communicationClassification: buildOneToOneCommunicationClassification({
      sourceRecordType: "message",
      sourceRecordId: `gmail-${input.key}`,
      direction: "outbound"
    }),
    identity: {
      salesforceContactId: input.salesforceContactId,
      volunteerIdPlainValues: [],
      normalizedEmails: [input.email],
      normalizedPhones: []
    },
    supportingSources: [],
    gmailMessageDetail: {
      sourceEvidenceId: `sev_${input.key}`,
      providerRecordId: `gmail-${input.key}`,
      gmailThreadId: `thread-${input.key}`,
      rfc822MessageId: `<${input.key}@example.org>`,
      direction: "outbound" as const,
      subject: input.subject,
      snippetClean: input.snippetClean ?? input.bodyTextPreview,
      bodyTextPreview: input.bodyTextPreview,
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: null
    }
  };
}

function buildSalesforceOutboundEmailFixture(input: {
  readonly key: string;
  readonly email: string;
  readonly salesforceContactId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly subject: string;
  readonly snippet: string;
  readonly messageKind?: "auto" | "one_to_one";
}) {
  const messageKind = input.messageKind ?? "auto";

  return {
    sourceEvidence: {
      id: `sev_${input.key}`,
      provider: "salesforce" as const,
      providerRecordType: "task_communication",
      providerRecordId: `task-${input.key}`,
      receivedAt: input.receivedAt,
      occurredAt: input.occurredAt,
      payloadRef: `payloads/salesforce/${input.key}.json`,
      idempotencyKey: `salesforce:task_communication:${input.key}`,
      checksum: `checksum:${input.key}`
    },
    canonicalEvent: {
      id: `evt_${input.key}`,
      eventType: "communication.email.outbound" as const,
      occurredAt: input.occurredAt,
      idempotencyKey: `canonical:${input.key}`,
      summary: "Outbound email logged",
      snippet: input.snippet
    },
    communicationClassification:
      messageKind === "auto"
        ? buildAutoCommunicationClassification({
            sourceRecordType: "task_communication",
            sourceRecordId: `task-${input.key}`,
            direction: "outbound"
          })
        : buildOneToOneCommunicationClassification({
            sourceRecordType: "task_communication",
            sourceRecordId: `task-${input.key}`,
            direction: "outbound"
          }),
    identity: {
      salesforceContactId: input.salesforceContactId,
      volunteerIdPlainValues: [],
      normalizedEmails: [input.email],
      normalizedPhones: []
    },
    supportingSources: [],
    salesforceCommunicationDetail: {
      sourceEvidenceId: `sev_${input.key}`,
      providerRecordId: `task-${input.key}`,
      channel: "email" as const,
      messageKind,
      subject: input.subject,
      snippet: input.snippet,
      sourceLabel: messageKind === "auto" ? "Salesforce Flow" : "Salesforce Task"
    },
    salesforceEventContext: {
      sourceEvidenceId: `sev_${input.key}`,
      salesforceContactId: input.salesforceContactId,
      projectId: "project_default",
      expeditionId: "expedition_default",
      sourceField: null
    }
  };
}

async function expectExactlyOneCanonicalEvent(
  context: Awaited<ReturnType<typeof seedContactWithEmail>>,
  contactId: string
) {
  const canonicalEvents =
    await context.repositories.canonicalEvents.listByContactId(contactId);
  const timelineRows =
    await context.repositories.timelineProjection.listByContactId(contactId);

  expect(canonicalEvents).toHaveLength(1);
  expect(timelineRows).toHaveLength(1);

  const canonicalEvent = canonicalEvents[0];
  const timelineProjection = timelineRows[0];

  if (canonicalEvent === undefined || timelineProjection === undefined) {
    throw new Error("Expected exactly one canonical event and one timeline row.");
  }

  return {
    canonicalEvent,
    timelineProjection
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

  it("keeps Tori Rogers cross-provider duplicates to a single Gmail-ledger row regardless of arrival order", async () => {
    const toriEmail = "tori@example.org";
    const toriSalesforceContactId = "003-tori";
    const runSequence = async (order: readonly ("salesforce" | "gmail")[]) => {
      const context = await seedContactWithEmail(toriEmail, {
        contactId: "contact_tori",
        salesforceContactId: toriSalesforceContactId,
        displayName: "Tori Rogers"
      });
      const gmailFixture = buildGmailOutboundEmailFixture({
        key: "tori-gmail",
        email: toriEmail,
        salesforceContactId: toriSalesforceContactId,
        occurredAt: "2026-04-20T14:40:57.000Z",
        receivedAt: "2026-04-20T14:41:05.000Z",
        subject: "Re: Confirmed: Hex 13174",
        bodyTextPreview: "Confirmed. You are all set for Hex 13174.",
        snippetClean: "Confirmed. You are all set for Hex 13174."
      });
      const salesforceFixture = buildSalesforceOutboundEmailFixture({
        key: "tori-salesforce",
        email: toriEmail,
        salesforceContactId: toriSalesforceContactId,
        occurredAt: "2026-04-20T14:40:57.000Z",
        receivedAt: "2026-04-20T14:45:00.000Z",
        subject: "Re: Confirmed: Hex 13174",
        snippet: "Confirmed. You are all set for Hex 13174.",
        messageKind: "auto"
      });

      for (const source of order) {
        await context.normalization.applyNormalizedCanonicalEvent(
          source === "gmail" ? gmailFixture : salesforceFixture
        );
      }

      const { canonicalEvent, timelineProjection } =
        await expectExactlyOneCanonicalEvent(context, "contact_tori");
      expect(canonicalEvent.sourceEvidenceId).toBe("sev_tori-gmail");
      expect(canonicalEvent.provenance.primaryProvider).toBe("gmail");
      expect(canonicalEvent.provenance.winnerReason).toBe(
        "gmail_wins_duplicate_collapse"
      );
      expect(canonicalEvent.provenance.supportingSourceEvidenceIds).toEqual([
        "sev_tori-salesforce"
      ]);
      expect(canonicalEvent.provenance.messageKind).toBe("one_to_one");
      expect(timelineProjection.primaryProvider).toBe("gmail");

      await expect(
        context.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
          "sev_tori-salesforce"
        ])
      ).resolves.toHaveLength(1);
    };

    await runSequence(["salesforce", "gmail"]);
    await runSequence(["gmail", "salesforce"]);
  });

  it("keeps Rosie Yacoub duplicates to the earliest Gmail row while preserving Salesforce evidence", async () => {
    const context = await seedContactWithEmail("rosie@example.org", {
      contactId: "contact_rosie",
      salesforceContactId: "003-rosie",
      displayName: "Rosie Yacoub"
    });
    const firstGmail = buildGmailOutboundEmailFixture({
      key: "rosie-gmail-1",
      email: "rosie@example.org",
      salesforceContactId: "003-rosie",
      occurredAt: "2026-04-20T14:54:44.000Z",
      receivedAt: "2026-04-20T14:54:50.000Z",
      subject: "Re: still time to get involved?",
      bodyTextPreview:
        "There is still time to get involved if you want a spot on the next training.",
      snippetClean:
        "There is still time to get involved if you want a spot on the next training."
    });
    const secondGmail = buildGmailOutboundEmailFixture({
      key: "rosie-gmail-2",
      email: "rosie@example.org",
      salesforceContactId: "003-rosie",
      occurredAt: "2026-04-20T14:55:46.000Z",
      receivedAt: "2026-04-20T14:55:52.000Z",
      subject: "Re: still time to get involved?",
      bodyTextPreview:
        "There is still time to get involved if you want a spot on the next training.\n\nSent from my iPhone",
      snippetClean:
        "There is still time to get involved if you want a spot on the next training."
    });
    const salesforce = buildSalesforceOutboundEmailFixture({
      key: "rosie-salesforce",
      email: "rosie@example.org",
      salesforceContactId: "003-rosie",
      occurredAt: "2026-04-20T14:56:32.000Z",
      receivedAt: "2026-04-20T15:00:00.000Z",
      subject: "Re: still time to get involved?",
      snippet:
        "There is still time to get involved if you want a spot on the next training.",
      messageKind: "auto"
    });

    for (let pass = 0; pass < 2; pass += 1) {
      await context.normalization.applyNormalizedCanonicalEvent(firstGmail);
      await context.normalization.applyNormalizedCanonicalEvent(secondGmail);
      await context.normalization.applyNormalizedCanonicalEvent(salesforce);
    }

    const { canonicalEvent, timelineProjection } =
      await expectExactlyOneCanonicalEvent(context, "contact_rosie");
    expect(canonicalEvent.sourceEvidenceId).toBe("sev_rosie-gmail-1");
    expect(canonicalEvent.provenance.primaryProvider).toBe("gmail");
    expect(canonicalEvent.provenance.supportingSourceEvidenceIds).toEqual([
      "sev_rosie-gmail-2",
      "sev_rosie-salesforce"
    ]);
    expect(canonicalEvent.provenance.winnerReason).toBe(
      "gmail_wins_duplicate_collapse"
    );
    expect(canonicalEvent.provenance.messageKind).toBe("one_to_one");
    expect(canonicalEvent.occurredAt).toBe("2026-04-20T14:54:44.000Z");
    expect(timelineProjection.primaryProvider).toBe("gmail");
    await expect(
      context.repositories.inboxProjection.findByContactId("contact_rosie")
    ).resolves.toMatchObject({
      lastCanonicalEventId: "evt_rosie-gmail-1",
      lastOutboundAt: "2026-04-20T14:54:44.000Z"
    });
  });

  it("keeps Tani Thomas duplicates to the earliest Gmail row after normalization strips reply noise and tracking params", async () => {
    const context = await seedContactWithEmail("tani@example.org", {
      contactId: "contact_tani",
      salesforceContactId: "003-tani",
      displayName: "Tani Thomas"
    });
    const firstGmail = buildGmailOutboundEmailFixture({
      key: "tani-gmail-1",
      email: "tani@example.org",
      salesforceContactId: "003-tani",
      occurredAt: "2026-04-20T14:42:48.000Z",
      receivedAt: "2026-04-20T14:42:55.000Z",
      subject: "Re: Hex 31476: Were You Able to Pick Up Your ARU?",
      bodyTextPreview:
        "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_source=gmail&utm_campaign=follow-up",
      snippetClean:
        "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_source=gmail&utm_campaign=follow-up"
    });
    const secondGmail = buildGmailOutboundEmailFixture({
      key: "tani-gmail-2",
      email: "tani@example.org",
      salesforceContactId: "003-tani",
      occurredAt: "2026-04-20T14:43:14.000Z",
      receivedAt: "2026-04-20T14:43:18.000Z",
      subject: "Re: Hex 31476: Were You Able to Pick Up Your ARU?",
      bodyTextPreview:
        "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_medium=email&utm_campaign=follow-up\n\n--\nCecilia\n\nOn Mon, Apr 20, 2026 at 10:00 AM Tani wrote:\n> Checking in",
      snippetClean:
        "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_medium=email&utm_campaign=follow-up"
    });
    const salesforce = buildSalesforceOutboundEmailFixture({
      key: "tani-salesforce",
      email: "tani@example.org",
      salesforceContactId: "003-tani",
      occurredAt: "2026-04-20T14:43:12.000Z",
      receivedAt: "2026-04-20T14:48:00.000Z",
      subject: "→ Email: Re: Hex 31476: Were You Able to Pick Up Your ARU?",
      snippet:
        "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_term=aru",
      messageKind: "auto"
    });

    for (let pass = 0; pass < 2; pass += 1) {
      await context.normalization.applyNormalizedCanonicalEvent(firstGmail);
      await context.normalization.applyNormalizedCanonicalEvent(salesforce);
      await context.normalization.applyNormalizedCanonicalEvent(secondGmail);
    }

    const { canonicalEvent, timelineProjection } =
      await expectExactlyOneCanonicalEvent(context, "contact_tani");
    expect(canonicalEvent.sourceEvidenceId).toBe("sev_tani-gmail-1");
    expect(canonicalEvent.provenance.primaryProvider).toBe("gmail");
    expect(canonicalEvent.provenance.supportingSourceEvidenceIds).toEqual([
      "sev_tani-gmail-2",
      "sev_tani-salesforce"
    ]);
    expect(canonicalEvent.provenance.winnerReason).toBe(
      "gmail_wins_duplicate_collapse"
    );
    expect(canonicalEvent.occurredAt).toBe("2026-04-20T14:42:48.000Z");
    expect(timelineProjection.primaryProvider).toBe("gmail");
    await expect(
      context.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
        "sev_tani-salesforce"
      ])
    ).resolves.toHaveLength(1);
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
