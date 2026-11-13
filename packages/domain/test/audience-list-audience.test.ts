import { describe, expect, it } from "vitest";

import type {
  AudienceListMemberRecord,
  ContactRecord,
} from "@as-comms/contracts";

import { resolveAudienceListForRun } from "../src/audience-list-audience.js";

const at = "2026-11-12T12:00:00.000Z";

function member(input: {
  readonly email: string;
  readonly firstName: string | null;
}): AudienceListMemberRecord {
  return {
    id: crypto.randomUUID(),
    listId: "insiders",
    normalizedEmail: input.email,
    firstName: input.firstName,
    lastName: null,
    createdAt: at,
  };
}

describe("resolveAudienceListForRun", () => {
  it("matches contacts by normalized email and freezes list names and sender alias", async () => {
    const contacts: readonly ContactRecord[] = [
      {
        id: "contact-gregg",
        salesforceContactId: null,
        displayName: "Gregg Treinish",
        primaryEmail: "GREGG@example.org",
        primaryPhone: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "contact-chrissy",
        salesforceContactId: null,
        displayName: "Chrissy McClarren",
        primaryEmail: "chrissy@example.org",
        primaryPhone: null,
        createdAt: at,
        updatedAt: at,
      },
    ];

    const audience = await resolveAudienceListForRun(
      {
        audienceLists: {
          listMembers: () =>
            Promise.resolve([
              member({ email: "gregg@example.org", firstName: "Gregory" }),
              member({ email: "chrissy@example.org", firstName: null }),
              member({ email: "outside@example.org", firstName: null }),
            ]),
        },
        contacts: { listAll: () => Promise.resolve(contacts) },
      },
      {
        listId: "insiders",
        fromEmail: " Gregg@AdventureScientists.org ",
      },
    );

    expect(audience).toEqual([
      {
        contactId: "contact-gregg",
        newsletterSubscriberId: null,
        frozenEmail: "gregg@example.org",
        frozenFirstName: "Gregory",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: "gregg@adventurescientists.org",
      },
      {
        contactId: "contact-chrissy",
        newsletterSubscriberId: null,
        frozenEmail: "chrissy@example.org",
        frozenFirstName: "Chrissy",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: "gregg@adventurescientists.org",
      },
      {
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "outside@example.org",
        frozenFirstName: null,
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: "gregg@adventurescientists.org",
      },
    ]);
  });
});
