import { parse } from "csv-parse/sync";

const SALESFORCE_CONTACT_ID_COLUMN_INDEX = 3;

export const VOLUNTEER_APPLICATION_BACKFILL_NOTE =
  "Backfilled from volunteer application form opt-in 2026-05-08";

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

function parseSalesforceOptInCsv(csvText: string): readonly ParsedSalesforceCsvRow[] {
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

export function parseSalesforceOptInContactIds(csvText: string): readonly string[] {
  const rows = parseSalesforceOptInCsv(csvText);
  const distinctIds: string[] = [];
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const rawContactId = normalizeOptionalString(
      row[SALESFORCE_CONTACT_ID_COLUMN_INDEX],
    );

    if (index === 0 && rawContactId === "Contact ID") {
      continue;
    }

    if (rawContactId === null) {
      continue;
    }

    const normalizedContactId = normalizeSfId18to15(rawContactId);
    if (seen.has(normalizedContactId)) {
      continue;
    }

    seen.add(normalizedContactId);
    distinctIds.push(normalizedContactId);
  }

  return distinctIds;
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
