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
    fromHeader: "sender@example.org",
    toHeader: "alias@example.org",
    ccHeader: null,
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

  it("does NOT return a `bodyMatches` field — body-match search has been removed", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:body-only";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-bo",
        displayName: "Quincy Adams",
        primaryEmail: "quincy@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "qa-body",
        subject: "Hello there",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "thanks for the helpful biodiversity update",
        occurredAt,
        canonicalEventId,
      });

      // Searching for a body-only term ("biodiversity") that doesn't appear
      // in name/email/phone should now return zero results — body matching
      // was dropped.
      const result = await context.repositories.contacts.searchInboxUnified({
        query: "biodiversity",
        limit: 25,
      });

      expect(result.volunteers).toEqual([]);
      expect(result.contacts).toEqual([]);
      expect(result.totals).toEqual({ volunteers: 0, contacts: 0 });

      // Sanity-check that the function shape doesn't include bodyMatches.
      expect("bodyMatches" in result).toBe(false);
    } finally {
      await context.dispose();
    }
  });
});
