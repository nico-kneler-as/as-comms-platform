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
});
