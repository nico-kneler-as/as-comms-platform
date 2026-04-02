import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

describe("Stage 1 DB repositories", () => {
  it("persists and maps source evidence, contacts, identities, and memberships", async () => {
    const { repositories } = await createTestStage1Context();

    const sourceEvidence = await repositories.sourceEvidence.append({
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

    expect(await repositories.sourceEvidence.findById(sourceEvidence.id)).toEqual(
      sourceEvidence
    );
    await expect(
      repositories.sourceEvidence.findByIdempotencyKey(sourceEvidence.idempotencyKey)
    ).resolves.toEqual(sourceEvidence);
    await expect(
      repositories.sourceEvidence.listByProviderRecord({
        provider: sourceEvidence.provider,
        providerRecordType: sourceEvidence.providerRecordType,
        providerRecordId: sourceEvidence.providerRecordId
      })
    ).resolves.toEqual([sourceEvidence]);

    const contact = await repositories.contacts.upsert({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    await expect(repositories.contacts.findById(contact.id)).resolves.toEqual(
      contact
    );
    await expect(
      repositories.contacts.findBySalesforceContactId("003-stage1")
    ).resolves.toEqual(contact);

    const identity = await repositories.contactIdentities.upsert({
      id: "identity_1",
      contactId: contact.id,
      kind: "email",
      normalizedValue: "volunteer@example.org",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-01-01T00:00:00.000Z"
    });

    const membership = await repositories.contactMemberships.upsert({
      id: "membership_1",
      contactId: contact.id,
      projectId: "project_1",
      expeditionId: "expedition_1",
      role: "volunteer",
      status: "active",
      source: "salesforce"
    });

    await expect(
      repositories.contactIdentities.listByContactId(contact.id)
    ).resolves.toEqual([identity]);
    await expect(
      repositories.contactIdentities.listByNormalizedValue({
        kind: "email",
        normalizedValue: "volunteer@example.org"
      })
    ).resolves.toEqual([identity]);
    await expect(
      repositories.contactMemberships.listByContactId(contact.id)
    ).resolves.toEqual([membership]);

    const projectDimension = await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      source: "salesforce"
    });
    const expeditionDimension = await repositories.expeditionDimensions.upsert({
      expeditionId: "expedition_1",
      projectId: "project_1",
      expeditionName: "Expedition Antarctica",
      source: "salesforce"
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
      projectInboxAlias: "project-antarctica@example.org"
    });
    const salesforceContext = await repositories.salesforceEventContext.upsert({
      sourceEvidenceId: sourceEvidence.id,
      salesforceContactId: contact.salesforceContactId,
      projectId: "project_1",
      expeditionId: "expedition_1"
    });

    await expect(
      repositories.projectDimensions.listByIds(["project_1"])
    ).resolves.toEqual([projectDimension]);
    await expect(
      repositories.expeditionDimensions.listByIds(["expedition_1"])
    ).resolves.toEqual([expeditionDimension]);
    await expect(
      repositories.gmailMessageDetails.listBySourceEvidenceIds([sourceEvidence.id])
    ).resolves.toEqual([gmailDetail]);
    await expect(
      repositories.salesforceEventContext.listBySourceEvidenceIds([
        sourceEvidence.id
      ])
    ).resolves.toEqual([salesforceContext]);
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
      updatedAt: "2026-01-01T00:00:00.000Z"
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
      checksum: "checksum-1"
    });

    const canonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceId: "sev_1",
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_1",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source"
      },
      reviewState: "clear"
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
      explanation: "Needs explicit confirmation for the first Stage 1 pass."
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
      explanation: "Project context is intentionally absent in this fixture."
    });

    const inboxProjection = await repositories.inboxProjection.upsert({
      contactId: "contact_1",
      bucket: "New",
      isStarred: false,
      hasUnresolved: true,
      lastInboundAt: "2026-01-01T00:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      snippet: "Inbound hello",
      lastCanonicalEventId: canonicalEvent.id,
      lastEventType: "communication.email.inbound"
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
      reviewState: "clear"
    });

    await expect(
      repositories.canonicalEvents.findByIdempotencyKey(
        canonicalEvent.idempotencyKey
      )
    ).resolves.toEqual(canonicalEvent);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_1")
    ).resolves.toEqual([canonicalEvent]);
    await expect(
      repositories.identityResolutionQueue.listOpenByReasonCode(
        "identity_missing_anchor"
      )
    ).resolves.toEqual([identityCase]);
    await expect(
      repositories.routingReviewQueue.listOpenByReasonCode(
        "routing_missing_membership"
      )
    ).resolves.toEqual([routingCase]);
    await expect(
      repositories.inboxProjection.findByContactId("contact_1")
    ).resolves.toEqual(inboxProjection);
    await expect(
      repositories.timelineProjection.findByCanonicalEventId(canonicalEvent.id)
    ).resolves.toEqual(timelineProjection);
    await expect(
      repositories.timelineProjection.listByContactId("contact_1")
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
      deadLetterCount: 2
    });

    const syncUpdate = await repositories.syncState.upsert({
      ...syncRecord,
      status: "succeeded",
      parityPercent: 100,
      deadLetterCount: 0
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
        reason: "repository-integration"
      }
    });

    expect(syncUpdate.parityPercent).toBe(100);
    expect(syncUpdate.scope).toBe("provider");
    expect(syncUpdate.provider).toBe("gmail");
    await expect(
      repositories.syncState.findLatest({
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill"
      })
    ).resolves.toEqual(syncUpdate);
    await expect(
      repositories.auditEvidence.listByEntity({
        entityType: "contact",
        entityId: "contact_1"
      })
    ).resolves.toEqual([auditRecord]);
  });
});
