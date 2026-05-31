import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

const BASE_TIMESTAMP = "2026-04-21T12:00:00.000Z";

async function seedFixture() {
  const context = await createTestStage1Context();

  await context.repositories.projectDimensions.upsert({
    projectId: "project-pollinators",
    projectName: "Pollinator Watch",
    projectAlias: "pollinators",
    isActive: true,
    source: "salesforce",
  });

  // Inactive project used to validate that PAST memberships still flip a
  // contact into the Volunteers section even when the project is no longer
  // active.
  await context.repositories.projectDimensions.upsert({
    projectId: "project-archived",
    projectName: "Archived Watch",
    projectAlias: null,
    isActive: false,
    source: "salesforce",
  });

  return context;
}

async function seedSignedUpEvent(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly occurredAt: string;
    readonly idSuffix: string;
  },
) {
  const sourceEvidenceId = `sev-${input.idSuffix}`;
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "campaign-member",
    providerRecordId: `cm-${input.idSuffix}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.idSuffix}.json`,
    idempotencyKey: `salesforce:${input.idSuffix}`,
    checksum: `checksum:${input.idSuffix}`,
  });
  await context.repositories.canonicalEvents.upsert({
    id: `evt-${input.idSuffix}`,
    contactId: input.contactId,
    eventType: "lifecycle.signed_up",
    channel: "lifecycle",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:evt-${input.idSuffix}`,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "campaign-member",
      sourceRecordId: `cm-${input.idSuffix}`,
      messageKind: null,
      campaignRef: null,
      threadRef: null,
      direction: null,
      notes: null,
    },
    reviewState: "clear",
  });
  return { sourceEvidenceId, canonicalEventId: `evt-${input.idSuffix}` };
}

async function seedInboxProjection(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly snippet: string;
    readonly occurredAt: string;
    readonly canonicalEventId: string;
  },
) {
  await context.repositories.inboxProjection.upsert({
    contactId: input.contactId,
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: input.occurredAt,
    lastOutboundAt: null,
    lastActivityAt: input.occurredAt,
    snippet: input.snippet,
    archivedAt: null,
    lastCanonicalEventId: input.canonicalEventId,
    lastEventType: "communication.email.inbound",
  });
}

async function seedInboundEmail(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly occurredAt: string;
    readonly idSuffix: string;
    readonly subject: string | null;
    readonly fromHeader?: string | null;
    readonly toHeader?: string | null;
    readonly ccHeader?: string | null;
  },
) {
  const sourceEvidenceId = `sev-${input.idSuffix}`;
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: `gm-${input.idSuffix}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.idSuffix}.json`,
    idempotencyKey: `gmail:${input.idSuffix}`,
    checksum: `checksum:${input.idSuffix}`,
  });
  const canonicalEventId = `evt-${input.idSuffix}`;
  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:evt-${input.idSuffix}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: `gm-${input.idSuffix}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: "inbound",
      notes: null,
    },
    reviewState: "clear",
  });
  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: `gm-${input.idSuffix}`,
    gmailThreadId: `thread-${input.idSuffix}`,
    rfc822MessageId: `<msg-${input.idSuffix}@gmail.test>`,
    direction: "inbound",
    fromHeader: input.fromHeader ?? "sender@example.org",
    toHeader: input.toHeader ?? "alias@example.org",
    ccHeader: input.ccHeader ?? null,
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    subject: input.subject,
    labelIds: [],
    snippetClean: "snippet",
    bodyTextPreview: "body",
    bodyKind: "plaintext",
    capturedMailbox: null,
    projectInboxAlias: null,
  });
  return { sourceEvidenceId, canonicalEventId };
}

async function seedAudienceParticipant(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly canonicalEventId: string;
    readonly contactId: string;
    readonly participantRole: "sender" | "direct_recipient" | "cc" | "bcc";
    readonly normalizedEmail: string;
  },
) {
  await context.repositories.canonicalEventAudience.upsert({
    canonicalEventId: input.canonicalEventId,
    contactId: input.contactId,
    participantRole: input.participantRole,
    normalizedEmail: input.normalizedEmail,
  });
}

