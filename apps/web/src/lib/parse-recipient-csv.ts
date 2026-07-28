import { z } from "zod";

import { normalizeEmailAddress } from "@as-comms/domain";

const emailSchema = z.string().email();
export const MAX_BROADCAST_CSV_UPLOAD_ROWS = 5_000;

export interface ParsedRecipientCsvRow {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface ParsedRecipientCsvResult {
  readonly recipients: readonly ParsedRecipientCsvRow[];
  readonly importedCount: number;
  readonly invalidSkippedCount: number;
  readonly duplicatesRemovedCount: number;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (character === undefined) {
      continue;
    }

    if (inQuotes) {
      if (character === "\"") {
        if (input[index + 1] === "\"") {
          field += "\"";
          index += 1;
          continue;
        }

        inQuotes = false;
        continue;
      }

      field += character;
      continue;
    }

    if (character === "\"") {
      if (field.trim().length === 0) {
        field = "";
      }
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (input[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

export function parseRecipientCsv(input: string): ParsedRecipientCsvResult {
  const rows = parseCsvRows(input.replace(/^\uFEFF/u, ""));
  const headerIndex = rows.findIndex((row) =>
    row.some((value) => value.trim().length > 0),
  );
  const headerRow = headerIndex < 0 ? undefined : rows[headerIndex];

  if (headerRow === undefined) {
    throw new Error("CSV file is empty.");
  }

  const headers = headerRow.map(normalizeHeader);
  const emailIndex = headers.findIndex((header) => header === "email");
  if (emailIndex < 0) {
    throw new Error('CSV must include an "email" column.');
  }

  const firstNameIndex = headers.findIndex(
    (header) => header === "firstname",
  );
  const lastNameIndex = headers.findIndex((header) => header === "lastname");

  const nonEmptyDataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((value) => value.trim().length > 0));
  if (nonEmptyDataRows.length > MAX_BROADCAST_CSV_UPLOAD_ROWS) {
    throw new Error(
      `CSV can include at most ${MAX_BROADCAST_CSV_UPLOAD_ROWS.toLocaleString()} recipient rows.`,
    );
  }

  const recipients: ParsedRecipientCsvRow[] = [];
  const seenEmails = new Set<string>();
  let invalidSkippedCount = 0;
  let duplicatesRemovedCount = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some((value) => value.trim().length > 0)) {
      invalidSkippedCount += 1;
      continue;
    }

    const email = normalizeEmailAddress(row[emailIndex] ?? "") ?? "";
    if (!emailSchema.safeParse(email).success) {
      invalidSkippedCount += 1;
      continue;
    }

    if (seenEmails.has(email)) {
      duplicatesRemovedCount += 1;
      continue;
    }

    seenEmails.add(email);
    recipients.push({
      email,
      firstName:
        firstNameIndex < 0
          ? null
          : normalizeOptionalValue(row[firstNameIndex]),
      lastName:
        lastNameIndex < 0 ? null : normalizeOptionalValue(row[lastNameIndex]),
    });
  }

  return {
    recipients,
    importedCount: recipients.length,
    invalidSkippedCount,
    duplicatesRemovedCount,
  };
}
