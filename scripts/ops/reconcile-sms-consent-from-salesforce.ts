#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";

import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  consentRecords,
  contactIdentities,
  contacts,
  createDatabaseConnection,
  mapConsentRecordRow,
  type DatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  reconcileSmsConsent,
  type ConsentRecord,
  type ConsentStatus,
} from "@as-comms/domain";
import {
  normalizeOptionalString,
  normalizeSfId18to15,
  parseSalesforceOptInContactIds,
  shouldScrubLatestBackfillConsent,
  VOLUNTEER_APPLICATION_BACKFILL_NOTE,
} from "./reconcile-sms-consent-from-salesforce-helpers.js";

const SAMPLE_LIMIT = 5;
const TRACK_A_RECONCILE_LABEL = "Track A reconcile";
const CSV_PATH_ENV_KEY = "SMS_CONSENT_RECONCILE_CSV";

type CommandOptions = {
  readonly apply: boolean;
  readonly csvPath: string;
};

type PlatformContactMatch = {
  readonly contactId: string;
  readonly primaryPhone: string | null;
};

type LatestConsentRow = {
  readonly id: string;
  readonly contactId: string;
  readonly phoneE164: string;
  readonly status: ConsentStatus;
  readonly source: ConsentRecord["source"];
  readonly sourceDetail: string | null;
  readonly consentedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly recordedByUserId: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type ReconcileSamples = {
  readonly matchedContactIds: readonly string[];
  readonly optedInInsertedContactIds: readonly string[];
  readonly optedInAlreadyCurrentContactIds: readonly string[];
  readonly optedInNoPhoneContactIds: readonly string[];
  readonly notInPlatformSalesforceContactIds: readonly string[];
  readonly scrubbedRevokedContactIds: readonly string[];
};

export type ReconcileSmsConsentFromSalesforceSummary = {
  readonly apply: boolean;
  readonly distinctCsvContacts: number;
  readonly matched: number;
  readonly optedInInserted: number;
  readonly optedInAlreadyCurrent: number;
  readonly optedInNoPhone: number;
  readonly notInPlatform: number;
  readonly scrubbedRevoked: number;
  readonly samples: ReconcileSamples;
};

function pushSample(target: string[], value: string): void {
  if (target.length < SAMPLE_LIMIT) {
    target.push(value);
  }
}

function buildSalesforceContactMap(input: {
  readonly rows: readonly {
    readonly contactId: string;
    readonly salesforceId: string;
    readonly primaryPhone: string | null;
  }[];
  readonly label: string;
}): Map<string, PlatformContactMatch> {
  const mapping = new Map<string, PlatformContactMatch>();

  for (const row of input.rows) {
    const sf15 = normalizeSfId18to15(row.salesforceId);
    const existing = mapping.get(sf15);

    if (existing !== undefined && existing.contactId !== row.contactId) {
      throw new Error(
        `Ambiguous ${input.label} mapping for Salesforce Contact ID ${sf15}: ${existing.contactId}, ${row.contactId}.`,
      );
    }

    mapping.set(sf15, {
      contactId: row.contactId,
      primaryPhone: row.primaryPhone,
    });
  }

  return mapping;
}

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result;
  }

  return result.rows ?? [];
}

async function loadDirectSalesforceMatches(
  db: Stage1Database,
): Promise<Map<string, PlatformContactMatch>> {
  const rows = await db
    .select({
      contactId: contacts.id,
      salesforceId: contacts.salesforceContactId,
      primaryPhone: contacts.primaryPhone,
    })
    .from(contacts)
    .where(isNotNull(contacts.salesforceContactId))
    .orderBy(asc(contacts.id));

  return buildSalesforceContactMap({
    rows: rows.map((row) => ({
      contactId: row.contactId,
      salesforceId: row.salesforceId,
      primaryPhone: row.primaryPhone,
    })),
    label: "contacts.salesforce_contact_id",
  });
}

async function loadFallbackSalesforceMatches(
  db: Stage1Database,
): Promise<Map<string, PlatformContactMatch>> {
  const rows = await db
    .select({
      contactId: contactIdentities.contactId,
      salesforceId: contactIdentities.normalizedValue,
      primaryPhone: contacts.primaryPhone,
    })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contactIdentities.contactId, contacts.id))
    .where(eq(contactIdentities.kind, "salesforce_contact_id"))
    .orderBy(asc(contactIdentities.contactId));

  return buildSalesforceContactMap({
    rows,
    label: "contact_identities.normalized_value",
  });
}

