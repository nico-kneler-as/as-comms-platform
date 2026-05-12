#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  closeDatabaseConnection,
  consentRecords,
  contacts,
  createDatabaseConnection,
  type DatabaseConnection,
} from "@as-comms/db";

type ContactRow = {
  readonly id: string;
  readonly primaryPhone: string;
  readonly createdAt: Date | null | undefined;
};

type ConsentBackfillInsert = {
  readonly id: string;
  readonly contactId: string;
  readonly phoneE164: string;
  readonly status: "opted_in";
  readonly source: "volunteer_application_form";
  readonly sourceDetail: null;
  readonly consentedAt: Date;
  readonly revokedAt: null;
  readonly recordedByUserId: null;
  readonly notes: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type BackfillSmsConsentResult = {
  readonly dryRun: boolean;
  readonly totalContacts: number;
  readonly withPrimaryPhone: number;
  readonly alreadyConsentedSkipped: number;
  readonly newlyInserted: number;
  readonly consentedAtFallbackUsed: number;
  readonly sampleContactIds: readonly string[];
};

const BACKFILL_NOTE = "Backfilled from volunteer application form opt-in 2026-05-08";

function hasDryRunFlag(args: readonly string[]): boolean {
  return args.includes("--dry-run");
}

function resolveConsentedAt(
  createdAt: Date | null | undefined,
  fallbackNow: Date,
): { readonly consentedAt: Date; readonly usedFallback: boolean } {
  if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) {
    return {
      consentedAt: createdAt,
      usedFallback: false,
    };
  }

  return {
    consentedAt: fallbackNow,
    usedFallback: true,
  };
}

export async function backfillSmsConsent(input: {
  readonly db: DatabaseConnection["db"];
  readonly dryRun: boolean;
}): Promise<BackfillSmsConsentResult> {
  return input.db.transaction(async (tx) => {
    const allContacts = await tx.select().from(contacts);
    const contactsWithPrimaryPhone = allContacts
      .filter(
        (contact): contact is typeof contact & { readonly primaryPhone: string } =>
          contact.primaryPhone !== null,
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    const eligibleContacts = contactsWithPrimaryPhone.map((contact) => ({
      id: contact.id,
      primaryPhone: contact.primaryPhone,
      createdAt: contact.createdAt,
    })) satisfies readonly ContactRow[];

    const existingRows =
      eligibleContacts.length === 0 ? [] : await tx.select().from(consentRecords);

    const existingPairs = new Set(
      existingRows
        .filter(
          (row): row is typeof row & { readonly contactId: string } =>
            row.contactId !== null &&
            eligibleContacts.some(
              (contact) =>
                contact.id === row.contactId && contact.primaryPhone === row.phoneE164,
            ),
        )
        .map((row) => `${row.contactId}::${row.phoneE164}`),
    );

    let consentedAtFallbackUsed = 0;
    const now = new Date();
    const inserts: ConsentBackfillInsert[] = [];

    for (const contact of eligibleContacts) {
      if (existingPairs.has(`${contact.id}::${contact.primaryPhone}`)) {
        continue;
      }

      const consentedAtResolution = resolveConsentedAt(contact.createdAt, now);
      if (consentedAtResolution.usedFallback) {
        consentedAtFallbackUsed += 1;
      }

      inserts.push({
        id: randomUUID(),
        contactId: contact.id,
        phoneE164: contact.primaryPhone,
        status: "opted_in",
        source: "volunteer_application_form",
        sourceDetail: null,
        consentedAt: consentedAtResolution.consentedAt,
        revokedAt: null,
        recordedByUserId: null,
        notes: BACKFILL_NOTE,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!input.dryRun && inserts.length > 0) {
      await tx.insert(consentRecords).values(inserts);
    }

    return {
      dryRun: input.dryRun,
      totalContacts: allContacts.length,
      withPrimaryPhone: eligibleContacts.length,
      alreadyConsentedSkipped: eligibleContacts.length - inserts.length,
      newlyInserted: inserts.length,
      consentedAtFallbackUsed,
      sampleContactIds: inserts.slice(0, 10).map((record) => record.contactId),
    };
  });
}

export function renderBackfillSmsConsentMarkdown(
  result: BackfillSmsConsentResult,
): string {
  const sampleLines =
    result.sampleContactIds.length === 0
      ? ["- none"]
      : result.sampleContactIds.map((contactId) => `- ${contactId}`);

  return [
    "# SMS consent backfill",
    "",
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    "",
    "| metric | value |",
    "| --- | --- |",
    `| total_contacts | ${result.totalContacts} |`,
    `| with_primary_phone | ${result.withPrimaryPhone} |`,
    `| already_consented_skipped | ${result.alreadyConsentedSkipped} |`,
    `| newly_inserted | ${result.newlyInserted} |`,
    `| consented_at_fallback_used | ${result.consentedAtFallbackUsed} |`,
    "",
    "## Sample contact IDs",
    ...sampleLines,
  ].join("\n");
}

export async function runBackfillSmsConsentCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<BackfillSmsConsentResult> {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const connection = createDatabaseConnection({ connectionString });
  try {
    const result = await backfillSmsConsent({
      db: connection.db,
      dryRun: hasDryRunFlag(args),
    });
    console.log(renderBackfillSmsConsentMarkdown(result));
    return result;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.main) {
  runBackfillSmsConsentCommand(process.argv.slice(2), process.env).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "SMS consent backfill failed.",
    );
    process.exitCode = 1;
  });
}
