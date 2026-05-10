import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

const BASE_TIMESTAMP = "2026-04-21T12:00:00.000Z";

async function seedAllContactsFixture() {
  const context = await createTestStage1Context();

  // Active project the operator can route memberships to.
  await context.repositories.projectDimensions.upsert({
    projectId: "project-pollinators",
    projectName: "Pollinator Watch",
    projectAlias: "pollinators",
    isActive: true,
    source: "salesforce",
  });
  // Inactive project — its memberships should NOT surface as chips.
  await context.repositories.projectDimensions.upsert({
    projectId: "project-archive",
    projectName: "Archived Project",
    projectAlias: "archive",
    isActive: false,
    source: "salesforce",
  });

  return context;
}

describe("contact repository searchAllContacts", () => {
  it("returns a contact with no memberships and no canonical events when queried by name", async () => {
    const context = await seedAllContactsFixture();

    try {
      await context.repositories.contacts.upsert({
        id: "contact:lonely-larry",
        salesforceContactId: null,
        displayName: "Lonely Larry",
        primaryEmail: "larry@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchAllContacts({
        query: "lonely",
        limit: 50,
        cursor: null,
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.contact.id).toBe("contact:lonely-larry");
      expect(result.rows[0]?.memberships).toEqual([]);
      expect(result.rows[0]?.lastActivityAt).toBeNull();
      expect(result.nextCursor).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("returns a contact with only a lifecycle.signed_up event (no comm events) when queried by email", async () => {
    const context = await seedAllContactsFixture();

    try {
      const contactId = "contact:signup-only-sarah";
      const occurredAt = "2026-03-15T09:30:00.000Z";

      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-sarah",
        displayName: "Sarah Signup",
        primaryEmail: "sarah.signup@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const sourceEvidenceId = "sev-signup-sarah";
      await context.repositories.sourceEvidence.append({
        id: sourceEvidenceId,
        provider: "salesforce",
        providerRecordType: "campaign-member",
        providerRecordId: "cm-sarah",
        receivedAt: occurredAt,
        occurredAt,
        payloadRef: "payloads/salesforce/cm-sarah.json",
        idempotencyKey: "salesforce:cm-sarah",
        checksum: "checksum:cm-sarah",
      });
      await context.repositories.canonicalEvents.upsert({
        id: "evt-signup-sarah",
        contactId,
        eventType: "lifecycle.signed_up",
        channel: "lifecycle",
        occurredAt,
        contentFingerprint: null,
        sourceEvidenceId,
        idempotencyKey: "canonical:evt-signup-sarah",
        provenance: {
          primaryProvider: "salesforce",
          primarySourceEvidenceId: sourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "campaign-member",
          sourceRecordId: "cm-sarah",
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: null,
          notes: null,
        },
        reviewState: "clear",
      });

      const result = await context.repositories.contacts.searchAllContacts({
        query: "sarah.signup@example.org",
        limit: 50,
        cursor: null,
      });

      // Proves the projection bypass: this contact has NO inbox-driving comm
      // events and would be invisible to searchPageOrderedByRecency, yet
      // searchAllContacts surfaces them.
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.contact.id).toBe(contactId);
      expect(result.rows[0]?.lastActivityAt).toBe(occurredAt);
      // No active memberships seeded.
      expect(result.rows[0]?.memberships).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("returns a contact with no active membership when queried by phone", async () => {
    const context = await seedAllContactsFixture();

    try {
      const contactId = "contact:phone-only-paul";

      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: "Paul Phoneonly",
        primaryEmail: null,
        primaryPhone: "+15551239876",
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      // Membership tied to an INACTIVE project — should not surface as a chip.
      await context.repositories.contactMemberships.upsert({
        id: "membership-paul-archive",
        contactId,
        projectId: "project-archive",
        expeditionId: null,
        salesforceMembershipId: "sf-membership-paul",
        role: "volunteer",
        status: "completed",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchAllContacts({
        query: "5551239876",
        limit: 50,
        cursor: null,
      });

      // Proves no membership filter: contact appears even though their only
      // membership is on an inactive project. Chips are empty (active-only).
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.contact.id).toBe(contactId);
      expect(result.rows[0]?.memberships).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("returns a contact who has been archived in the inbox projection — proves independence from inbox state", async () => {
    const context = await seedAllContactsFixture();

    try {
      const contactId = "contact:archived-amy";
      const occurredAt = "2026-02-10T08:00:00.000Z";

      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-amy",
        displayName: "Amy Archived",
        primaryEmail: "amy@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const sourceEvidenceId = "sev-amy-inbound";
      await context.repositories.sourceEvidence.append({
        id: sourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gm-amy",
        receivedAt: occurredAt,
        occurredAt,
        payloadRef: "payloads/gmail/gm-amy.json",
        idempotencyKey: "gmail:gm-amy",
        checksum: "checksum:gm-amy",
      });
      const canonicalEventId = "evt-amy-inbound";
      await context.repositories.canonicalEvents.upsert({
        id: canonicalEventId,
        contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt,
        contentFingerprint: null,
        sourceEvidenceId,
        idempotencyKey: "canonical:evt-amy",
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: sourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "gm-amy",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });

      // Seed an inbox projection row, then archive it.
      await context.repositories.inboxProjection.upsert({
        contactId,
        bucket: "Opened",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: occurredAt,
        lastOutboundAt: null,
        lastActivityAt: occurredAt,
        snippet: "Hi from Amy",
        archivedAt: "2026-04-01T00:00:00.000Z",
        lastCanonicalEventId: canonicalEventId,
        lastEventType: "communication.email.inbound",
      });

      const result = await context.repositories.contacts.searchAllContacts({
        query: "amy",
        limit: 50,
        cursor: null,
      });

      // Proves the search is independent of inbox archived state: the
      // contact comes back even though their inbox projection is archived.
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.contact.id).toBe(contactId);
      expect(result.rows[0]?.lastActivityAt).toBe(occurredAt);
    } finally {
      await context.dispose();
    }
  });

  it("paginates deterministically by (displayName, contactId) and round-trips the cursor", async () => {
    const context = await seedAllContactsFixture();

    try {
      // Seven contacts, all matching "match", ordered by displayName ASC then
      // id ASC for deterministic cursor pagination.
      const seedContacts: readonly {
        readonly id: string;
        readonly displayName: string;
      }[] = [
        { id: "contact:001", displayName: "Match Alpha" },
        { id: "contact:002", displayName: "Match Bravo" },
        { id: "contact:003", displayName: "Match Charlie" },
        { id: "contact:004", displayName: "Match Delta" },
        { id: "contact:005", displayName: "Match Echo" },
        { id: "contact:006", displayName: "Match Foxtrot" },
        { id: "contact:007", displayName: "Match Golf" },
      ];

      for (const seedContact of seedContacts) {
        await context.repositories.contacts.upsert({
          id: seedContact.id,
          salesforceContactId: null,
          displayName: seedContact.displayName,
          primaryEmail: `${seedContact.id}@example.org`,
          primaryPhone: null,
          createdAt: BASE_TIMESTAMP,
          updatedAt: BASE_TIMESTAMP,
        });
      }

      const firstPage = await context.repositories.contacts.searchAllContacts({
        query: "Match",
        limit: 3,
        cursor: null,
      });

      expect(firstPage.rows.map((row) => row.contact.id)).toEqual([
        "contact:001",
        "contact:002",
        "contact:003",
      ]);
      expect(firstPage.nextCursor).not.toBeNull();
      expect(firstPage.nextCursor?.contactId).toBe("contact:003");

      const secondPage = await context.repositories.contacts.searchAllContacts(
        {
          query: "Match",
          limit: 3,
          cursor: firstPage.nextCursor,
        },
      );

      expect(secondPage.rows.map((row) => row.contact.id)).toEqual([
        "contact:004",
        "contact:005",
        "contact:006",
      ]);
      expect(secondPage.nextCursor?.contactId).toBe("contact:006");

      const thirdPage = await context.repositories.contacts.searchAllContacts({
        query: "Match",
        limit: 3,
        cursor: secondPage.nextCursor,
      });

      expect(thirdPage.rows.map((row) => row.contact.id)).toEqual([
        "contact:007",
      ]);
      // Final page has no more rows so next cursor must be null.
      expect(thirdPage.nextCursor).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("returns empty results for an empty query and does not enumerate the entire DB", async () => {
    const context = await seedAllContactsFixture();

    try {
      // Seed a couple of contacts to make sure we'd otherwise return them.
      await context.repositories.contacts.upsert({
        id: "contact:would-match",
        salesforceContactId: null,
        displayName: "Would Match",
        primaryEmail: "would@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });

      const emptyResult = await context.repositories.contacts.searchAllContacts({
        query: "",
        limit: 50,
        cursor: null,
      });

      expect(emptyResult.rows).toEqual([]);
      expect(emptyResult.nextCursor).toBeNull();

      const whitespaceResult =
        await context.repositories.contacts.searchAllContacts({
          query: "   ",
          limit: 50,
          cursor: null,
        });

      expect(whitespaceResult.rows).toEqual([]);
      expect(whitespaceResult.nextCursor).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("returns active project chips alongside matching contacts", async () => {
    const context = await seedAllContactsFixture();

    try {
      const contactId = "contact:has-project";

      await context.repositories.contacts.upsert({
        id: contactId,
        salesforceContactId: "003-hasproject",
        displayName: "Pierce Pollinator",
        primaryEmail: "pierce@example.org",
        primaryPhone: null,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      });
      await context.repositories.contactMemberships.upsert({
        id: "membership-pierce-pollinators",
        contactId,
        projectId: "project-pollinators",
        expeditionId: null,
        salesforceMembershipId: "sf-pierce",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: BASE_TIMESTAMP,
      });

      const result = await context.repositories.contacts.searchAllContacts({
        query: "Pierce",
        limit: 50,
        cursor: null,
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.memberships).toEqual([
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
