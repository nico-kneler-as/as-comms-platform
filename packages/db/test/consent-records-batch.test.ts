import { afterEach, describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedContact(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly email: string;
    readonly phoneE164: string;
  },
) {
  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.id,
    primaryEmail: input.email,
    primaryPhone: input.phoneE164,
    createdAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
  });
}

async function seedUser(context: Stage1Context): Promise<void> {
  const now = new Date("2026-07-02T12:00:00.000Z");
  await context.settings.users.upsert({
    id: "user-1",
    name: "Operator User",
    email: "user-1@example.org",
    emailVerified: now,
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("consentRecords.findLatestByContactIds", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("returns the newest consent per contact and omits contacts with no consent", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await seedUser(context);
    await seedContact(context, {
      id: "contact-1",
      email: "contact-1@example.org",
      phoneE164: "+14065550101",
    });
    await seedContact(context, {
      id: "contact-2",
      email: "contact-2@example.org",
      phoneE164: "+14065550102",
    });
    await seedContact(context, {
      id: "contact-3",
      email: "contact-3@example.org",
      phoneE164: "+14065550103",
    });

    await context.repositories.consentRecords.insert({
      id: "consent-contact-1-old",
      contactId: "contact-1",
      phoneE164: "+14065550101",
      status: "opted_in",
      source: "operator_attestation",
      sourceDetail: "old",
      consentedAt: new Date("2026-07-02T12:01:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user-1",
      notes: null,
      createdAt: new Date("2026-07-02T12:01:00.000Z"),
      updatedAt: new Date("2026-07-02T12:01:00.000Z"),
    });
    await context.repositories.consentRecords.insert({
      id: "consent-contact-1-new",
      contactId: "contact-1",
      phoneE164: "+14065550101",
      status: "revoked",
      source: "inbound_thread",
      sourceDetail: "new",
      consentedAt: null,
      revokedAt: new Date("2026-07-02T12:03:00.000Z"),
      recordedByUserId: null,
      notes: "revoked",
      createdAt: new Date("2026-07-02T12:03:00.000Z"),
      updatedAt: new Date("2026-07-02T12:03:00.000Z"),
    });
    await context.repositories.consentRecords.insert({
      id: "consent-contact-2-old",
      contactId: "contact-2",
      phoneE164: "+14065550102",
      status: "revoked",
      source: "salesforce_field",
      sourceDetail: "older",
      consentedAt: null,
      revokedAt: new Date("2026-07-02T12:02:00.000Z"),
      recordedByUserId: null,
      notes: null,
      createdAt: new Date("2026-07-02T12:02:00.000Z"),
      updatedAt: new Date("2026-07-02T12:02:00.000Z"),
    });
    await context.repositories.consentRecords.insert({
      id: "consent-contact-2-new",
      contactId: "contact-2",
      phoneE164: "+14065550122",
      status: "opted_in",
      source: "sms_reply_yes",
      sourceDetail: "latest",
      consentedAt: new Date("2026-07-02T12:04:00.000Z"),
      revokedAt: null,
      recordedByUserId: null,
      notes: null,
      createdAt: new Date("2026-07-02T12:04:00.000Z"),
      updatedAt: new Date("2026-07-02T12:04:00.000Z"),
    });

    const latestByContact =
      await context.repositories.consentRecords.findLatestByContactIds([
        "contact-1",
        "contact-2",
        "contact-2",
        "contact-3",
      ]);

    expect([...latestByContact.keys()]).toEqual(["contact-1", "contact-2"]);
    expect(latestByContact.get("contact-1")).toMatchObject({
      id: "consent-contact-1-new",
      status: "revoked",
      phoneE164: "+14065550101",
      sourceDetail: "new",
    });
    expect(latestByContact.get("contact-2")).toMatchObject({
      id: "consent-contact-2-new",
      status: "opted_in",
      phoneE164: "+14065550122",
      sourceDetail: "latest",
    });
    expect(latestByContact.has("contact-3")).toBe(false);
  });
});
