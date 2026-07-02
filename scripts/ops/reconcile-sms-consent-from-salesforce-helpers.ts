import { parse } from "csv-parse/sync";

export const VOLUNTEER_APPLICATION_BACKFILL_NOTE =
  "Backfilled from volunteer application form opt-in 2026-05-08";

const CONTACT_ID_HEADER = "contact id";
const PHONE_HEADER_CANDIDATES = new Set<string>([
  "mobile",
  "mobile phone",
  "mobilephone",
  "mobile number",
  "mobile phone number",
  "phone",
  "phone number",
  "cell",
  "cell phone",
  "cellphone",
]);

export type SalesforceOptInRow = {
  readonly contactId15: string;
  readonly rawPhone: string | null;
};

type ParsedSalesforceCsvRow = readonly string[];

type ScrubLatestConsentLike = {
  readonly status: string;
  readonly source: string;
  readonly notes: string | null;
};

export function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function parseSalesforceCsv(csvText: string): readonly ParsedSalesforceCsvRow[] {
  return parse(csvText, {
    columns: false,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as readonly ParsedSalesforceCsvRow[];
}

export function normalizeSfId18to15(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 15) {
    return trimmed;
  }

  if (trimmed.length === 18) {
    return trimmed.slice(0, 15);
  }

  throw new Error(
    `Expected Salesforce Contact ID to be 15 or 18 characters, received ${String(trimmed.length)} (${trimmed}).`,
  );
}

/**
 * Locate the Contact ID and (optional) phone columns from the header row.
 * Contact ID is required; the phone column is optional (older exports lack it).
 */
function resolveColumnIndices(header: ParsedSalesforceCsvRow): {
  readonly contactIdIndex: number;
  readonly phoneIndex: number;
} {
  let contactIdIndex = -1;
  let phoneIndex = -1;

  for (const [index, rawCell] of header.entries()) {
    const cell = rawCell?.trim().toLowerCase() ?? "";
    if (cell === CONTACT_ID_HEADER && contactIdIndex === -1) {
      contactIdIndex = index;
    }
    if (phoneIndex === -1 && PHONE_HEADER_CANDIDATES.has(cell)) {
      phoneIndex = index;
    }
  }

  if (contactIdIndex === -1) {
    throw new Error(
      'Salesforce export is missing a "Contact ID" column in its header row.',
    );
  }

  return { contactIdIndex, phoneIndex };
}

/**
 * Parse the Salesforce opt-in export into distinct opted-in contacts with their
 * (optional) phone. Rows are expedition-member grain, so a contact can appear
 * multiple times; we keep the first row per contact but upgrade to a non-empty
 * phone if a later row for the same contact has one.
 */
export function parseSalesforceOptInRows(
  csvText: string,
): readonly SalesforceOptInRow[] {
  const rows = parseSalesforceCsv(csvText);
  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const { contactIdIndex, phoneIndex } = resolveColumnIndices(header);

  const order: string[] = [];
  const phoneByContact = new Map<string, string | null>();

  for (const row of dataRows) {
    const rawContactId = normalizeOptionalString(row[contactIdIndex]);
    if (rawContactId === null) {
      continue;
    }

    const contactId15 = normalizeSfId18to15(rawContactId);
    const rawPhone =
      phoneIndex === -1 ? null : normalizeOptionalString(row[phoneIndex]);

    if (!phoneByContact.has(contactId15)) {
      order.push(contactId15);
      phoneByContact.set(contactId15, rawPhone);
      continue;
    }

    // Upgrade to a phone if the first occurrence had none.
    if (phoneByContact.get(contactId15) === null && rawPhone !== null) {
      phoneByContact.set(contactId15, rawPhone);
    }
  }

  return order.map((contactId15) => ({
    contactId15,
    rawPhone: phoneByContact.get(contactId15) ?? null,
  }));
}

export function parseSalesforceOptInContactIds(csvText: string): readonly string[] {
  return parseSalesforceOptInRows(csvText).map((row) => row.contactId15);
}

export function shouldScrubLatestBackfillConsent(input: {
  readonly latestConsent: ScrubLatestConsentLike | null;
  readonly isInSalesforceOptInSet: boolean;
}): boolean {
  return (
    input.isInSalesforceOptInSet === false &&
    input.latestConsent?.status === "opted_in" &&
    input.latestConsent.source === "volunteer_application_form" &&
    input.latestConsent.notes === VOLUNTEER_APPLICATION_BACKFILL_NOTE
  );
}