async function loadLatestConsentByContactOrPhone(
  db: Stage1Database,
  input: {
    readonly contactId: string;
    readonly phoneE164: string;
  },
): Promise<ConsentRecord | null> {
  const [contactRow] = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.contactId, input.contactId))
    .orderBy(desc(consentRecords.createdAt), desc(consentRecords.id))
    .limit(1);

  if (contactRow !== undefined) {
    return mapConsentRecordRow(contactRow);
  }

  const [phoneRow] = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.phoneE164, input.phoneE164))
    .orderBy(desc(consentRecords.createdAt), desc(consentRecords.id))
    .limit(1);

  return phoneRow === undefined ? null : mapConsentRecordRow(phoneRow);
}

async function loadLatestBackfillConsentRows(
  db: Stage1Database,
): Promise<readonly LatestConsentRow[]> {
  const result = await db.execute(sql<LatestConsentRow>`
    with ranked as (
      select
        ${consentRecords.id} as "id",
        ${consentRecords.contactId} as "contactId",
        ${consentRecords.phoneE164} as "phoneE164",
        ${consentRecords.status} as "status",
        ${consentRecords.source} as "source",
        ${consentRecords.sourceDetail} as "sourceDetail",
        ${consentRecords.consentedAt} as "consentedAt",
        ${consentRecords.revokedAt} as "revokedAt",
        ${consentRecords.recordedByUserId} as "recordedByUserId",
        ${consentRecords.notes} as "notes",
        ${consentRecords.createdAt} as "createdAt",
        ${consentRecords.updatedAt} as "updatedAt",
        row_number() over (
          partition by ${consentRecords.contactId}
          order by ${consentRecords.createdAt} desc, ${consentRecords.id} desc
        ) as "rowNumber"
      from ${consentRecords}
      where ${consentRecords.contactId} is not null
    )
    select
      "id",
      "contactId",
      "phoneE164",
      "status",
      "source",
      "sourceDetail",
      "consentedAt",
      "revokedAt",
      "recordedByUserId",
      "notes",
      "createdAt",
      "updatedAt"
    from ranked
    where "rowNumber" = 1
      and "status" = 'opted_in'
      and "source" = 'volunteer_application_form'
      and "notes" = ${VOLUNTEER_APPLICATION_BACKFILL_NOTE}
    order by "contactId" asc
  `);

  return normalizeSqlResultRows(
    result as
      | readonly LatestConsentRow[]
      | {
          readonly rows?: readonly LatestConsentRow[];
        },
  );
}

