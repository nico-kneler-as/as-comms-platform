import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq } from "drizzle-orm";

import { resolveContactByPhoneFromIdentities } from "@as-comms/domain";
import {
  consentRecords,
  contactIdentities,
  contacts,
  createStage1RepositoryBundle,
  databaseSchema,
  type Stage1Database,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

async function applyMigrationsThrough(
  client: PGlite,
  stopBeforeFile: string | null,
): Promise<void> {
  const drizzleDirectoryUrl = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(drizzleDirectoryUrl))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const migrationFile of migrationFiles) {
    if (stopBeforeFile !== null && migrationFile >= stopBeforeFile) {
      break;
    }

    const migrationSql = await readFile(
      new URL(migrationFile, drizzleDirectoryUrl),
      "utf8",
    );
    await client.exec(migrationSql);
  }
}

describe("phone normalization repositories", () => {
  it("finds a raw stored phone identity when lookup input is canonical E.164", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.contacts.upsert({
        id: "contact-raw-identity",
        salesforceContactId: null,
        displayName: "Raw Identity",
        primaryEmail: null,
        primaryPhone: null,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      });
      await context.db.insert(contactIdentities).values({
        id: "identity-raw-phone",
        contactId: "contact-raw-identity",
        kind: "phone",
        normalizedValue: "9163001877",
        isPrimary: true,
        source: "manual",
        verifiedAt: null,
      });

      const result = await resolveContactByPhoneFromIdentities({
        phoneE164: "+19163001877",
        readContactIdentities: {
          listByNormalizedValue: (input) =>
            context.repositories.contactIdentities.listByNormalizedValue(input),
        },
        readContacts: {
          findById: (id) => context.repositories.contacts.findById(id),
          listByIds: (ids) => context.repositories.contacts.listByIds(ids),
          findByPrimaryPhone: (phoneE164) =>
            context.repositories.contacts.findByPrimaryPhone(phoneE164),
        },
        readInboxProjection: {
          findByContactId: (contactId) =>
            context.repositories.inboxProjection.findByContactId(contactId),
        },
        writeContacts: {
          upsert: (record) => context.repositories.contacts.upsert(record),
        },
        writeContactIdentities: {
          upsert: (record) => context.repositories.contactIdentities.upsert(record),
        },
        clock: {
          now: () => new Date("2026-06-23T12:30:00.000Z"),
        },
        idGenerator: () => "unused",
      });

      expect(result.contact.id).toBe("contact-raw-identity");
      expect(result.isNewlyCreated).toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("finds an E.164 stored phone identity when lookup input is loose", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.contacts.upsert({
        id: "contact-e164-identity",
        salesforceContactId: null,
        displayName: "E164 Identity",
        primaryEmail: null,
        primaryPhone: null,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      });
      await context.db.insert(contactIdentities).values({
        id: "identity-e164-phone",
        contactId: "contact-e164-identity",
        kind: "phone",
        normalizedValue: "+17743680124",
        isPrimary: true,
        source: "manual",
        verifiedAt: null,
      });

      const result = await resolveContactByPhoneFromIdentities({
        phoneE164: "7743680124",
        readContactIdentities: {
          listByNormalizedValue: (input) =>
            context.repositories.contactIdentities.listByNormalizedValue(input),
        },
        readContacts: {
          findById: (id) => context.repositories.contacts.findById(id),
          listByIds: (ids) => context.repositories.contacts.listByIds(ids),
          findByPrimaryPhone: (phoneE164) =>
            context.repositories.contacts.findByPrimaryPhone(phoneE164),
        },
        readInboxProjection: {
          findByContactId: (contactId) =>
            context.repositories.inboxProjection.findByContactId(contactId),
        },
        writeContacts: {
          upsert: (record) => context.repositories.contacts.upsert(record),
        },
        writeContactIdentities: {
          upsert: (record) => context.repositories.contactIdentities.upsert(record),
        },
        clock: {
          now: () => new Date("2026-06-23T12:30:00.000Z"),
        },
        idGenerator: () => "unused",
      });

      expect(result.contact.id).toBe("contact-e164-identity");
      expect(result.isNewlyCreated).toBe(false);
    } finally {
      await context.dispose();
    }
  });
});

