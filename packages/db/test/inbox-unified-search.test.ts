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

describe("contact repository searchInboxUnified", () => {
  it("finds a signup-only contact by name in section A; section B is empty for that query", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:eliza";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-eliza",
        displayName: "Eliza Tate",
        primaryEmail: "eliza.tate@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedSignedUpEvent(context, {
        contactId,
        occurredAt: "2026-03-15T09:30:00.000Z",
        idSuffix: "eliza",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Eli",
        limit: 25,
      });

      expect(result.contactMatches).toHaveLength(1);
      expect(result.contactMatches[0]?.contact.id).toBe(contactId);
      expect(result.contactMatches[0]?.hasProjection).toBe(false);
      expect(result.contactMatches[0]?.lastActivityAt).toBe(
        "2026-03-15T09:30:00.000Z",
      );
      expect(result.bodyMatches).toHaveLength(0);
      expect(result.totals.contactMatches).toBe(1);
      expect(result.totals.bodyMatches).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  it("finds a contact in section B when the snippet matches but the name does not", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:body-match";
      const occurredAt = "2026-04-20T16:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-bm",
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

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "biodiversity",
        limit: 25,
      });

      expect(result.contactMatches).toHaveLength(0);
      expect(result.bodyMatches).toHaveLength(1);
      expect(result.bodyMatches[0]?.contact.id).toBe(contactId);
      expect(result.bodyMatches[0]?.hasProjection).toBe(true);
      expect(result.bodyMatches[0]?.snippet).toContain("biodiversity");
      expect(result.totals.bodyMatches).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("dedupes a contact appearing in both sections — only Section A is returned", async () => {
    const context = await seedFixture();

    try {
      const contactId = "contact:dual-match";
      const occurredAt = "2026-04-15T08:00:00.000Z";
      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-dm",
        displayName: "Hannah Hawthorne",
        primaryEmail: "hannah@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId } = await seedInboundEmail(context, {
        contactId,
        occurredAt,
        idSuffix: "hannah-dual",
        subject: "About hannah",
      });
      await seedInboxProjection(context, {
        contactId,
        snippet: "this body also mentions hannah",
        occurredAt,
        canonicalEventId,
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "hannah",
        limit: 25,
      });

      expect(result.contactMatches.map((row) => row.contact.id)).toEqual([
        contactId,
      ]);
      expect(result.bodyMatches.map((row) => row.contact.id)).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("caps each section at 25 and reports the pre-truncation total", async () => {
    const context = await seedFixture();

    try {
      // 30 distinct name-matching contacts.
      for (let i = 0; i < 30; i += 1) {
        const id = `contact:bulk-${String(i).padStart(2, "0")}`;
        await context.repositories.contacts.upsert({
          id,
          salesforceContactId: null,
          displayName: `Bulky Bulk ${String(i).padStart(2, "0")}`,
          primaryEmail: `bulk-${String(i).padStart(2, "0")}@example.org`,
          primaryPhone: null,
          createdAt: BASE_TIMESTAMP,
          updatedAt: BASE_TIMESTAMP,
        });
      }

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Bulky",
        limit: 25,
      });

      expect(result.contactMatches).toHaveLength(25);
      expect(result.totals.contactMatches).toBe(30);
    } finally {
      await context.dispose();
    }
  });

  it("orders by last activity desc across all event types (lifecycle event newer than older comm event)", async () => {
    const context = await seedFixture();

    try {
      const oldCommContactId = "contact:older-comm";
      const newerLifecycleContactId = "contact:newer-lifecycle";

      await context.repositories.contacts.upsert({
        id: oldCommContactId,
        salesforceContactId: "003-oc",
        displayName: "Order Test Older",
        primaryEmail: "older@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      const { canonicalEventId: oldEventId } = await seedInboundEmail(context, {
        contactId: oldCommContactId,
        occurredAt: "2026-01-01T00:00:00.000Z",
        idSuffix: "older",
        subject: "old subject",
      });
      await seedInboxProjection(context, {
        contactId: oldCommContactId,
        snippet: "old snippet",
        occurredAt: "2026-01-01T00:00:00.000Z",
        canonicalEventId: oldEventId,
      });

      await context.repositories.contacts.upsert({
        id: newerLifecycleContactId,
        salesforceContactId: "003-nl",
        displayName: "Order Test Newer",
        primaryEmail: "newer@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await seedSignedUpEvent(context, {
        contactId: newerLifecycleContactId,
        occurredAt: "2026-04-01T00:00:00.000Z",
        idSuffix: "newer",
      });

      const result = await context.repositories.contacts.searchInboxUnified({
        query: "Order Test",
        limit: 25,
      });

      // Both match section A; the newer lifecycle event must beat the older
      // comm event's lastActivityAt.
      expect(result.contactMatches.map((row) => row.contact.id)).toEqual([
        newerLifecycleContactId,
        oldCommContactId,
      ]);
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
      expect(empty.contactMatches).toEqual([]);
      expect(empty.bodyMatches).toEqual([]);
      expect(empty.totals).toEqual({ contactMatches: 0, bodyMatches: 0 });

      const whitespace = await context.repositories.contacts.searchInboxUnified(
        { query: "   ", limit: 25 },
      );
      expect(whitespace.contactMatches).toEqual([]);
      expect(whitespace.bodyMatches).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("returns active project memberships alongside matching contacts", async () => {
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

      expect(result.contactMatches[0]?.memberships).toEqual([
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
});