async function seedOutboundEmail(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly occurredAt: string;
    readonly idSuffix: string;
  },
) {
  const sourceEvidenceId = `sev-${input.idSuffix}`;
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: `gm-${input.idSuffix}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.idSuffix}.json`,
    idempotencyKey: `gmail:${input.idSuffix}`,
    checksum: `checksum:${input.idSuffix}`,
  });
  await context.repositories.canonicalEvents.upsert({
    id: `evt-${input.idSuffix}`,
    contactId: input.contactId,
    eventType: "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:evt-${input.idSuffix}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: `gm-${input.idSuffix}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });
}

async function seedInboundSalesforceEmail(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly occurredAt: string;
    readonly idSuffix: string;
    readonly subject: string | null;
  },
) {
  const sourceEvidenceId = `sev-${input.idSuffix}`;
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "task",
    providerRecordId: `sf-${input.idSuffix}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.idSuffix}.json`,
    idempotencyKey: `salesforce:${input.idSuffix}`,
    checksum: `checksum:${input.idSuffix}`,
  });
  const canonicalEventId = `evt-${input.idSuffix}`;
  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:evt-${input.idSuffix}`,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "task",
      sourceRecordId: `sf-${input.idSuffix}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: "inbound",
      notes: null,
    },
    reviewState: "clear",
  });
  await context.repositories.salesforceCommunicationDetails.upsert({
    sourceEvidenceId,
    providerRecordId: `sf-${input.idSuffix}`,
    channel: "email",
    messageKind: "one_to_one",
    subject: input.subject,
    snippet: "salesforce snippet",
    sourceLabel: "Salesforce",
  });
  return { sourceEvidenceId, canonicalEventId };
}

async function seedCampaignSentEvent(
  context: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly contactId: string;
    readonly occurredAt: string;
    readonly idSuffix: string;
  },
) {
  const sourceEvidenceId = `sev-${input.idSuffix}`;
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "mailchimp",
    providerRecordType: "campaign-activity",
    providerRecordId: `mc-${input.idSuffix}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/mailchimp/${input.idSuffix}.json`,
    idempotencyKey: `mailchimp:${input.idSuffix}`,
    checksum: `checksum:${input.idSuffix}`,
  });
  await context.repositories.canonicalEvents.upsert({
    id: `evt-${input.idSuffix}`,
    contactId: input.contactId,
    eventType: "campaign.email.sent",
    channel: "campaign_email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:evt-${input.idSuffix}`,
    provenance: {
      primaryProvider: "mailchimp",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "campaign-activity",
      sourceRecordId: `mc-${input.idSuffix}`,
      messageKind: null,
      campaignRef: {
        providerCampaignId: `camp-${input.idSuffix}`,
        providerAudienceId: null,
        providerMessageName: null,
      },
      threadRef: null,
      direction: null,
      notes: null,
    },
    reviewState: "clear",
  });
}

