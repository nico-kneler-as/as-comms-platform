#!/usr/bin/env tsx

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { parse } from "csv-parse/sync";

import type {
  NewsletterSuppressionReason,
  UpsertNewsletterSubscriberInput,
  UpsertNewsletterSuppressionInput,
} from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  countSendableNewsletterSubscribers,
  upsertNewsletterSubscriber,
  upsertNewsletterSuppression,
  type DatabaseConnection,
} from "@as-comms/db";

type MailchimpCsvRow = Record<string, string | undefined>;

type NewsletterImportContext = {
  readonly db?: DatabaseConnection["db"];
};

type NewsletterImportOptions = {
  readonly subscribedCsv?: string;
  readonly unsubscribedCsv?: string;
  readonly cleanedCsv?: string;
  readonly execute: boolean;
};

type FileSummary = {
  readonly provided: boolean;
  readonly rowsRead: number;
  readonly blankEmailRowsSkipped: number;
  readonly uniqueEmailRows: number;
};

export type NewsletterImportSummary = {
  readonly execute: boolean;
  readonly subscribed: FileSummary & {
    readonly subscribersUpserted: number;
  };
  readonly unsubscribed: FileSummary & {
    readonly suppressionsUpserted: number;
    readonly reason: "unsubscribed";
  };
  readonly cleaned: FileSummary & {
    readonly suppressionsUpserted: number;
    readonly reason: "cleaned";
  };
  readonly totals: {
    readonly rowsRead: number;
    readonly blankEmailRowsSkipped: number;
    readonly uniqueEmailRows: number;
    readonly subscribersUpserted: number;
    readonly suppressionsUpserted: number;
    readonly sendableSubscribersAfterRun: number | null;
  };
};

type ParsedSubscriberDataset = {
  readonly rowsRead: number;
  readonly blankEmailRowsSkipped: number;
  readonly inputs: readonly UpsertNewsletterSubscriberInput[];
};

type ParsedSuppressionDataset = {
  readonly rowsRead: number;
  readonly blankEmailRowsSkipped: number;
  readonly inputs: readonly UpsertNewsletterSuppressionInput[];
};

function parseMailchimpCsv(csvText: string): readonly MailchimpCsvRow[] {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    // Mailchimp exports mix RFC doubled-quotes ("") with backslash-escaped
    // quotes (\") inside the same file (e.g. a name field 'Joelisoa \"Joel\"'),
    // which is malformed CSV. relax_quotes keeps such rows instead of aborting
    // the whole import on CSV_INVALID_CLOSING_QUOTE.
    relax_quotes: true,
  }) as readonly MailchimpCsvRow[];
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeEmailForDedup(email: string): string {
  return email.trim().toLowerCase();
}

