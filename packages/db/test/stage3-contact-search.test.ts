import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

async function seedContactSearchFixture() {
  const context = await createTestStage1Context();
  const createdAt = "2026-04-21T12:00:00.000Z";

  await context.repositories.contacts.upsert({
    id: "contact:alex-carter",
    salesforceContactId: "003-alex",
    displayName: "Alex Carter",
    primaryEmail: "alex@example.org",
    primaryPhone: null,
    createdAt,
    updatedAt: createdAt,
  });
  await context.repositories.contacts.upsert({
    id: "contact:maya-singh",
    salesforceContactId: null,
    displayName: "Maya Singh",
    primaryEmail: "alex.sponsor@example.org",
    primaryPhone: null,
    createdAt,
    updatedAt: createdAt,
  });
  await context.repositories.contacts.upsert({
    id: "contact:zoe-chen",
    salesforceContactId: "003-zoe",
    displayName: "Zoe Chen",
    primaryEmail: "zoe@example.org",
    primaryPhone: null,
    createdAt,
    updatedAt: createdAt,
  });

  return context;
}

async function seedProjectScopedSearchFixture() {
  const context = await createTestStage1Context();
  const createdAt = "2026-04-21T12:00:00.000Z";

  await context.repositories.projectDimensions.upsert({
    projectId: "project-in-scope",
    projectName: "Pacific Northwest Forests",
    source: "salesforce",
  });
  await context.repositories.projectDimensions.upsert({
    projectId: "project-out-of-scope",
    projectName: "Out of Scope Project",
    source: "salesforce",
  });

  await context.repositories.contacts.upsert({
    id: "contact:nicole-in-scope",
    salesforceContactId: "003-nicole",
    displayName: "Nicole In Scope",
    primaryEmail: "nicole@example.org",
    primaryPhone: null,
    createdAt,
    updatedAt: createdAt,
  });
  await context.repositories.contactMemberships.upsert({
    id: "membership:nicole-in-scope",
    contactId: "contact:nicole-in-scope",
    projectId: "project-in-scope",
    expeditionId: null,
    salesforceMembershipId: "a0B-nicole",
    role: "volunteer",
    status: "active",
    source: "salesforce",
    createdAt,
  });

  for (const index of Array.from({ length: 12 }, (_, value) => value + 1)) {
    const paddedIndex = index.toString().padStart(2, "0");
    const contactId = `contact:nic-out-${paddedIndex}`;
    await context.repositories.contacts.upsert({
      id: contactId,
      salesforceContactId: `003-out-${paddedIndex}`,
      displayName: `Nic Outside ${paddedIndex}`,
      primaryEmail: `nic-out-${paddedIndex}@example.org`,
      primaryPhone: null,
      createdAt,
      updatedAt: createdAt,
    });
    await context.repositories.contactMemberships.upsert({
      id: `membership:nic-out-${paddedIndex}`,
      contactId,
      projectId: "project-out-of-scope",
      expeditionId: null,
      salesforceMembershipId: `a0B-out-${paddedIndex}`,
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt,
    });
  }

  return context;
}

describe("contact repository searchByQuery", () => {
  it("matches display names case-insensitively", async () => {
    const context = await seedContactSearchFixture();

    try {
      await expect(
        context.repositories.contacts.searchByQuery({
          query: "zoe",
          limit: 8,
        }),
      ).resolves.toMatchObject([
        {
          id: "contact:zoe-chen",
          displayName: "Zoe Chen",
        },
      ]);
    } finally {
      await context.client.close();
    }
  });

  it("matches primary emails case-insensitively", async () => {
    const context = await seedContactSearchFixture();

    try {
      await expect(
        context.repositories.contacts.searchByQuery({
          query: "sponsor@example",
          limit: 8,
        }),
      ).resolves.toMatchObject([
        {
          id: "contact:maya-singh",
          primaryEmail: "alex.sponsor@example.org",
        },
      ]);
    } finally {
      await context.client.close();
    }
  });

  it("returns matches from both name and email fields in a single query", async () => {
    const context = await seedContactSearchFixture();

    try {
      await expect(
        context.repositories.contacts.searchByQuery({
          query: "alex",
          limit: 8,
        }),
      ).resolves.toMatchObject([
        {
          id: "contact:alex-carter",
        },
        {
          id: "contact:maya-singh",
        },
      ]);
    } finally {
      await context.client.close();
    }
  });

  it("returns an empty result for short queries", async () => {
    const context = await seedContactSearchFixture();

    try {
      await expect(
        context.repositories.contacts.searchByQuery({
          query: "a",
          limit: 8,
        }),
      ).resolves.toEqual([]);
    } finally {
      await context.client.close();
    }
  });

  it("scopes query matches to the requested alias projects before applying the result limit", async () => {
    const context = await seedProjectScopedSearchFixture();

    try {
      await expect(
        context.repositories.contacts.searchByQuery({
          query: "nic",
          limit: 25,
          projectIds: ["project-in-scope"],
        }),
      ).resolves.toMatchObject([
        {
          id: "contact:nicole-in-scope",
          displayName: "Nicole In Scope",
        },
      ]);
    } finally {
      await context.client.close();
    }
  });
});
