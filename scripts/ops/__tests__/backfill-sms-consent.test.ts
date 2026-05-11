import { describe, expect, it } from "vitest";

import { consentRecords } from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";

import { backfillSmsConsent } from "../backfill-sms-consent.js";

async function seedContact(input: {
  readonly context: Awaited<ReturnType<typeof createTestStage1Context>>;
  readonly id: string;
  readonly primaryPhone: string | null;
  readonly createdAt?: string;
}): Promise<void> {
  const createdAt = input.createdAt ?? "2026-05-01T00:00:00.000Z";

  await input.context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.id,
    primaryEmail: null,
    primaryPhone: input.primaryPhone,
    createdAt,
    updatedAt: createdAt,
  });
}

async function listConsentRows(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
) {
  return context.db.select().from(consentRecords);
}

describe("backfill-sms-consent", () => {
  it("inserts opted_in consent rows for contacts with primary phones and no consent", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact({
        context,
        id: "contact-1",
        primaryPhone: "+14065550101",
        createdAt: "2026-05-02T12:00:00.000Z",
      });
      await seedContact({
        context,
        id: "contact-2",
        primaryPhone: "+14065550102",
        createdAt: "2026-05-03T12:00:00.000Z",
      });

      const result = await backfillSmsConsent({
        db: context.db,
        dryRun: false,
      });
      const rows = await listConsentRows(context);

      expect(result.newlyInserted).toBe(2);
      expect(result.alreadyConsentedSkipped).toBe(0);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contactId: "contact-1",
            phoneE164: "+14065550101",
            status: "opted_in",
            source: "volunteer_application_form",
            notes: "Backfilled from volunteer application form opt-in 2026-05-08",
          }),
          expect.objectContaining({
            contactId: "contact-2",
            phoneE164: "+14065550102",
            status: "opted_in",
            source: "volunteer_application_form",
          }),
        ]),
      );
    } finally {
      await context.dispose();
    }
  });

  it("skips contacts that already have a consent row for the same phone and contact", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact({
        context,
        id: "contact-1",
        primaryPhone: "+14065550111",
      });
      await context.repositories.consentRecords.insert({
        id: "consent-existing",
        contactId: "contact-1",
        phoneE164: "+14065550111",
        status: "revoked",
        source: "operator_attestation",
        sourceDetail: null,
        consentedAt: new Date("2026-05-01T00:00:00.000Z"),
        revokedAt: new Date("2026-05-02T00:00:00.000Z"),
        recordedByUserId: null,
        notes: "Existing consent row",
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
        updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      });

      const result = await backfillSmsConsent({
        db: context.db,
        dryRun: false,
      });
      const rows = await listConsentRows(context);

      expect(result.newlyInserted).toBe(0);
      expect(result.alreadyConsentedSkipped).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("revoked");
    } finally {
      await context.dispose();
    }
  });

  it("ignores contacts without a primary phone", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact({
        context,
        id: "contact-1",
        primaryPhone: null,
      });

      const result = await backfillSmsConsent({
        db: context.db,
        dryRun: false,
      });

      expect(result.withPrimaryPhone).toBe(0);
      expect(result.newlyInserted).toBe(0);
      await expect(listConsentRows(context)).resolves.toHaveLength(0);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent across repeated runs", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact({
        context,
        id: "contact-1",
        primaryPhone: "+14065550121",
      });

      const first = await backfillSmsConsent({
        db: context.db,
        dryRun: false,
      });
      const second = await backfillSmsConsent({
        db: context.db,
        dryRun: false,
      });

      expect(first.newlyInserted).toBe(1);
      expect(second.newlyInserted).toBe(0);
      await expect(listConsentRows(context)).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });
});