describe("phone normalization migration", () => {
  it("backfills mixed phone formats and deduplicates same-contact phone identities", async () => {
    const client = new PGlite();

    try {
      await applyMigrationsThrough(client, "0075_phone_e164_normalization.sql");

      const db = drizzle(client, {
        schema: databaseSchema,
      }) as Stage1Database;

      await db.insert(contacts).values([
        {
          id: "contact-1",
          salesforceContactId: null,
          displayName: "Contact One",
          primaryPhone: "9163001877",
          primaryEmail: null,
          createdAt: new Date("2026-06-23T12:00:00.000Z"),
          updatedAt: new Date("2026-06-23T12:00:00.000Z"),
        },
        {
          id: "contact-2",
          salesforceContactId: null,
          displayName: "Contact Two",
          primaryPhone: "17743680124",
          primaryEmail: null,
          createdAt: new Date("2026-06-23T12:00:00.000Z"),
          updatedAt: new Date("2026-06-23T12:00:00.000Z"),
        },
      ]);

      await db.insert(contactIdentities).values([
        {
          id: "identity-1",
          contactId: "contact-1",
          kind: "phone",
          normalizedValue: "9163001877",
          isPrimary: true,
          source: "manual",
          verifiedAt: null,
        },
        {
          id: "identity-2",
          contactId: "contact-1",
          kind: "phone",
          normalizedValue: "+19163001877",
          isPrimary: false,
          source: "manual",
          verifiedAt: null,
        },
        {
          id: "identity-3",
          contactId: "contact-2",
          kind: "phone",
          normalizedValue: "1-774-368-0124",
          isPrimary: true,
          source: "manual",
          verifiedAt: null,
        },
      ]);

      await db.insert(consentRecords).values([
        {
          id: "consent-1",
          contactId: "contact-1",
          phoneE164: "9163001877",
          status: "opted_in",
          source: "operator_attestation",
          sourceDetail: null,
          consentedAt: new Date("2026-06-23T12:00:00.000Z"),
          revokedAt: null,
          recordedByUserId: null,
          notes: null,
          createdAt: new Date("2026-06-23T12:00:00.000Z"),
          updatedAt: new Date("2026-06-23T12:00:00.000Z"),
        },
      ]);

      const migrationSql = await readFile(
        new URL("../drizzle/0075_phone_e164_normalization.sql", import.meta.url),
        "utf8",
      );
      await client.exec(migrationSql);

      const repositoryBundle = createStage1RepositoryBundle(db);
      await expect(
        repositoryBundle.contacts.findByPrimaryPhone("+19163001877"),
      ).resolves.toMatchObject({ id: "contact-1", primaryPhone: "+19163001877" });
      await expect(
        repositoryBundle.contacts.findByPrimaryPhone("7743680124"),
      ).resolves.toMatchObject({ id: "contact-2", primaryPhone: "+17743680124" });
      await expect(
        repositoryBundle.consentRecords.findLatestByPhone("+19163001877"),
      ).resolves.toMatchObject({ id: "consent-1", phoneE164: "+19163001877" });

      const identityCountRow = await db
        .select({ value: count() })
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, "contact-1"));

      expect(identityCountRow[0]?.value).toBe(1);
      const contactOneIdentity =
        await repositoryBundle.contactIdentities.listByNormalizedValue({
          kind: "phone",
          normalizedValue: "+19163001877",
        });
      expect(contactOneIdentity).toHaveLength(1);
      expect(contactOneIdentity[0]?.contactId).toBe("contact-1");
    } finally {
      await client.close();
    }
  });
});