function buildSalesforceConsentInsert(input: {
  readonly contactId: string;
  readonly phoneE164: string;
  readonly status: ConsentStatus;
  readonly reason: string;
  readonly notes: string;
  readonly nowIso: string;
}): typeof consentRecords.$inferInsert {
  return {
    id: randomUUID(),
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    status: input.status,
    source: "salesforce_field",
    sourceDetail: null,
    consentedAt: input.status === "opted_in" ? input.nowIso : null,
    revokedAt: input.status === "revoked" ? input.nowIso : null,
    recordedByUserId: null,
    notes: input.notes,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

function renderSampleSection(
  title: string,
  values: readonly string[],
): readonly string[] {
  return [title, ...(values.length === 0 ? ["- none"] : values.map((value) => `- ${value}`))];
}

export function renderReconcileSmsConsentFromSalesforceSummary(
  summary: ReconcileSmsConsentFromSalesforceSummary,
): string {
  return [
    "# SMS consent reconcile from Salesforce",
    "",
    `Mode: ${summary.apply ? "apply" : "dry-run"}`,
    "",
    "| metric | value |",
    "| --- | --- |",
    `| distinct_csv_contacts | ${summary.distinctCsvContacts} |`,
    `| matched | ${summary.matched} |`,
    `| opted_in_inserted | ${summary.optedInInserted} |`,
    `| opted_in_already_current | ${summary.optedInAlreadyCurrent} |`,
    `| opted_in_no_phone | ${summary.optedInNoPhone} |`,
    `| not_in_platform | ${summary.notInPlatform} |`,
    `| scrubbed_revoked | ${summary.scrubbedRevoked} |`,
    "",
    ...renderSampleSection("## Sample matched contact IDs", summary.samples.matchedContactIds),
    "",
    ...renderSampleSection(
      "## Sample opted-in inserts",
      summary.samples.optedInInsertedContactIds,
    ),
    "",
    ...renderSampleSection(
      "## Sample opted-in already-current contacts",
      summary.samples.optedInAlreadyCurrentContactIds,
    ),
    "",
    ...renderSampleSection(
      "## Sample opted-in contacts missing phones",
      summary.samples.optedInNoPhoneContactIds,
    ),
    "",
    ...renderSampleSection(
      "## Sample CSV Salesforce IDs not in platform",
      summary.samples.notInPlatformSalesforceContactIds,
    ),
    "",
    ...renderSampleSection(
      "## Sample scrubbed revoke contacts",
      summary.samples.scrubbedRevokedContactIds,
    ),
  ].join("\n");
}

function parseCommandOptions(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): CommandOptions {
  const { values } = parseArgs({
    args,
    options: {
      csv: {
        type: "string",
      },
      apply: {
        type: "boolean",
        default: false,
      },
      "dry-run": {
        type: "boolean",
        default: false,
      },
    },
    allowPositionals: false,
  });

  if (values.apply && values["dry-run"]) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }

  const csvPath = normalizeOptionalString(values.csv) ?? normalizeOptionalString(env[CSV_PATH_ENV_KEY]);
  if (csvPath === null) {
    throw new Error(`--csv <path> or ${CSV_PATH_ENV_KEY} is required.`);
  }

  return {
    apply: values.apply ?? false,
    csvPath,
  };
}

export async function reconcileSmsConsentFromSalesforce(input: {
  readonly db: DatabaseConnection["db"];
  readonly csvText: string;
  readonly apply: boolean;
  readonly now?: Date;
}): Promise<ReconcileSmsConsentFromSalesforceSummary> {
  const distinctCsvContactIds = parseSalesforceOptInContactIds(input.csvText);
  const distinctCsvContactIdSet = new Set(distinctCsvContactIds);
  const nowIso = (input.now ?? new Date()).toISOString();
  const runDate = nowIso.slice(0, 10);
  const latestConsentCache = new Map<string, ConsentRecord | null>();

  return input.db.transaction(async (tx) => {
    const directMatches = await loadDirectSalesforceMatches(tx);
    const fallbackMatches = await loadFallbackSalesforceMatches(tx);
    const contactIdToSalesforce15 = new Map<string, string>();
    const optInInserts: Array<typeof consentRecords.$inferInsert> = [];
    const scrubInserts: Array<typeof consentRecords.$inferInsert> = [];
    const samples = {
      matchedContactIds: [],
      optedInInsertedContactIds: [],
      optedInAlreadyCurrentContactIds: [],
      optedInNoPhoneContactIds: [],
      notInPlatformSalesforceContactIds: [],
      scrubbedRevokedContactIds: [],
    } satisfies Record<keyof ReconcileSamples, string[]>;
    let matched = 0;
    let optedInInserted = 0;
    let optedInAlreadyCurrent = 0;
    let optedInNoPhone = 0;
    let notInPlatform = 0;
    let scrubbedRevoked = 0;

    for (const [sf15, match] of directMatches) {
      contactIdToSalesforce15.set(match.contactId, sf15);
    }

    for (const [sf15, match] of fallbackMatches) {
      if (!contactIdToSalesforce15.has(match.contactId)) {
        contactIdToSalesforce15.set(match.contactId, sf15);
      }
    }

    async function getLatestConsent(match: {
      readonly contactId: string;
      readonly primaryPhone: string;
    }): Promise<ConsentRecord | null> {
      if (latestConsentCache.has(match.contactId)) {
        return latestConsentCache.get(match.contactId) ?? null;
      }

      const latestConsent = await loadLatestConsentByContactOrPhone(tx, {
        contactId: match.contactId,
        phoneE164: match.primaryPhone,
      });
      latestConsentCache.set(match.contactId, latestConsent);
      return latestConsent;
    }

    for (const salesforceContactId15 of distinctCsvContactIds) {
      const match =
        directMatches.get(salesforceContactId15) ??
        fallbackMatches.get(salesforceContactId15) ??
        null;

      if (match === null) {
        notInPlatform += 1;
        pushSample(samples.notInPlatformSalesforceContactIds, salesforceContactId15);
        continue;
      }

      matched += 1;
      pushSample(samples.matchedContactIds, match.contactId);

      if (match.primaryPhone === null) {
        optedInNoPhone += 1;
        pushSample(samples.optedInNoPhoneContactIds, match.contactId);
        continue;
      }

      const latestConsent = await getLatestConsent({
        contactId: match.contactId,
        primaryPhone: match.primaryPhone,
      });
      const action = reconcileSmsConsent({
        sfTextOptIn: true,
        latestConsent,
      });

      if (action.kind === "append") {
        optedInInserted += 1;
        pushSample(samples.optedInInsertedContactIds, match.contactId);
        optInInserts.push(
          buildSalesforceConsentInsert({
            contactId: match.contactId,
            phoneE164: match.primaryPhone,
            status: action.status,
            reason: action.reason,
            notes: `${action.reason} [${TRACK_A_RECONCILE_LABEL} ${runDate}]`,
            nowIso,
          }),
        );
        continue;
      }

      optedInAlreadyCurrent += 1;
      pushSample(samples.optedInAlreadyCurrentContactIds, match.contactId);
    }

    const latestBackfillConsentRows = await loadLatestBackfillConsentRows(tx);
    for (const latestConsent of latestBackfillConsentRows) {
      const salesforceContactId15 = contactIdToSalesforce15.get(latestConsent.contactId) ?? null;
      if (
        !shouldScrubLatestBackfillConsent({
          latestConsent,
          isInSalesforceOptInSet:
            salesforceContactId15 !== null &&
            distinctCsvContactIdSet.has(salesforceContactId15),
        })
      ) {
        continue;
      }

      const action = reconcileSmsConsent({
        sfTextOptIn: false,
        latestConsent,
      });
      if (action.kind !== "append") {
        continue;
      }

      scrubbedRevoked += 1;
      pushSample(samples.scrubbedRevokedContactIds, latestConsent.contactId);
      scrubInserts.push(
        buildSalesforceConsentInsert({
          contactId: latestConsent.contactId,
          phoneE164: latestConsent.phoneE164,
          status: action.status,
          reason: action.reason,
          notes: `not in Salesforce Text_Opt_In__c set [${TRACK_A_RECONCILE_LABEL} ${runDate}]`,
          nowIso,
        }),
      );
    }

    if (input.apply && optInInserts.length > 0) {
      await tx.insert(consentRecords).values(optInInserts);
    }

    if (input.apply && scrubInserts.length > 0) {
      await tx.insert(consentRecords).values(scrubInserts);
    }

    return {
      apply: input.apply,
      distinctCsvContacts: distinctCsvContactIds.length,
      matched,
      optedInInserted,
      optedInAlreadyCurrent,
      optedInNoPhone,
      notInPlatform,
      scrubbedRevoked,
      samples,
    };
  });
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "SMS consent reconcile from Salesforce failed.";
  }

  const errorWithMetadata = error as Error & {
    readonly code?: string;
    readonly detail?: string;
    readonly hint?: string;
    readonly cause?: unknown;
  };
  const details = [
    error.message,
    error.stack ? `stack=${error.stack}` : null,
    errorWithMetadata.code ? `code=${errorWithMetadata.code}` : null,
    errorWithMetadata.detail ? `detail=${errorWithMetadata.detail}` : null,
    errorWithMetadata.hint ? `hint=${errorWithMetadata.hint}` : null,
    errorWithMetadata.cause
      ? `cause=${
          errorWithMetadata.cause instanceof Error
            ? errorWithMetadata.cause.message
            : String(errorWithMetadata.cause)
        }`
      : null,
  ].filter((value): value is string => value !== null);

  if (errorWithMetadata.cause instanceof Error) {
    const causeWithMetadata = errorWithMetadata.cause as Error & {
      readonly code?: string;
      readonly detail?: string;
      readonly hint?: string;
    };
    if (causeWithMetadata.code) {
      details.push(`cause.code=${causeWithMetadata.code}`);
    }
    if (causeWithMetadata.detail) {
      details.push(`cause.detail=${causeWithMetadata.detail}`);
    }
    if (causeWithMetadata.hint) {
      details.push(`cause.hint=${causeWithMetadata.hint}`);
    }
  }

  return details.join("\n");
}

export async function main(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<ReconcileSmsConsentFromSalesforceSummary> {
  const options = parseCommandOptions(args, env);
  const csvText = await readFile(options.csvPath, "utf8");
  const connectionString = normalizeOptionalString(env.DATABASE_URL);

  if (connectionString === null) {
    throw new Error("DATABASE_URL is required.");
  }

  const connection = createDatabaseConnection({ connectionString });
  try {
    const summary = await reconcileSmsConsentFromSalesforce({
      db: connection.db,
      csvText,
      apply: options.apply,
    });
    console.log(renderReconcileSmsConsentFromSalesforceSummary(summary));
    return summary;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