function parseMemberRating(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseMailchimpTimestamp(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapSubscriberRow(row: MailchimpCsvRow): UpsertNewsletterSubscriberInput | null {
  const email = row["Email Address"];
  if (!email?.trim()) {
    return null;
  }

  return {
    email,
    firstName: normalizeOptionalString(row["First Name"]),
    lastName: normalizeOptionalString(row["Last Name"]),
    // Every row in the Mailchimp *subscribed* export is a subscribed member.
    // The CSV "Status" column is unreliable here — it carries custom values
    // like "In the Field" / "Trip Planning" (not a subscription status), which
    // would wrongly exclude those members from the sendable audience. Suppression
    // is driven by the separate unsubscribed/cleaned files, not this column.
    status: "subscribed",
    memberRating: parseMemberRating(row.MEMBER_RATING),
    optinTime: parseMailchimpTimestamp(row.OPTIN_TIME),
    optinIp: normalizeOptionalString(row.OPTIN_IP),
    confirmTime: parseMailchimpTimestamp(row.CONFIRM_TIME),
    confirmIp: normalizeOptionalString(row.CONFIRM_IP),
    lastChangedAt: parseMailchimpTimestamp(row.LAST_CHANGED),
    interests: normalizeOptionalString(row["What content are you interested in?"]),
    tags: normalizeOptionalString(row.TAGS),
    source: "mailchimp_import",
  };
}

function mapSuppressionRow(
  row: MailchimpCsvRow,
  reason: NewsletterSuppressionReason,
): UpsertNewsletterSuppressionInput | null {
  const email = row["Email Address"];
  if (!email?.trim()) {
    return null;
  }

  return {
    email,
    reason,
    source: "mailchimp_import",
  };
}

function parseSubscriberDataset(csvText: string): ParsedSubscriberDataset {
  const rows = parseMailchimpCsv(csvText);
  const inputs: UpsertNewsletterSubscriberInput[] = [];
  let blankEmailRowsSkipped = 0;

  for (const row of rows) {
    const mapped = mapSubscriberRow(row);
    if (mapped === null) {
      blankEmailRowsSkipped += 1;
      continue;
    }

    inputs.push(mapped);
  }

  return {
    rowsRead: rows.length,
    blankEmailRowsSkipped,
    inputs,
  };
}

function parseSuppressionDataset(
  csvText: string,
  reason: NewsletterSuppressionReason,
): ParsedSuppressionDataset {
  const rows = parseMailchimpCsv(csvText);
  const inputs: UpsertNewsletterSuppressionInput[] = [];
  let blankEmailRowsSkipped = 0;

  for (const row of rows) {
    const mapped = mapSuppressionRow(row, reason);
    if (mapped === null) {
      blankEmailRowsSkipped += 1;
      continue;
    }

    inputs.push(mapped);
  }

  return {
    rowsRead: rows.length,
    blankEmailRowsSkipped,
    inputs,
  };
}

function dedupeByEmail<T extends { readonly email: string }>(
  rows: readonly T[],
): readonly T[] {
  const deduped = new Map<string, T>();

  for (const row of rows) {
    deduped.set(normalizeEmailForDedup(row.email), row);
  }

  return [...deduped.values()];
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function parseDotenvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

async function loadEnvFromFile(filePath: string, env: NodeJS.ProcessEnv): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const line of content.split(/\r?\n/u)) {
    const parsed = parseDotenvLine(line);
    if (parsed === null) {
      continue;
    }

    const [key, value] = parsed;
    if (!env[key]) {
      env[key] = value;
    }
  }
}

async function loadDotenvEnv(env: NodeJS.ProcessEnv): Promise<void> {
  await loadEnvFromFile(path.resolve(process.cwd(), ".env.local"), env);
  await loadEnvFromFile(path.resolve(process.cwd(), ".env"), env);
}

async function readOptionalCsvFile(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }

  return readFile(filePath, "utf8");
}

export function parseSubscriberRows(
  csvText: string,
): readonly UpsertNewsletterSubscriberInput[] {
  return parseSubscriberDataset(csvText).inputs;
}

export function parseSuppressionRows(
  csvText: string,
  reason: NewsletterSuppressionReason,
): readonly UpsertNewsletterSuppressionInput[] {
  return parseSuppressionDataset(csvText, reason).inputs;
}