describe("contact repository searchInboxUnified", () => {
  it("places a contact with one PAST membership in volunteers (any-membership-ever rule)", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:past-member";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-pm",
        displayName: "Past Member Pat",
        primaryEmail: "pat@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      // Past membership on an inactive project — still counts.
      await context.repositories.contactMemberships.upsert({
        id: "membership-pat-past",
        contactId,
        projectId: "project-archived",
        expeditionId: null,
        salesforceMembershipId: "sf-pat-past",
        role: "volunteer",
        status: "inactive",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Past",
        limit: 25,
      });

      expect(result.volunteers).toHaveLength(1);
      expect(result.volunteers[0]?.contact.id).toBe(contactId);
      expect(result.volunteers[0]?.hasMembership).toBe(true);
      expect(result.contacts).toHaveLength(0);
      expect(result.totals.volunteers).toBe(1);
      expect(result.totals.contacts).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  it("places a contact with zero memberships in contacts", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:no-membership";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: "Solo Walker",
        primaryEmail: "solo@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Solo",
        limit: 25,
      });

      expect(result.volunteers).toHaveLength(0);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.hasMembership).toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("sorts each section by last volunteer-side activity desc — outbound 1:1 sends do NOT influence the sort", async () => {
    const context = await seedFixture();

    try {
      // Volunteer A: inbound email at 2026-01-01
      const aId = "contact:vol-a";
      await context.repositories.contacts.upsert({
        id: aId,
        salesforceContactId: "003-a",
        displayName: "Sortable Alpha",
        primaryEmail: "alpha@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-a",
        contactId: aId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-a",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: aId,
        occurredAt: "2026-01-01T00:00:00.000Z",
        idSuffix: "a-inb",
        subject: "alpha inbound",
      });

      // Volunteer B: inbound email at 2025-01-01, but outbound send at
      // 2026-04-01 (later than A's inbound). Sort key must IGNORE the
      // outbound — B should still rank below A.
      const bId = "contact:vol-b";
      await context.repositories.contacts.upsert({
        id: bId,
        salesforceContactId: "003-b",
        displayName: "Sortable Beta",
        primaryEmail: "beta@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-b",
        contactId: bId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-b",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: bId,
        occurredAt: "2025-01-01T00:00:00.000Z",
        idSuffix: "b-inb",
        subject: "beta inbound",
      });
      await seedOutboundEmail(context, {
        contactId: bId,
        occurredAt: "2026-04-01T00:00:00.000Z",
        idSuffix: "b-out",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Sortable",
        limit: 25,
      });

      expect(result.volunteers.map((row) => row.contact.id)).toEqual([
        aId,
        bId,
      ]);
      // B's lastActivityAt should be its inbound (2025), not its outbound.
      expect(result.volunteers[1]?.lastActivityAt).toBe(
        "2025-01-01T00:00:00.000Z",
      );
    } finally {
      await context.dispose();
    }
  });

  it("campaign events do NOT influence the sort", async () => {
    const context = await seedFixture();

    try {
      // Volunteer A: lifecycle signup at 2026-01-01
      const aId = "contact:camp-a";
      await context.repositories.contacts.upsert({
        id: aId,
        salesforceContactId: "003-ca",
        displayName: "Camp Alpha",
        primaryEmail: "ca@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-camp-a",
        contactId: aId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-ca",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedSignedUpEvent(context, {
        contactId: aId,
        occurredAt: "2026-01-01T00:00:00.000Z",
        idSuffix: "ca-signup",
      });

      // Volunteer B: signup at 2024-01-01, campaign sent at 2026-05-01.
      // Campaign event should NOT bump B above A.
      const bId = "contact:camp-b";
      await context.repositories.contacts.upsert({
        id: bId,
        salesforceContactId: "003-cb",
        displayName: "Camp Beta",
        primaryEmail: "cb@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-camp-b",
        contactId: bId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-cb",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedSignedUpEvent(context, {
        contactId: bId,
        occurredAt: "2024-01-01T00:00:00.000Z",
        idSuffix: "cb-signup",
      });
      await seedCampaignSentEvent(context, {
        contactId: bId,
        occurredAt: "2026-05-01T00:00:00.000Z",
        idSuffix: "cb-camp",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Camp",
        limit: 25,
      });

      expect(result.volunteers.map((row) => row.contact.id)).toEqual([
        aId,
        bId,
      ]);
      expect(result.volunteers[1]?.lastActivityAt).toBe(
        "2024-01-01T00:00:00.000Z",
      );
    } finally {
      await context.dispose();
    }
  });

  it("a contact with only outbound + campaign events sorts to the bottom of its section (NULL lastActivityAt)", async () => {
    const context = await seedFixture();

    try {
      // Volunteer with only outbound + campaign events. No volunteer-side
      // events → lastActivityAt is null and sorts last.
      const aId = "contact:bottom-a";
      await context.repositories.contacts.upsert({
        id: aId,
        salesforceContactId: "003-ba",
        displayName: "Bottom Alpha",
        primaryEmail: "ba@example.org",
        primaryPhone: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-ba",
        contactId: aId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-ba",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedOutboundEmail(context, {
        contactId: aId,
        occurredAt: "2026-05-01T00:00:00.000Z",
        idSuffix: "ba-out",
      });
      await seedCampaignSentEvent(context, {
        contactId: aId,
        occurredAt: "2026-05-02T00:00:00.000Z",
        idSuffix: "ba-camp",
      });

      // Volunteer with one inbound — should sort first.
      const bId = "contact:bottom-b";
      await context.repositories.contacts.upsert({
        id: bId,
        salesforceContactId: "003-bb",
        displayName: "Bottom Beta",
        primaryEmail: "bb@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-bb",
        contactId: bId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-bb",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: bId,
        occurredAt: "2026-02-01T00:00:00.000Z",
        idSuffix: "bb-inb",
        subject: "beta hello",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Bottom",
        limit: 25,
      });

      // Beta (with inbound) ranks first; Alpha (only outbound + campaign)
      // ranks last with null lastActivityAt.
      expect(result.volunteers.map((row) => row.contact.id)).toEqual([
        bId,
        aId,
      ]);
      expect(result.volunteers[1]?.lastActivityAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("caps each section at the limit and reports pre-truncation totals", async () => {
    const context = await seedFixture();

    try {
      // 30 volunteers all matching "Bulky".
      for (let i = 0; i < 30; i += 1) {
        const id = `contact:vol-${String(i).padStart(2, "0")}`;
        await context.repositories.contacts.upsert({
          id,
          salesforceContactId: null,
          displayName: `Bulky Vol ${String(i).padStart(2, "0")}`,
          primaryEmail: `vol-${String(i).padStart(2, "0")}@example.org`,
          primaryPhone: null,
          createdAt: BASE_TIMESTAMP,
          updatedAt: BASE_TIMESTAMP,
        });
        await context.repositories.contactMemberships.upsert({
          id: `mem-vol-${String(i).padStart(2, "0")}`,
          contactId: id,
          projectId: "project-pollinators",
          expeditionId: null,
          salesforceMembershipId: `sf-vol-${String(i).padStart(2, "0")}`,
          role: "volunteer",
          status: "active",
          source: "salesforce",
          createdAt: BASE_TIMESTAMP,
        });
      }

      // 28 plain contacts (no membership) all matching "Bulky".
      for (let i = 0; i < 28; i += 1) {
        const id = `contact:plain-${String(i).padStart(2, "0")}`;
        await context.repositories.contacts.upsert({
          id,
          salesforceContactId: null,
          displayName: `Bulky Plain ${String(i).padStart(2, "0")}`,
          primaryEmail: `plain-${String(i).padStart(2, "0")}@example.org`,
          primaryPhone: null,
          createdAt: BASE_TIMESTAMP,
          updatedAt: BASE_TIMESTAMP,
        });
      }

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Bulky",
        limit: 25,
      });

      expect(result.volunteers).toHaveLength(25);
      expect(result.contacts).toHaveLength(25);
      expect(result.totals.volunteers).toBe(30);
      expect(result.totals.contacts).toBe(28);
    } finally {
      await context.dispose();
    }
  });

  it("returns empty results for an empty/whitespace query without enumerating the DB", async () => {
    const context = await seedFixture();

    try {
      // Seed something we'd otherwise return.
      await context.repositories.contacts.upsert({
        id: "contact:would-match",
        salesforceContactId: null,
        displayName: "Would Match",
        primaryEmail: "would@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const empty = await context.repositories.contacts.searchInboxUnified({
        query: "",
        limit: 25,
      });
      expect(empty.volunteers).toEqual([]);
      expect(empty.contacts).toEqual([]);
      expect(empty.totals).toEqual({ volunteers: 0, contacts: 0 });

      const whitespace = await context.repositories.contacts.searchInboxUnified(
        { query: "   ", limit: 25 },
      );
      expect(whitespace.volunteers).toEqual([]);
      expect(whitespace.contacts).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("returns active project memberships alongside matching volunteers", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:has-project";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-hp",
        displayName: "Pierce Pollinator",
        primaryEmail: "pierce@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-pierce",
        contactId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-pierce",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Pierce",
        limit: 25,
      });

      expect(result.volunteers).toHaveLength(1);
      expect(result.volunteers[0]?.memberships).toEqual([
        {
          projectId: "project-pollinators",
          projectName: "Pollinator Watch",
          projectAlias: "pollinators",
        },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("matches a volunteer by the latest Gmail subject even when contact attributes do not match", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:gmail-subject-only";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-gso",
        displayName: "Quincy Adams",
        primaryEmail: "quincy@example.org",
        primaryPhone: "+15555550100",
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-gmail-subject-only",
        contactId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-gso",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "gmail-subject-only",
        subject: "Hex 19738 and 23816",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "General follow-up without the magic term.",
        occurredAt,
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Hex 19738",
        limit: 25,
      });

      expect(result.volunteers[0]?.contact.displayName).not.toContain("Hex 19738");
      expect(result.volunteers[0]?.contact.primaryEmail).not.toContain("Hex 19738");
      expect(result.volunteers[0]?.contact.primaryPhone).not.toContain("Hex 19738");
      expect(result.volunteers).toHaveLength(1);
      expect(result.volunteers[0]?.contact.id).toBe(contactId);
      expect(result.volunteers[0]?.latestMessageSubject).toBe(
        "Hex 19738 and 23816",
      );
      expect(result.contacts).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("matches a contact by the latest Salesforce subject", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:salesforce-subject";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-sfs",
        displayName: "Taylor Rivers",
        primaryEmail: "taylor@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundSalesforceEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "salesforce-subject",
        subject: "Volunteer onboarding follow-up",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "General follow-up without the match term.",
        occurredAt,
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "onboarding",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.latestMessageSubject).toBe(
        "Volunteer onboarding follow-up",
      );
    } finally {
      await context.dispose();
    }
  });

  it("matches a contact by inbox projection snippet", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:snippet-match";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: "Maya Lantern",
        primaryEmail: "maya@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "snippet-match",
        subject: "Routine check-in",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "Reaching out to see if anyone might be available soon.",
        occurredAt,
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Reaching out",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.snippet).toBe(
        "Reaching out to see if anyone might be available soon.",
      );
    } finally {
      await context.dispose();
    }
  });

  it("preserves direct contact-attribute matches for display name and primary email", async () => {
    const context = await seedFixture();

    try {
      await context.repositories.contacts.upsert({
        id: "contact:display-name-match",
        salesforceContactId: null,
        displayName: "Display Name Dana",
        primaryEmail: "display-name@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contacts.upsert({
        id: "contact:primary-email-match",
        salesforceContactId: null,
        displayName: "Mailbox Max",
        primaryEmail: "unique-mailbox-match@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const displayNameResult =
        await context.repositories.contacts.searchInboxUnified({
          query: "Dana",
          limit: 25,
        });
      const primaryEmailResult =
        await context.repositories.contacts.searchInboxUnified({
          query: "unique-mailbox-match",
          limit: 25,
        });

      expect(displayNameResult.contacts.map((row) => row.contact.id)).toEqual([
        "contact:display-name-match",
      ]);
      expect(primaryEmailResult.contacts.map((row) => row.contact.id)).toEqual([
        "contact:primary-email-match",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("matches a contact by display name seen in a Gmail from_header", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:header-from";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: "Alias Placeholder From",
        primaryEmail: "or-rural-coordinator@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "header-from",
        subject: "Rural update",
        fromHeader: '"Scotty Stalp" <or-rural-coordinator@example.org>',
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "Latest snippet without the search term.",
        occurredAt,
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Scotty",
        limit: 25,
      });

      expect(result.contacts.map((row) => row.contact.id)).toEqual([contactId]);
      expect(result.totals).toEqual({ volunteers: 0, contacts: 1 });
    } finally {
      await context.dispose();
    }
  });

  it("matches an audience-only contact by display name seen in a Gmail to_header", async () => {
    const context = await seedFixture();

    try {
      const anchorId = "contact:header-to-anchor";
      const audienceId = "contact:header-to-audience";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: anchorId,
        salesforceContactId: null,
        displayName: "Anchor Avery",
        primaryEmail: "anchor@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contacts.upsert({
        id: audienceId,
        salesforceContactId: null,
        displayName: "Alias Placeholder To",
        primaryEmail: "alias-recipient@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId: anchorId,
        occurredAt,
        idSuffix: "header-to",
        subject: "Recipient match",
        toHeader: '"Scotty Stalp" <alias-recipient@example.org>',
      });
      await seedAudienceParticipant(context, {
        canonicalEventId,
        contactId: audienceId,
        participantRole: "direct_recipient",
        normalizedEmail: "alias-recipient@example.org",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Scotty",
        limit: 25,
      });

      expect(result.contacts.map((row) => row.contact.id)).toContain(audienceId);
    } finally {
      await context.dispose();
    }
  });

  it("matches an audience-only volunteer by display name seen in a Gmail cc_header", async () => {
    const context = await seedFixture();

    try {
      const anchorId = "contact:header-cc-anchor";
      const audienceId = "contact:header-cc-volunteer";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: anchorId,
        salesforceContactId: null,
        displayName: "Anchor Casey",
        primaryEmail: "cc-anchor@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contacts.upsert({
        id: audienceId,
        salesforceContactId: "003-header-cc",
        displayName: "Alias Placeholder Cc",
        primaryEmail: "volunteer-cc@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-header-cc",
        contactId: audienceId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-header-cc",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId: anchorId,
        occurredAt,
        idSuffix: "header-cc",
        subject: "CC match",
        ccHeader: '"Scotty Stalp" <volunteer-cc@example.org>',
      });
      await seedAudienceParticipant(context, {
        canonicalEventId,
        contactId: audienceId,
        participantRole: "cc",
        normalizedEmail: "volunteer-cc@example.org",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Scotty",
        limit: 25,
      });

      expect(result.volunteers.map((row) => row.contact.id)).toEqual([
        audienceId,
      ]);
      expect(result.contacts.map((row) => row.contact.id)).toContain(anchorId);
    } finally {
      await context.dispose();
    }
  });

  it("keeps section assignment based on membership even when the match comes only from headers", async () => {
    const context = await seedFixture();

    try {
      const volunteerId = "contact:header-volunteer";
      const contactId = "contact:header-plain";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: volunteerId,
        salesforceContactId: "003-header-vol",
        displayName: "Alias Placeholder Volunteer",
        primaryEmail: "header-volunteer@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: "Alias Placeholder Contact",
        primaryEmail: "header-plain@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-header-volunteer",
        contactId: volunteerId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-header-volunteer",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });
      const volunteerEvent = await seedInboundEmail(context, {
        contactId: volunteerId,
        occurredAt,
        idSuffix: "header-volunteer",
        subject: "Volunteer header match",
        fromHeader: '"Scotty Stalp" <header-volunteer@example.org>',
      });
      const contactEvent = await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-20T16:01:00.000Z",
        idSuffix: "header-plain",
        subject: "Plain header match",
        fromHeader: '"Scotty Stalp" <header-plain@example.org>',
      });
      await seedInboxProjection(context, {
        contactId: volunteerId,
        snippet: "Volunteer header snippet.",
        occurredAt,
        canonicalEventId: volunteerEvent.canonicalEventId,
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "Plain header snippet.",
        occurredAt: "2026-04-20T16:01:00.000Z",
        canonicalEventId: contactEvent.canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Scotty",
        limit: 25,
      });

      expect(result.volunteers.map((row) => row.contact.id)).toEqual([
        volunteerId,
      ]);
      expect(result.contacts.map((row) => row.contact.id)).toEqual([contactId]);
    } finally {
      await context.dispose();
    }
  });

  it("escapes ilike metacharacters for header-name matching", async () => {
    const context = await seedFixture();

    try {
      await context.repositories.contacts.upsert({
        id: "contact:header-literal",
        salesforceContactId: null,
        displayName: "Alias Placeholder Literal",
        primaryEmail: "header-literal@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contacts.upsert({
        id: "contact:header-wildcard",
        salesforceContactId: null,
        displayName: "Alias Placeholder Wildcard",
        primaryEmail: "header-wildcard@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: "contact:header-literal",
        occurredAt: "2026-04-20T16:00:00.000Z",
        idSuffix: "header-literal",
        subject: "Literal header match",
        fromHeader: '"Scotty_100% Real" <header-literal@example.org>',
      });
      await seedInboundEmail(context, {
        contactId: "contact:header-wildcard",
        occurredAt: "2026-04-20T16:01:00.000Z",
        idSuffix: "header-wildcard",
        subject: "Wildcard decoy",
        fromHeader: '"ScottyX100Y Real" <header-wildcard@example.org>',
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Scotty_100%",
        limit: 25,
      });

      expect(result.contacts.map((row) => row.contact.id)).toEqual([
        "contact:header-literal",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("returns a contact when an older Gmail subject matches and the latest message does not", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:older-subject-only";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-older",
        displayName: "Morgan Trail",
        primaryEmail: "morgan@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-19T16:00:00.000Z",
        idSuffix: "older-subject-match",
        subject: "Hex 19738",
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-20T16:00:00.000Z",
        idSuffix: "older-subject-latest",
        subject: "Weekly newsletter",
      });
      // v1.5 broader match: the search should match any historical subject
      // while still displaying latest-message metadata from the projection.
      await seedInboxProjection(context, {
        contactId,
        snippet: "Latest snippet that does not match.",
        occurredAt: "2026-04-20T16:00:00.000Z",
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Hex 19738",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.latestMessageSubject).toBe("Weekly newsletter");
      expect(result.totals).toEqual({ volunteers: 0, contacts: 1 });
    } finally {
      await context.dispose();
    }
  });

  it("matches a contact by an arbitrary historical Gmail subject across many events", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:historical-gmail-subject";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-hist",
        displayName: "Harper Ridge",
        primaryEmail: "harper@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-16T16:00:00.000Z",
        idSuffix: "hist-01",
        subject: "Bird count welcome",
      });
      await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-17T16:00:00.000Z",
        idSuffix: "hist-02",
        subject: "Camp logistics",
      });
      await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-18T16:00:00.000Z",
        idSuffix: "hist-03",
        subject: "Hex 19738 and 23816",
      });
      await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-19T16:00:00.000Z",
        idSuffix: "hist-04",
        subject: "Field supplies update",
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt: "2026-04-20T16:00:00.000Z",
        idSuffix: "hist-05",
        subject: "Weekly digest",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "Latest snippet without the target phrase.",
        occurredAt: "2026-04-20T16:00:00.000Z",
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Hex 19738",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.latestMessageSubject).toBe("Weekly digest");
    } finally {
      await context.dispose();
    }
  });

  it("matches multiple contacts when each has an older subject match on different threads", async () => {
    const context = await seedFixture();

    try {
      const alphaId = "contact:cross-thread-alpha";
      await context.repositories.contacts.upsert({
        id: alphaId,
        salesforceContactId: "003-cross-a",
        displayName: "Avery Summit",
        primaryEmail: "avery@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: alphaId,
        occurredAt: "2026-04-18T16:00:00.000Z",
        idSuffix: "cross-a-match",
        subject: "Hex 19738 thread alpha",
      });
      const { canonicalEventId: alphaLatestEventId } = await seedInboundEmail(
        context,
        {
          contactId: alphaId,
          occurredAt: "2026-04-20T16:00:00.000Z",
          idSuffix: "cross-a-latest",
          subject: "Status check-in",
        },
      );
      await seedInboxProjection(context, {
        contactId: alphaId,
        snippet: "Alpha latest snippet without the search term.",
        occurredAt: "2026-04-20T16:00:00.000Z",
        canonicalEventId: alphaLatestEventId,
      });

      const betaId = "contact:cross-thread-beta";
      await context.repositories.contacts.upsert({
        id: betaId,
        salesforceContactId: "003-cross-b",
        displayName: "Blair Canyon",
        primaryEmail: "blair@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedInboundEmail(context, {
        contactId: betaId,
        occurredAt: "2026-04-17T16:00:00.000Z",
        idSuffix: "cross-b-match",
        subject: "Re: Hex 19738 records",
      });
      const { canonicalEventId: betaLatestEventId } = await seedInboundEmail(
        context,
        {
          contactId: betaId,
          occurredAt: "2026-04-19T16:00:00.000Z",
          idSuffix: "cross-b-latest",
          subject: "Weekend logistics",
        },
      );
      await seedInboxProjection(context, {
        contactId: betaId,
        snippet: "Beta latest snippet without the search term.",
        occurredAt: "2026-04-19T16:00:00.000Z",
        canonicalEventId: betaLatestEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Hex 19738",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts.map((row) => row.contact.id)).toEqual([
        alphaId,
        betaId,
      ]);
      expect(result.totals).toEqual({ volunteers: 0, contacts: 2 });
    } finally {
      await context.dispose();
    }
  });

  it("matches a contact by a historical Salesforce subject even when the latest event does not match", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:historical-salesforce-subject";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-hist-sf",
        displayName: "Sage Hollow",
        primaryEmail: "sage@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedInboundSalesforceEmail(context, {
        contactId,
        occurredAt: "2026-04-19T16:00:00.000Z",
        idSuffix: "hist-sf-match",
        subject: "Hex 19738 in Salesforce",
      });
      const { canonicalEventId } = await seedInboundSalesforceEmail(context, {
        contactId,
        occurredAt: "2026-04-20T16:00:00.000Z",
        idSuffix: "hist-sf-latest",
        subject: "General volunteer update",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "Latest Salesforce snippet without the search term.",
        occurredAt: "2026-04-20T16:00:00.000Z",
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Hex 19738",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]?.contact.id).toBe(contactId);
      expect(result.contacts[0]?.latestMessageSubject).toBe(
        "General volunteer update",
      );
    } finally {
      await context.dispose();
    }
  });
});
