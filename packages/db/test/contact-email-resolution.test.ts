import { describe, expect, it } from "vitest";

import { resolveContactsByEmail } from "@as-comms/domain";

import { createTestStage1Context } from "./helpers.js";

describe("resolveContactsByEmail", () => {
  it("matches primary emails and secondary identities, normalizes input, and excludes ambiguous addresses", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.contacts.upsert({
        id: "contact-primary",
        salesforceContactId: null,
        displayName: "Primary Match",
        primaryEmail: "primary@example.org",
        primaryPhone: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
      });
      await context.repositories.contacts.upsert({
        id: "contact-identity",
        salesforceContactId: null,
        displayName: "Identity Match",
        primaryEmail: "identity-primary@example.org",
        primaryPhone: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
      });
      await context.repositories.contactIdentities.upsert({
        id: "identity-secondary",
        contactId: "contact-identity",
        kind: "email",
        normalizedValue: "secondary@example.org",
        isPrimary: false,
        source: "manual",
        verifiedAt: null,
      });
      await context.repositories.contacts.upsert({
        id: "contact-ambiguous-a",
        salesforceContactId: null,
        displayName: "Ambiguous A",
        primaryEmail: "shared@example.org",
        primaryPhone: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
      });
      await context.repositories.contacts.upsert({
        id: "contact-ambiguous-b",
        salesforceContactId: null,
        displayName: "Ambiguous B",
        primaryEmail: "other@example.org",
        primaryPhone: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
      });
      await context.repositories.contactIdentities.upsert({
        id: "identity-ambiguous",
        contactId: "contact-ambiguous-b",
        kind: "email",
        normalizedValue: "shared@example.org",
        isPrimary: false,
        source: "manual",
        verifiedAt: null,
      });

      const result = await resolveContactsByEmail({
        normalizedEmails: [
          "primary@example.org",
          "  SECONDARY@example.org  ",
          "missing@example.org",
          "shared@example.org",
        ],
        repositories: {
          contacts: context.repositories.contacts,
          contactIdentities: context.repositories.contactIdentities,
        },
      });

      expect(result).toEqual([
        {
          normalizedEmail: "primary@example.org",
          status: "matched",
          contactId: "contact-primary",
        },
        {
          normalizedEmail: "secondary@example.org",
          status: "matched",
          contactId: "contact-identity",
        },
        {
          normalizedEmail: "missing@example.org",
          status: "no_contact_match",
          contactId: null,
        },
        {
          normalizedEmail: "shared@example.org",
          status: "ambiguous_match",
          contactId: null,
        },
      ]);
    } finally {
      await context.dispose();
    }
  });
});