export async function runNewsletterImport(
  context: NewsletterImportContext,
  options: NewsletterImportOptions,
): Promise<NewsletterImportSummary> {
  if (options.execute && context.db === undefined) {
    throw new Error("Database connection is required when execute=true.");
  }

  const subscribedDataset =
    options.subscribedCsv === undefined
      ? null
      : parseSubscriberDataset(options.subscribedCsv);
  const unsubscribedDataset =
    options.unsubscribedCsv === undefined
      ? null
      : parseSuppressionDataset(options.unsubscribedCsv, "unsubscribed");
  const cleanedDataset =
    options.cleanedCsv === undefined
      ? null
      : parseSuppressionDataset(options.cleanedCsv, "cleaned");

  const subscriberInputs = dedupeByEmail(subscribedDataset?.inputs ?? []);
  const unsubscribedInputs = dedupeByEmail(unsubscribedDataset?.inputs ?? []);
  const cleanedInputs = dedupeByEmail(cleanedDataset?.inputs ?? []);

  if (options.execute) {
    const db = context.db;
    if (db === undefined) {
      throw new Error("Database connection is required when execute=true.");
    }

    // Mailchimp exports contain occasional malformed rows (e.g. an invalid
    // email that fails contract validation). Skip + count those instead of
    // aborting the whole import.
    let skippedInvalidRows = 0;
    const safeUpsert = async (
      fn: () => Promise<unknown>,
      email: string,
    ): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        skippedInvalidRows += 1;
        console.warn(
          `[import-mailchimp-newsletter] skipped invalid row (email=${JSON.stringify(
            email,
          )}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    for (const input of subscriberInputs) {
      await safeUpsert(() => upsertNewsletterSubscriber(db, input), input.email);
    }

    for (const input of unsubscribedInputs) {
      await safeUpsert(() => upsertNewsletterSuppression(db, input), input.email);
    }

    for (const input of cleanedInputs) {
      await safeUpsert(() => upsertNewsletterSuppression(db, input), input.email);
    }

    if (skippedInvalidRows > 0) {
      console.warn(
        `[import-mailchimp-newsletter] skipped ${skippedInvalidRows} row(s) that failed validation.`,
      );
    }
  }

  const sendableSubscribersAfterRun =
    options.execute && context.db !== undefined
      ? await countSendableNewsletterSubscribers(context.db)
      : null;

  const summary: NewsletterImportSummary = {
    execute: options.execute,
    subscribed: {
      provided: subscribedDataset !== null,
      rowsRead: subscribedDataset?.rowsRead ?? 0,
      blankEmailRowsSkipped: subscribedDataset?.blankEmailRowsSkipped ?? 0,
      uniqueEmailRows: subscriberInputs.length,
      subscribersUpserted: subscriberInputs.length,
    },
    unsubscribed: {
      provided: unsubscribedDataset !== null,
      rowsRead: unsubscribedDataset?.rowsRead ?? 0,
      blankEmailRowsSkipped: unsubscribedDataset?.blankEmailRowsSkipped ?? 0,
      uniqueEmailRows: unsubscribedInputs.length,
      suppressionsUpserted: unsubscribedInputs.length,
      reason: "unsubscribed",
    },
    cleaned: {
      provided: cleanedDataset !== null,
      rowsRead: cleanedDataset?.rowsRead ?? 0,
      blankEmailRowsSkipped: cleanedDataset?.blankEmailRowsSkipped ?? 0,
      uniqueEmailRows: cleanedInputs.length,
      suppressionsUpserted: cleanedInputs.length,
      reason: "cleaned",
    },
    totals: {
      rowsRead:
        (subscribedDataset?.rowsRead ?? 0) +
        (unsubscribedDataset?.rowsRead ?? 0) +
        (cleanedDataset?.rowsRead ?? 0),
      blankEmailRowsSkipped:
        (subscribedDataset?.blankEmailRowsSkipped ?? 0) +
        (unsubscribedDataset?.blankEmailRowsSkipped ?? 0) +
        (cleanedDataset?.blankEmailRowsSkipped ?? 0),
      uniqueEmailRows:
        subscriberInputs.length + unsubscribedInputs.length + cleanedInputs.length,
      subscribersUpserted: subscriberInputs.length,
      suppressionsUpserted: unsubscribedInputs.length + cleanedInputs.length,
      sendableSubscribersAfterRun,
    },
  };

  return summary;
}

export function renderNewsletterImportSummary(summary: NewsletterImportSummary): string {
  const mode = summary.execute ? "execute" : "dry-run";
  const actionVerb = summary.execute ? "upserted" : "would upsert";

  return [
    "# Mailchimp newsletter import",
    "",
    `Mode: ${mode}`,
    "",
    "| file | provided | rows_read | blank_email_rows_skipped | unique_email_rows | action | count |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| subscribed | ${String(summary.subscribed.provided)} | ${summary.subscribed.rowsRead} | ${summary.subscribed.blankEmailRowsSkipped} | ${summary.subscribed.uniqueEmailRows} | subscribers ${actionVerb} | ${summary.subscribed.subscribersUpserted} |`,
    `| unsubscribed | ${String(summary.unsubscribed.provided)} | ${summary.unsubscribed.rowsRead} | ${summary.unsubscribed.blankEmailRowsSkipped} | ${summary.unsubscribed.uniqueEmailRows} | suppressions (${summary.unsubscribed.reason}) ${actionVerb} | ${summary.unsubscribed.suppressionsUpserted} |`,
    `| cleaned | ${String(summary.cleaned.provided)} | ${summary.cleaned.rowsRead} | ${summary.cleaned.blankEmailRowsSkipped} | ${summary.cleaned.uniqueEmailRows} | suppressions (${summary.cleaned.reason}) ${actionVerb} | ${summary.cleaned.suppressionsUpserted} |`,
    "",
    "| total | value |",
    "| --- | --- |",
    `| rows_read | ${summary.totals.rowsRead} |`,
    `| blank_email_rows_skipped | ${summary.totals.blankEmailRowsSkipped} |`,
    `| unique_email_rows | ${summary.totals.uniqueEmailRows} |`,
    `| subscribers_${summary.execute ? "upserted" : "would_upsert"} | ${summary.totals.subscribersUpserted} |`,
    `| suppressions_${summary.execute ? "upserted" : "would_upsert"} | ${summary.totals.suppressionsUpserted} |`,
    `| sendable_subscribers_after_run | ${summary.totals.sendableSubscribersAfterRun ?? "n/a"} |`,
  ].join("\n");
}

type CommandOptions = {
  readonly execute: boolean;
  readonly subscribedPath?: string;
  readonly unsubscribedPath?: string;
  readonly cleanedPath?: string;
};

function parseCommandOptions(args: readonly string[]): CommandOptions {
  const { values } = parseArgs({
    args,
    options: {
      subscribed: {
        type: "string",
      },
      unsubscribed: {
        type: "string",
      },
      cleaned: {
        type: "string",
      },
      execute: {
        type: "boolean",
        default: false,
      },
    },
    allowPositionals: false,
  });

  return {
    execute: values.execute ?? false,
    subscribedPath: values.subscribed,
    unsubscribedPath: values.unsubscribed,
    cleanedPath: values.cleaned,
  };
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Mailchimp newsletter import failed.";
  }

  const errorWithMetadata = error as Error & {
    readonly code?: string;
    readonly detail?: string;
    readonly hint?: string;
    readonly cause?: unknown;
  };
  const details = [
    error.message,
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

  return details.join("\n");
}

export async function main(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<NewsletterImportSummary> {
  await loadDotenvEnv(env);
  const options = parseCommandOptions(args);
  const [subscribedCsv, unsubscribedCsv, cleanedCsv] = await Promise.all([
    readOptionalCsvFile(options.subscribedPath),
    readOptionalCsvFile(options.unsubscribedPath),
    readOptionalCsvFile(options.cleanedPath),
  ]);

  if (!options.execute) {
    const summary = await runNewsletterImport(
      {},
      {
        subscribedCsv,
        unsubscribedCsv,
        cleanedCsv,
        execute: false,
      },
    );
    console.log(renderNewsletterImportSummary(summary));
    return summary;
  }

  const connectionString = requireEnv(env, "DATABASE_URL");
  const connection = createDatabaseConnection({ connectionString });

  try {
    const summary = await runNewsletterImport(
      { db: connection.db },
      {
        subscribedCsv,
        unsubscribedCsv,
        cleanedCsv,
        execute: true,
      },
    );
    console.log(renderNewsletterImportSummary(summary));
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
