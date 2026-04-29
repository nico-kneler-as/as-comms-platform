import { describe, expect, it } from "vitest";

import { eq, sql } from "drizzle-orm";

import { contacts, users } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

async function seedUser(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  },
): Promise<void> {
  const now = new Date("2026-04-21T12:00:00.000Z");

  await context.settings.users.upsert({
    id: input.id,
    name: input.name,
    email: input.email,
    emailVerified: now,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedContact(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly id: string;
    readonly displayName: string;
    readonly email: string;
  },
): Promise<void> {
  const now = "2026-04-21T12:00:00.000Z";

  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: now,
    updatedAt: now,
  });
}

function waitForTick(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("internal notes repository", () => {
  it("creates and finds an internal note round-trip", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:one",
        displayName: "Contact One",
        email: "contact-one@example.org",
      });

      const created = await context.repositories.internalNotes.create({
        id: "note:one",
        contactId: "contact:one",
        body: "First internal note",
        authorId: "user:author",
      });
      const found = await context.repositories.internalNotes.findById("note:one");

      expect(found).toEqual(created);
      expect(created).toEqual(
        expect.objectContaining({
          id: "note:one",
          contactId: "contact:one",
          body: "First internal note",
          authorId: "user:author",
        }),
      );
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
      expect(Math.abs(Date.now() - created.createdAt.getTime())).toBeLessThan(
        1_000,
      );
      expect(Math.abs(Date.now() - created.updatedAt.getTime())).toBeLessThan(
        1_000,
      );
    } finally {
      await context.dispose();
    }
  });

  it("orders findByContactId newest-first", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:order",
        displayName: "Order Contact",
        email: "order@example.org",
      });

      await context.repositories.internalNotes.create({
        id: "note:oldest",
        contactId: "contact:order",
        body: "Oldest",
        authorId: "user:author",
      });
      await waitForTick(5);
      await context.repositories.internalNotes.create({
        id: "note:middle",
        contactId: "contact:order",
        body: "Middle",
        authorId: "user:author",
      });
      await waitForTick(5);
      await context.repositories.internalNotes.create({
        id: "note:newest",
        contactId: "contact:order",
        body: "Newest",
        authorId: "user:author",
      });

      await expect(
        context.repositories.internalNotes.findByContactId("contact:order"),
      ).resolves.toMatchObject([
        { id: "note:newest", body: "Newest" },
        { id: "note:middle", body: "Middle" },
        { id: "note:oldest", body: "Oldest" },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("applies limits in findByContactId", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:limit",
        displayName: "Limit Contact",
        email: "limit@example.org",
      });

      for (const noteId of [
        "note:one",
        "note:two",
        "note:three",
        "note:four",
        "note:five",
      ]) {
        await context.repositories.internalNotes.create({
          id: noteId,
          contactId: "contact:limit",
          body: noteId,
          authorId: "user:author",
        });
        await waitForTick(5);
      }

      const rows = await context.repositories.internalNotes.findByContactId(
        "contact:limit",
        2,
      );

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toEqual(["note:five", "note:four"]);
    } finally {
      await context.dispose();
    }
  });

  it("returns an empty list when a contact has no notes", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact(context, {
        id: "contact:empty",
        displayName: "Empty Contact",
        email: "empty@example.org",
      });

      await expect(
        context.repositories.internalNotes.findByContactId("contact:empty"),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("updates the body and bumps updatedAt", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:update",
        displayName: "Update Contact",
        email: "update@example.org",
      });

      const created = await context.repositories.internalNotes.create({
        id: "note:update",
        contactId: "contact:update",
        body: "Before",
        authorId: "user:author",
      });
      await waitForTick(5);

      const updated = await context.repositories.internalNotes.update({
        id: "note:update",
        body: "After",
      });

      expect(updated.body).toBe("After");
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime(),
      );
    } finally {
      await context.dispose();
    }
  });

  it("throws when updating a missing note", async () => {
    const context = await createTestStage1Context();

    try {
      await expect(
        context.repositories.internalNotes.update({
          id: "note:missing",
          body: "After",
        }),
      ).rejects.toThrow();
    } finally {
      await context.dispose();
    }
  });

  it("deletes notes idempotently", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:delete",
        displayName: "Delete Contact",
        email: "delete@example.org",
      });

      await context.repositories.internalNotes.create({
        id: "note:delete",
        contactId: "contact:delete",
        body: "Delete me",
        authorId: "user:author",
      });

      await context.repositories.internalNotes.delete("note:delete");
      await expect(
        context.repositories.internalNotes.findById("note:delete"),
      ).resolves.toBeUndefined();

      await expect(
        context.repositories.internalNotes.delete("note:delete"),
      ).resolves.toBeUndefined();
    } finally {
      await context.dispose();
    }
  });

  it("cascades note deletes when the contact is removed", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:cascade",
        displayName: "Cascade Contact",
        email: "cascade@example.org",
      });

      await context.repositories.internalNotes.create({
        id: "note:cascade",
        contactId: "contact:cascade",
        body: "Cascade me",
        authorId: "user:author",
      });

      await context.db.delete(contacts).where(eq(contacts.id, "contact:cascade"));

      await expect(
        context.repositories.internalNotes.findById("note:cascade"),
      ).resolves.toBeUndefined();
    } finally {
      await context.dispose();
    }
  });

  it("restricts deleting an author with notes", async () => {
    const context = await createTestStage1Context();

    try {
      await seedUser(context, {
        id: "user:author",
        email: "author@example.org",
        name: "Author",
      });
      await seedContact(context, {
        id: "contact:restrict",
        displayName: "Restrict Contact",
        email: "restrict@example.org",
      });

      await context.repositories.internalNotes.create({
        id: "note:restrict",
        contactId: "contact:restrict",
        body: "Restrict me",
        authorId: "user:author",
      });

      await expect(
        context.db.delete(users).where(eq(users.id, "user:author")),
      ).rejects.toThrow();
    } finally {
      await context.dispose();
    }
  });

  it("applies the internal_notes schema migration", async () => {
    const context = await createTestStage1Context();

    try {
      const columnResult: unknown = await context.db.execute(sql<{
        readonly columnName: string;
        readonly dataType: string;
        readonly isNullable: "YES" | "NO";
      }>`
        select
          column_name as "columnName",
          data_type as "dataType",
          is_nullable as "isNullable"
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'internal_notes'
        order by column_name
      `);
      const columns = Array.isArray(columnResult)
        ? (columnResult as readonly {
            readonly columnName: string;
            readonly dataType: string;
            readonly isNullable: "YES" | "NO";
          }[])
        : (
            columnResult as {
              readonly rows: readonly {
                readonly columnName: string;
                readonly dataType: string;
                readonly isNullable: "YES" | "NO";
              }[];
            }
          ).rows;

      expect(columns).toEqual([
        {
          columnName: "author_id",
          dataType: "text",
          isNullable: "NO",
        },
        {
          columnName: "body",
          dataType: "text",
          isNullable: "NO",
        },
        {
          columnName: "contact_id",
          dataType: "text",
          isNullable: "NO",
        },
        {
          columnName: "created_at",
          dataType: "timestamp with time zone",
          isNullable: "NO",
        },
        {
          columnName: "id",
          dataType: "text",
          isNullable: "NO",
        },
        {
          columnName: "updated_at",
          dataType: "timestamp with time zone",
          isNullable: "NO",
        },
      ]);
    } finally {
      await context.dispose();
    }
  });
});
