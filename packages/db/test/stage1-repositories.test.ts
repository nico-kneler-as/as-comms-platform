import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";
import {
  inboxRecencyExpectedOrder,
  inboxRecencyFixture,
  inboxSentExpectedOrder,
} from "./fixtures/inbox-recency-fixture.js";

interface SalesforceCommunicationDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly channel: "email" | "sms";
  readonly messageKind: "one_to_one" | "auto" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
}

interface SimpleTextingMessageDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly direction: "inbound" | "outbound";
  readonly messageKind: "one_to_one" | "campaign";
  readonly messageTextPreview: string;
  readonly normalizedPhone: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly providerThreadId: string | null;
  readonly threadKey: string | null;
}

interface MailchimpCampaignActivityDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  readonly campaignId: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly campaignName: string | null;
  readonly snippet: string;
}

interface ManualNoteDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly body: string;
  readonly authorDisplayName: string | null;
  readonly authorId: string | null;
}

async function seedSharedInboxRecencyFixture(): Promise<{
  readonly repositories: Awaited<
    ReturnType<typeof createTestStage1Context>
  >["repositories"];
}> {
  const context = await createTestStage1Context();

  for (const [index, row] of inboxRecencyFixture.entries()) {
    await context.repositories.contacts.upsert({
      id: row.contactId,
      salesforceContactId: `003-recency-${index.toString()}`,
      displayName: row.displayName,
      primaryEmail: `${row.contactId}@example.org`,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    if (row.lastInboundAt !== null) {
      const inboundSourceEvidenceId = `sev-recency-inbound-${index.toString()}`;
      const inboundCanonicalEventId = `evt-recency-inbound-${index.toString()}`;

      await context.repositories.sourceEvidence.append({
        id: inboundSourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: inboundCanonicalEventId,
        receivedAt: row.lastInboundAt,
        occurredAt: row.lastInboundAt,
        payloadRef: `payloads/gmail/${inboundCanonicalEventId}.json`,
        idempotencyKey: `gmail:${inboundCanonicalEventId}`,
        checksum: `checksum:${inboundCanonicalEventId}`,
      });
      await context.repositories.canonicalEvents.upsert({
        id: inboundCanonicalEventId,
        contactId: row.contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: row.lastInboundAt,
        contentFingerprint: null,
        sourceEvidenceId: inboundSourceEvidenceId,
        idempotencyKey: `canonical:${inboundCanonicalEventId}`,
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: inboundSourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: inboundCanonicalEventId,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
    }

    if (row.lastOutboundAt !== null) {
      const outboundSourceEvidenceId = `sev-recency-outbound-${index.toString()}`;
      const outboundCanonicalEventId = `evt-recency-outbound-${index.toString()}`;

      await context.repositories.sourceEvidence.append({
        id: outboundSourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: outboundCanonicalEventId,
        receivedAt: row.lastOutboundAt,
        occurredAt: row.lastOutboundAt,
        payloadRef: `payloads/gmail/${outboundCanonicalEventId}.json`,
        idempotencyKey: `gmail:${outboundCanonicalEventId}`,
        checksum: `checksum:${outboundCanonicalEventId}`,
      });
      await context.repositories.canonicalEvents.upsert({
        id: outboundCanonicalEventId,
        contactId: row.contactId,
        eventType: "communication.email.outbound",
        channel: "email",
        occurredAt: row.lastOutboundAt,
        contentFingerprint: null,
        sourceEvidenceId: outboundSourceEvidenceId,
        idempotencyKey: `canonical:${outboundCanonicalEventId}`,
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: outboundSourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: outboundCanonicalEventId,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "outbound",
          notes: null,
        },
        reviewState: "clear",
      });
    }

    await context.repositories.inboxProjection.upsert({
      contactId: row.contactId,
      bucket: row.lastInboundAt === null ? "Opened" : "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: row.lastInboundAt,
      lastOutboundAt: row.lastOutboundAt,
      lastActivityAt: row.lastActivityAt,
      snippet: `${row.displayName} preview`,
      lastCanonicalEventId:
        row.lastActivityAt === row.lastInboundAt
          ? `evt-recency-inbound-${index.toString()}`
          : `evt-recency-outbound-${index.toString()}`,
      lastEventType:
        row.lastActivityAt === row.lastInboundAt
          ? "communication.email.inbound"
          : "communication.email.outbound",
    });
  }

  return context;
}

describe("Stage 1 DB repositories", () => {
  it("persists and maps source evidence, contacts, identities, and memberships", async () => {
    const { repositories, settings } = await createTestStage1Context();

    await settings.users.upsert({
      id: "user:stage-one",
      name: "Stage One Operator",
      email: "stage-one@example.org",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const sourceEvidence = await repositories.sourceEvidence.append({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1",
    });

    expect(
      await repositories.sourceEvidence.findById(sourceEvidence.id),
    ).toEqual(sourceEvidence);
    await expect(
      repositories.sourceEvidence.findByIdempotencyKey(
        sourceEvidence.idempotencyKey,
      ),
    ).resolves.toEqual(sourceEvidence);
    await expect(
      repositories.sourceEvidence.listByProviderRecord({
        provider: sourceEvidence.provider,
        providerRecordType: sourceEvidence.providerRecordType,
        providerRecordId: sourceEvidence.providerRecordId,
      }),
    ).resolves.toEqual([sourceEvidence]);

    const contact = await repositories.contacts.upsert({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(repositories.contacts.findById(contact.id)).resolves.toEqual(
      contact,
    );
    await expect(
      repositories.contacts.findBySalesforceContactId("003-stage1"),
    ).resolves.toEqual(contact);
    await expect(
      repositories.contacts.listByIds([contact.id]),
    ).resolves.toEqual([contact]);

    const identity = await repositories.contactIdentities.upsert({
      id: "identity_1",
      contactId: contact.id,
      kind: "email",
      normalizedValue: "volunteer@example.org",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });

    const membership = await repositories.contactMemberships.upsert({
      id: "membership_1",
      contactId: contact.id,
      projectId: "project_1",
      expeditionId: "expedition_1",
      role: "volunteer",
      status: "active",
      source: "salesforce",
    });

    await expect(
      repositories.contactIdentities.listByContactId(contact.id),
    ).resolves.toEqual([identity]);
    await expect(
      repositories.contactIdentities.listByNormalizedValue({
        kind: "email",
        normalizedValue: "volunteer@example.org",
      }),
    ).resolves.toEqual([identity]);
    await expect(
      repositories.contactMemberships.listByContactId(contact.id),
    ).resolves.toEqual([membership]);
    await expect(
      repositories.contactMemberships.listByContactIds([contact.id]),
    ).resolves.toEqual([membership]);

    const projectDimension = await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      source: "salesforce",
    });
    const expeditionDimension = await repositories.expeditionDimensions.upsert({
      expeditionId: "expedition_1",
      projectId: "project_1",
      expeditionName: "Expedition Antarctica",
      source: "salesforce",
    });
    const gmailDetail = await repositories.gmailMessageDetails.upsert({
      sourceEvidenceId: sourceEvidence.id,
      providerRecordId: sourceEvidence.providerRecordId,
      gmailThreadId: "thread_1",
      rfc822MessageId: "<gmail-message-1@example.org>",
      direction: "inbound",
      subject: "Hello there",
      snippetClean: "Hello there",
      bodyTextPreview: "Hello there from the volunteer mailbox.",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-antarctica@example.org",
    });
    const salesforceContext = await repositories.salesforceEventContext.upsert({
      sourceEvidenceId: sourceEvidence.id,
      salesforceContactId: contact.salesforceContactId,
      projectId: "project_1",
      expeditionId: "expedition_1",
      sourceField: null,
    });
    const salesforceCommunicationDetail =
      (await repositories.salesforceCommunicationDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        channel: "email",
        messageKind: "auto",
        subject: "Automation complete",
        snippet: "Your workflow completed successfully.",
        sourceLabel: "Salesforce Flow",
      })) as SalesforceCommunicationDetailRecord;
    const simpleTextingMessageDetail =
      (await repositories.simpleTextingMessageDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        direction: "outbound",
        messageKind: "campaign",
        messageTextPreview: "Campaign kickoff reminder",
        normalizedPhone: "+15555550123",
        campaignId: "campaign_sms_1",
        campaignName: "Volunteer Reminders",
        providerThreadId: "thread_1",
        threadKey: "thread-key-1",
      })) as SimpleTextingMessageDetailRecord;
    const mailchimpCampaignActivityDetail =
      (await repositories.mailchimpCampaignActivityDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        activityType: "sent",
        campaignId: "campaign_email_1",
        audienceId: "audience_1",
        memberId: "member_1",
        campaignName: "Spring Launch",
        snippet: "Campaign launch message",
      })) as MailchimpCampaignActivityDetailRecord;
    const manualNoteDetail = (await repositories.manualNoteDetails.upsert({
      sourceEvidenceId: sourceEvidence.id,
      providerRecordId: sourceEvidence.providerRecordId,
      body: "Follow up after the kickoff call.",
      authorDisplayName: "Stage One Operator",
      authorId: "user:stage-one",
    })) as ManualNoteDetailRecord;

    await expect(
      repositories.projectDimensions.listByIds(["project_1"]),
    ).resolves.toEqual([projectDimension]);
    await expect(
      repositories.expeditionDimensions.listByIds(["expedition_1"]),
    ).resolves.toEqual([expeditionDimension]);
    await expect(
      repositories.gmailMessageDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([gmailDetail]);
    await expect(
      repositories.salesforceEventContext.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([salesforceContext]);
    await expect(
      repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([salesforceCommunicationDetail]);
    await expect(
      repositories.simpleTextingMessageDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([simpleTextingMessageDetail]);
    await expect(
      repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([mailchimpCampaignActivityDetail]);
    await expect(
      repositories.manualNoteDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([manualNoteDetail]);
  });

  it("persists canonical events, review queues, and projections", async () => {
    const { repositories } = await createTestStage1Context();

    await repositories.contacts.upsert({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await repositories.sourceEvidence.append({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1",
    });

    const canonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-01-01T00:00:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_1",
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_1",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });

    const identityCase = await repositories.identityResolutionQueue.upsert({
      id: "identity_case_1",
      sourceEvidenceId: "sev_1",
      candidateContactIds: ["contact_1"],
      reasonCode: "identity_missing_anchor",
      status: "open",
      openedAt: "2026-01-01T00:02:00.000Z",
      resolvedAt: null,
      normalizedIdentityValues: ["volunteer@example.org"],
      anchoredContactId: "contact_1",
      explanation: "Needs explicit confirmation for the first Stage 1 pass.",
    });

    const routingCase = await repositories.routingReviewQueue.upsert({
      id: "routing_case_1",
      contactId: "contact_1",
      sourceEvidenceId: "sev_1",
      reasonCode: "routing_missing_membership",
      status: "open",
      openedAt: "2026-01-01T00:03:00.000Z",
      resolvedAt: null,
      candidateMembershipIds: [],
      explanation: "Project context is intentionally absent in this fixture.",
    });

    const inboxProjection = await repositories.inboxProjection.upsert({
      contactId: "contact_1",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: true,
      lastInboundAt: "2026-01-01T00:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      snippet: "Inbound hello",
      lastCanonicalEventId: canonicalEvent.id,
      lastEventType: "communication.email.inbound",
    });

    const timelineProjection = await repositories.timelineProjection.upsert({
      id: "timeline_1",
      contactId: "contact_1",
      canonicalEventId: canonicalEvent.id,
      occurredAt: canonicalEvent.occurredAt,
      sortKey: "2026-01-01T00:00:00.000Z::evt_1",
      eventType: canonicalEvent.eventType,
      summary: "Inbound email received",
      channel: canonicalEvent.channel,
      primaryProvider: "gmail",
      reviewState: "clear",
    });
    await repositories.contacts.upsert({
      id: "contact_2",
      salesforceContactId: "003-stage1-secondary",
      displayName: "Another Volunteer",
      primaryEmail: "another@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "sev_2",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-2",
      receivedAt: "2026-01-01T00:11:00.000Z",
      occurredAt: "2026-01-01T00:10:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-2.json",
      idempotencyKey: "gmail:message:gmail-message-2",
      checksum: "checksum-2",
    });
    const secondCanonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_2",
      contactId: "contact_2",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-01-01T00:10:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_2",
      idempotencyKey: "canonical:gmail-message-2",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_2",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-2",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null,
      },
      reviewState: "clear",
    });
    const secondInboxProjection = await repositories.inboxProjection.upsert({
      contactId: "contact_2",
      bucket: "Opened",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-01-01T00:10:00.000Z",
      lastActivityAt: "2026-01-01T00:10:00.000Z",
      snippet: "Outbound only follow-up",
      lastCanonicalEventId: secondCanonicalEvent.id,
      lastEventType: "communication.email.outbound",
    });

    await expect(
      repositories.canonicalEvents.findByIdempotencyKey(
        canonicalEvent.idempotencyKey,
      ),
    ).resolves.toEqual(canonicalEvent);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_1"),
    ).resolves.toEqual([canonicalEvent]);
    await expect(
      repositories.canonicalEvents.listByIds([canonicalEvent.id]),
    ).resolves.toEqual([canonicalEvent]);
    await expect(
      repositories.identityResolutionQueue.listOpenByContactId("contact_1"),
    ).resolves.toEqual([identityCase]);
    await expect(
      repositories.identityResolutionQueue.listOpenByReasonCode(
        "identity_missing_anchor",
      ),
    ).resolves.toEqual([identityCase]);
    await expect(
      repositories.routingReviewQueue.listOpenByContactId("contact_1"),
    ).resolves.toEqual([routingCase]);
    await expect(
      repositories.routingReviewQueue.listOpenByReasonCode(
        "routing_missing_membership",
      ),
    ).resolves.toEqual([routingCase]);
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toEqual(inboxProjection);
    await expect(
      repositories.inboxProjection.listAllOrderedByRecency(),
    ).resolves.toEqual([inboxProjection, secondInboxProjection]);
    await expect(
      repositories.inboxProjection.setNeedsFollowUp({
        contactId: "contact_1",
        needsFollowUp: true,
      }),
    ).resolves.toEqual({
      ...inboxProjection,
      needsFollowUp: true,
    });
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toEqual({
      ...inboxProjection,
      needsFollowUp: true,
    });
    await repositories.inboxProjection.deleteByContactId("contact_1");
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toBeNull();
    await expect(
      repositories.timelineProjection.findByCanonicalEventId(canonicalEvent.id),
    ).resolves.toEqual(timelineProjection);
    await expect(
      repositories.timelineProjection.listByContactId("contact_1"),
    ).resolves.toEqual([timelineProjection]);
  });

  it("persists sync state and audit evidence with contract-shaped results", async () => {
    const { repositories } = await createTestStage1Context();

    const syncRecord = await repositories.syncState.upsert({
      id: "sync_1",
      scope: "provider",
      provider: "gmail",
      jobType: "historical_backfill",
      cursor: "cursor-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-02T00:00:00.000Z",
      status: "running",
      parityPercent: 99.5,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-01-01T01:00:00.000Z",
      deadLetterCount: 2,
    });

    const syncUpdate = await repositories.syncState.upsert({
      ...syncRecord,
      status: "succeeded",
      parityPercent: 100,
      deadLetterCount: 0,
    });

    const auditRecord = await repositories.auditEvidence.append({
      id: "audit_1",
      actorType: "system",
      actorId: "stage1-test",
      action: "persisted_contact",
      entityType: "contact",
      entityId: "contact_1",
      occurredAt: "2026-01-01T01:05:00.000Z",
      result: "recorded",
      policyCode: "stage1.audit.test",
      metadataJson: {
        reason: "repository-integration",
      },
    });

    expect(syncUpdate.parityPercent).toBe(100);
    expect(syncUpdate.scope).toBe("provider");
    expect(syncUpdate.provider).toBe("gmail");
    await expect(
      repositories.syncState.findLatest({
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
      }),
    ).resolves.toEqual(syncUpdate);
    await expect(
      repositories.auditEvidence.listByEntity({
        entityType: "contact",
        entityId: "contact_1",
      }),
    ).resolves.toEqual([auditRecord]);
  });

  it("lists contacts whose inbox recency projection is still invalid", async () => {
    const { client, repositories } = await createTestStage1Context();

    await repositories.contacts.upsert({
      id: "contact_invalid",
      salesforceContactId: "003-invalid",
      displayName: "Invalid Projection",
      primaryEmail: "invalid@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "sev_invalid",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-invalid",
      receivedAt: "2026-01-01T00:05:00.000Z",
      occurredAt: "2026-01-01T00:05:00.000Z",
      payloadRef: "payloads/gmail/gmail-invalid.json",
      idempotencyKey: "gmail:invalid",
      checksum: "checksum-invalid",
    });
    await repositories.canonicalEvents.upsert({
      id: "evt_invalid",
      contactId: "contact_invalid",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-01-01T00:05:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_invalid",
      idempotencyKey: "canonical:invalid",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_invalid",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-invalid",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null,
      },
      reviewState: "clear",
    });

    await client.exec(`
      insert into contact_inbox_projection (
        contact_id,
        bucket,
        is_starred,
        has_unresolved,
        last_inbound_at,
        last_outbound_at,
        last_activity_at,
        snippet,
        last_canonical_event_id,
        last_event_type
      ) values (
        'contact_invalid',
        'Opened',
        false,
        false,
        '2026-01-01T00:01:00.000Z',
        '2026-01-01T00:05:00.000Z',
        '2026-01-01T00:01:00.000Z',
        'Legacy stale projection',
        'evt_invalid',
        'communication.email.outbound'
      );
    `);

    await expect(
      repositories.inboxProjection.countInvalidRecencyRows(),
    ).resolves.toBe(1);
    await expect(
      repositories.inboxProjection.listInvalidRecencyContactIds(),
    ).resolves.toEqual(["contact_invalid"]);
  });

  it("orders and paginates inbox rows with null inbound timestamps last", async () => {
    const { repositories } = await seedSharedInboxRecencyFixture();

    const orderedRows =
      await repositories.inboxProjection.listAllOrderedByRecency();

    expect(orderedRows.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder,
    );

    const firstPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "all",
        order: "last-inbound",
        limit: 4,
        cursor: null,
      });

    expect(firstPage.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(0, 4),
    );

    const secondPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "all",
        order: "last-inbound",
        limit: 4,
        cursor: {
          lastInboundAt: firstPage[firstPage.length - 1]?.lastInboundAt ?? null,
          lastOutboundAt:
            firstPage[firstPage.length - 1]?.lastOutboundAt ?? null,
          lastActivityAt: firstPage[firstPage.length - 1]?.lastActivityAt ?? "",
          contactId: firstPage[firstPage.length - 1]?.contactId ?? "",
        },
      });

    expect(secondPage.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(4),
    );
  });

  it("orders and paginates sent inbox rows by last outbound timestamps", async () => {
    const { repositories } = await seedSharedInboxRecencyFixture();

    const firstPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "sent",
        order: "last-outbound",
        limit: 2,
        cursor: null,
      });

    expect(firstPage.map((row) => row.contactId)).toEqual(
      inboxSentExpectedOrder.slice(0, 2),
    );

    const secondPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "sent",
        order: "last-outbound",
        limit: 2,
        cursor: {
          lastInboundAt: firstPage[firstPage.length - 1]?.lastInboundAt ?? null,
          lastOutboundAt:
            firstPage[firstPage.length - 1]?.lastOutboundAt ?? null,
          lastActivityAt: firstPage[firstPage.length - 1]?.lastActivityAt ?? "",
          contactId: firstPage[firstPage.length - 1]?.contactId ?? "",
        },
      });

    expect(secondPage.map((row) => row.contactId)).toEqual(
      inboxSentExpectedOrder.slice(2),
    );
  });
});
