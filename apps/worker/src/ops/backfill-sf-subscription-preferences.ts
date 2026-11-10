#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  planSubscriptionBackfill,
  type SubscriptionBackfillInput,
  type SubscriptionBackfillPlan,
  type SubscriptionBackfillWrite,
} from "@as-comms/domain";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
} from "@as-comms/db";
import {
  createSalesforceApiClient,
  createSalesforceWriteClient,
  SalesforceWriteError,
  type SalesforceWriteClient,
  type SubscriptionPreferenceUpsertResult,
} from "@as-comms/integrations";
import {
  salesforceSubscriptionBoxFieldByValue,
  salesforceSubscriptionBoxValues,
  type SalesforceSubscriptionBox,
} from "@as-comms/contracts";

import { readSalesforceWriteConfig } from "./check-sf-subscription-permissions.js";
import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
  readRequiredFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

export interface SubscriptionBackfillLoader {
  load(): Promise<Readonly<{ snapshotAt: string; input: SubscriptionBackfillInput }>>;
  newerPlatformChangeEmails(
    emails: readonly string[],
    snapshotAt: string,
  ): Promise<ReadonlySet<string>>;
  close?(): Promise<void>;
}

export interface SubscriptionBackfillFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

export interface SubscriptionBackfillRunDependencies {
  readonly loader: SubscriptionBackfillLoader;
  readonly writeClient?: SalesforceWriteClient;
  readonly fileSystem?: SubscriptionBackfillFileSystem;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly logger?: Logger;
}

type ResultRow = Readonly<{
  email: string;
  action: "create" | "update" | "not_in_plan";
  outcome: "created" | "updated" | "failed" | "skipped_newer_platform_change" | "not_in_plan";
  salesforceRecordId: string | null;
  errorKind: string;
  errorCode: string;
  attempts: number;
}>;

const defaultFileSystem: SubscriptionBackfillFileSystem = { mkdir, readFile, writeFile };
const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const sleepDefault = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: readonly (readonly unknown[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function fieldRows(write: SubscriptionBackfillWrite): readonly (readonly unknown[])[] {
  const fields: [string, unknown, unknown][] = [];
  const change = write.change;
  const before = write.before;
  const add = (key: keyof typeof change, field: string): void => {
    if (hasOwn(change, key)) fields.push([field, before[key as keyof typeof before], change[key]]);
  };
  add("contactId", "contact_id");
  add("generalNewsletter", "general_newsletter");
  add("oregonShoresNewsletter", "oregon_shores_newsletter");
  add("unsubscribedFromAll", "unsubscribed_from_all");
  add("unsubscribedAt", "unsubscribed_at");
  add("emailBounced", "email_bounced");
  add("creationSource", "creation_source");
  if (change.projectBoxes !== undefined) {
    for (const box of salesforceSubscriptionBoxValues) {
      if (change.projectBoxes[box] !== undefined) {
        fields.push([
          `project_box:${box}`,
          before.projectBoxes?.[box],
          change.projectBoxes[box],
        ]);
      }
    }
  }
  return fields.map(([field, from, to]) => [
    write.email,
    write.action,
    write.salesforceRecordId,
    hasOwn(change, "contactId") ? change.contactId : write.before.contactId,
    field,
    from,
    to,
    write.reasons.join(";"),
  ]);
}

function parseEmails(contents: string): string[] {
  return [...new Set(contents.split(/\r?\n/u).map(normalizeEmail).filter(Boolean))];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function flagsForRun(args: readonly string[]): {
  out: string;
  execute: boolean;
  expectWrites: number | null;
  emailsFile: string | null;
  chunkSize: number;
  pauseSeconds: number;
} {
  const flags = parseCliFlags(args);
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const expected = readOptionalStringFlag(flags, "expect-writes");
  const expectWrites = expected === null ? null : Number.parseInt(expected, 10);
  if (expected !== null && (expectWrites === null || !Number.isInteger(expectWrites) || expectWrites < 0))
    throw new Error("--expect-writes must be a non-negative integer.");
  const chunkSize = readOptionalIntegerFlag(flags, "chunk-size", 5000);
  const pauseSeconds = readOptionalIntegerFlag(flags, "pause-seconds", 360);
  if (chunkSize < 1) throw new Error("--chunk-size must be at least 1.");
  if (pauseSeconds < 0) throw new Error("--pause-seconds must not be negative.");
  return {
    out: readRequiredFlag(flags, "out"),
    execute,
    expectWrites,
    emailsFile: readOptionalStringFlag(flags, "emails"),
    chunkSize,
    pauseSeconds,
  };
}

async function writePlanFiles(input: {
  readonly fs: SubscriptionBackfillFileSystem;
  readonly out: string;
  readonly snapshotAt: string;
  readonly mode: "dry_run" | "execute";
  readonly plan: SubscriptionBackfillPlan;
  readonly writes: readonly SubscriptionBackfillWrite[];
}): Promise<void> {
  await input.fs.mkdir(input.out, { recursive: true });
  await input.fs.writeFile(
    `${input.out}/plan-summary.json`,
    `${JSON.stringify({ ...input.plan.summary, snapshotAt: input.snapshotAt, mode: input.mode, writeCount: input.writes.length }, null, 2)}\n`,
    "utf8",
  );
  await input.fs.writeFile(
    `${input.out}/diff.csv`,
    csv([
      ["email", "action", "salesforce_record_id", "contact_id", "field", "from", "to", "reasons"],
      ...input.writes.flatMap(fieldRows),
    ]),
    "utf8",
  );
  await input.fs.writeFile(
    `${input.out}/sf-ticked-not-on-platform.csv`,
    csv([
      ["email", "salesforce_record_id", "contact_id"],
      ...input.plan.sfTickedNotOnPlatform.map((row) => [row.email, row.salesforceRecordId, row.contactId]),
    ]),
    "utf8",
  );
}

async function writeResults(
  fs: SubscriptionBackfillFileSystem,
  out: string,
  results: readonly ResultRow[],
): Promise<void> {
  await fs.writeFile(
    `${out}/results.csv`,
    csv([
      ["email", "action", "outcome", "salesforce_record_id", "error_kind", "error_code", "attempts"],
      ...results.map((row) => [row.email, row.action, row.outcome, row.salesforceRecordId, row.errorKind, row.errorCode, row.attempts]),
    ]),
    "utf8",
  );
}

function resultFromWrite(
  write: SubscriptionBackfillWrite,
  result: SubscriptionPreferenceUpsertResult,
  attempts: number,
): ResultRow {
  return {
    email: write.email,
    action: write.action,
    outcome: result.outcome,
    salesforceRecordId: result.salesforceId ?? write.salesforceRecordId,
    errorKind: result.error?.kind ?? "",
    errorCode: result.error?.code ?? "",
    attempts,
  };
}

async function upsertOneWithRetries(input: {
  readonly write: SubscriptionBackfillWrite;
  readonly client: SalesforceWriteClient;
  readonly sleep: (milliseconds: number) => Promise<void>;
}): Promise<{ row: ResultRow; permission: boolean }> {
  const waits = [2_000, 8_000, 30_000];
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const result = (await input.client.upsertSubscriptionPreferences([input.write.change]))[0];
      if (result === undefined) throw new Error("Salesforce returned no result for an upsert.");
      if (result.error?.kind === "transient" && attempts <= waits.length) {
        await input.sleep(waits[attempts - 1] ?? 30_000);
        continue;
      }
      return { row: resultFromWrite(input.write, result, attempts), permission: result.error?.kind === "permission" };
    } catch (error) {
      if (error instanceof SalesforceWriteError) {
        if (error.kind === "permission") {
          return { row: { email: input.write.email, action: input.write.action, outcome: "failed", salesforceRecordId: input.write.salesforceRecordId, errorKind: "permission", errorCode: error.code, attempts }, permission: true };
        }
        if (error.kind === "transient" && attempts <= waits.length) {
          await input.sleep(waits[attempts - 1] ?? 30_000);
          continue;
        }
        return { row: { email: input.write.email, action: input.write.action, outcome: "failed", salesforceRecordId: input.write.salesforceRecordId, errorKind: error.kind, errorCode: error.code, attempts }, permission: false };
      }
      throw error;
    }
  }
}

/** Runs a prepared plan. Exported dependency seams keep operational behavior testable without credentials. */
export async function runSubscriptionBackfill(
  args: readonly string[],
  dependencies: SubscriptionBackfillRunDependencies,
): Promise<number> {
  const options = flagsForRun(args);
  const fs = dependencies.fileSystem ?? defaultFileSystem;
  const logger = dependencies.logger ?? console;
  const sleep = dependencies.sleep ?? sleepDefault;
  const loaded = await dependencies.loader.load();
  const plan = planSubscriptionBackfill(loaded.input);
  let selected = [...plan.writes];
  const results: ResultRow[] = [];

  if (options.emailsFile !== null) {
    const requested = parseEmails(await fs.readFile(options.emailsFile, "utf8"));
    const selectedByEmail = new Map(plan.writes.map((write) => [write.email, write]));
    selected = requested.flatMap((email) => {
      const write = selectedByEmail.get(email);
      if (write === undefined) {
        results.push({ email, action: "not_in_plan", outcome: "not_in_plan", salesforceRecordId: null, errorKind: "", errorCode: "", attempts: 0 });
        return [];
      }
      return [write];
    });
  }
  if (options.execute && options.expectWrites !== selected.length)
    throw new Error("--execute requires --expect-writes equal to this run's planned write count.");
  if (options.execute && dependencies.writeClient === undefined)
    throw new Error("An execute run requires a Salesforce write client.");

  await writePlanFiles({
    fs,
    out: options.out,
    snapshotAt: loaded.snapshotAt,
    mode: options.execute ? "execute" : "dry_run",
    plan,
    writes: selected,
  });
  logger.log(JSON.stringify({ event: "sf_subscription_backfill.plan", mode: options.execute ? "execute" : "dry_run", writeCount: selected.length, summary: plan.summary }));
  if (!options.execute) return 0;

  let stoppedForPermission = false;
  let stoppedForWholeCallFailure = false;
  const writeClient = dependencies.writeClient;
  if (writeClient === undefined) throw new Error("An execute run requires a Salesforce write client.");
  for (const [chunkIndex, writeChunk] of chunks(selected, options.chunkSize).entries()) {
    const newer = await dependencies.loader.newerPlatformChangeEmails(writeChunk.map((write) => write.email), loaded.snapshotAt);
    const eligible = writeChunk.filter((write) => !newer.has(write.email));
    for (const write of writeChunk) {
      if (newer.has(write.email)) results.push({ email: write.email, action: write.action, outcome: "skipped_newer_platform_change", salesforceRecordId: write.salesforceRecordId, errorKind: "", errorCode: "", attempts: 0 });
    }
    for (const batch of chunks(eligible, 200)) {
      let batchAttempts = 0;
      let batchResults: readonly SubscriptionPreferenceUpsertResult[] | null = null;
      try {
        for (;;) {
          batchAttempts += 1;
          try {
            batchResults = await writeClient.upsertSubscriptionPreferences(batch.map((write) => write.change));
            break;
          } catch (error) {
            if (!(error instanceof SalesforceWriteError)) throw error;
            if (error.kind === "permission") {
              stoppedForPermission = true;
              const reported = new Set<string>();
              for (const completed of error.completedResults) {
                const write = batch.find((candidate) => candidate.email === completed.email);
                if (write !== undefined) {
                  results.push(resultFromWrite(write, completed, batchAttempts));
                  reported.add(write.email);
                }
              }
              for (const write of batch) {
                if (!reported.has(write.email)) results.push({ email: write.email, action: write.action, outcome: "failed", salesforceRecordId: write.salesforceRecordId, errorKind: "permission", errorCode: error.code, attempts: batchAttempts });
              }
              break;
            }
            if (error.kind !== "transient" || batchAttempts > 3) throw error;
            await sleep(([2_000, 8_000, 30_000][batchAttempts - 1] ?? 30_000));
          }
        }
      } catch (error) {
        const details = error instanceof SalesforceWriteError ? error : null;
        for (const write of batch) results.push({ email: write.email, action: write.action, outcome: "failed", salesforceRecordId: write.salesforceRecordId, errorKind: details?.kind ?? "permanent", errorCode: details?.code ?? "UNKNOWN", attempts: batchAttempts });
        stoppedForPermission ||= details?.kind === "permission";
        stoppedForWholeCallFailure = !stoppedForPermission;
      }
      // No per-record results: the whole call failed or was denied, and every
      // row of this batch is already in `results`. Stop here.
      if (batchResults === null) break;
      // Salesforce returns per-record outcomes for a composite request. Scan
      // them before retrying any transient row so a permission denial halts
      // this run immediately, even when a preceding row happened to lock.
      if (batchResults.some((result) => result.error?.kind === "permission")) {
        for (const write of batch) {
          const result = batchResults.find((candidate) => candidate.email === write.email);
          if (result !== undefined) results.push(resultFromWrite(write, result, batchAttempts));
        }
        stoppedForPermission = true;
        break;
      }
      for (const write of batch) {
        const result = batchResults.find((candidate) => candidate.email === write.email);
        if (result === undefined) {
          results.push({ email: write.email, action: write.action, outcome: "failed", salesforceRecordId: write.salesforceRecordId, errorKind: "permanent", errorCode: "MISSING_RESULT", attempts: batchAttempts });
          continue;
        }
        if (result.error?.kind === "transient") {
          const retry = await upsertOneWithRetries({ write, client: writeClient, sleep });
          results.push(retry.row);
          if (retry.permission) stoppedForPermission = true;
        } else {
          results.push(resultFromWrite(write, result, batchAttempts));
          if (result.error?.kind === "permission") stoppedForPermission = true;
        }
        if (stoppedForPermission) break;
      }
      if (stoppedForPermission || stoppedForWholeCallFailure) break;
    }
    logger.log(JSON.stringify({ event: "sf_subscription_backfill.chunk", chunk: chunkIndex + 1, chunkCount: Math.ceil(selected.length / options.chunkSize), planned: writeChunk.length }));
    // Keep results.csv current, so a run killed between chunks still leaves
    // a record of what it wrote. A re-run continues from live Salesforce.
    await writeResults(fs, options.out, results);
    if (stoppedForPermission || stoppedForWholeCallFailure) break;
    if (chunkIndex + 1 < Math.ceil(selected.length / options.chunkSize)) await sleep(options.pauseSeconds * 1_000);
  }
  await writeResults(fs, options.out, results);
  const tallies = results.reduce<Record<string, number>>((counts, row) => {
    counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
    return counts;
  }, {});
  logger.log(JSON.stringify({ event: "sf_subscription_backfill.complete", ...tallies }));
  return stoppedForPermission || stoppedForWholeCallFailure ? 1 : 0;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value = env.WORKER_DATABASE_URL ?? env.DATABASE_URL ?? env.DATABASE_PUBLIC_URL;
  if (value === undefined || value.trim() === "")
    throw new Error("DATABASE_PUBLIC_URL, DATABASE_URL, or WORKER_DATABASE_URL is required for this ops command.");
  return value.trim();
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}
const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const rowString = (row: Record<string, unknown>, name: string): string | null =>
  typeof row[name] === "string" && row[name].trim() !== "" ? row[name] : null;
const rowBoolean = (row: Record<string, unknown>, name: string): boolean => row[name] === true;
// Salesforce sends "…+0000" and postgres-js may send a Date or a string:
// always hand the planner an ISO instant.
const rowDate = (row: Record<string, unknown>, name: string): string | null => {
  const value = row[name];
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? new Date(value)
        : null;
  return date === null || Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function salesforceInputRow(row: Record<string, unknown>): Record<string, unknown> {
  return row;
}

/** The production loader uses only read queries; Salesforce writes are constructed separately after the plan is frozen. */
export function createProductionSubscriptionBackfillLoader(env: NodeJS.ProcessEnv): SubscriptionBackfillLoader {
  const connection = createDatabaseConnection({ connectionString: readConnectionString(env) });
  const sql = connection.sql as unknown as SqlRunner;
  const config = readSalesforceWriteConfig(env);
  const salesforce = createSalesforceApiClient({ ...config, bearerToken: "ops", contactCaptureMode: "delta_polling", membershipCaptureMode: "delta_polling" });
  return {
    async load() {
      const snapshotAt = new Date().toISOString();
      const boxFields = salesforceSubscriptionBoxValues.map((box) => salesforceSubscriptionBoxFieldByValue[box]).join(", ");
      const [contactRows, membershipRows, projectRows, preferenceRows, dbRows] = await Promise.all([
        salesforce.queryAll("SELECT Id, Email, HasOptedOutOfEmail, npsp__Do_Not_Contact__c FROM Contact WHERE Email != null"),
        salesforce.queryAll("SELECT Id, Contact__c, Project__c, Status__c FROM Expedition_Members__c WHERE Contact__c != null AND Project__r.Subscription_Box__c != null"),
        salesforce.queryAll("SELECT Id, Name, Subscription_Box__c FROM Project__c WHERE Subscription_Box__c != null"),
        salesforce.queryAll(`SELECT Id, Email__c, Contact__c, ${boxFields}, Adventure_Scientists_General_Newsletter__c, Oregon_Shores_Newsletter__c, Unsubscribed_from_all__c, Unsubscribed_at__c, Email_Bounced__c FROM Email_Subscription_Preference__c`),
        Promise.all([
          sql.unsafe<readonly Record<string, unknown>[]>("select project_id, connected_to_project_id from project_dimensions"),
          sql.unsafe<readonly Record<string, unknown>[]>("select email, status from newsletter_subscribers"),
          sql.unsafe<readonly Record<string, unknown>[]>("select email, reason from newsletter_suppressions"),
          sql.unsafe<readonly Record<string, unknown>[]>("select normalized_email as email, reason from suppression_list"),
          sql.unsafe<readonly Record<string, unknown>[]>("select cc.scope_type, cc.scope_id, cc.opted_out_at, c.salesforce_contact_id, c.primary_email as email from contact_consent cc join contacts c on c.id = cc.contact_id"),
        ]),
      ]);
      const [connectedProjects, newsletterSubscribers, newsletterSuppressions, suppressionList, consents] = dbRows;
      return {
        snapshotAt,
        input: {
          contacts: contactRows.flatMap((raw) => {
            const row = salesforceInputRow(raw);
            const id = rowString(row, "Id"); const email = rowString(row, "Email");
            return id === null || email === null ? [] : [{ salesforceContactId: id, email, hasOptedOutOfEmail: rowBoolean(row, "HasOptedOutOfEmail"), doNotContact: rowBoolean(row, "npsp__Do_Not_Contact__c") }];
          }),
          memberships: membershipRows.flatMap((raw) => { const row = salesforceInputRow(raw); const salesforceContactId = rowString(row, "Contact__c"); const projectId = rowString(row, "Project__c"); return salesforceContactId === null || projectId === null ? [] : [{ salesforceContactId, projectId, status: rowString(row, "Status__c") }]; }),
          projectBoxes: projectRows.flatMap((raw) => { const row = salesforceInputRow(raw); const projectId = rowString(row, "Id"); const box = rowString(row, "Subscription_Box__c"); return projectId === null || box === null ? [] : [{ projectId, box }]; }),
          connectedProjects: connectedProjects.flatMap((row) => { const projectId = rowString(row, "project_id"); return projectId === null ? [] : [{ projectId, connectedToProjectId: rowString(row, "connected_to_project_id") }]; }),
          existing: preferenceRows.flatMap((raw) => { const row = salesforceInputRow(raw); const salesforceRecordId = rowString(row, "Id"); const email = rowString(row, "Email__c"); if (salesforceRecordId === null || email === null) return []; const projectBoxes = Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, rowBoolean(row, salesforceSubscriptionBoxFieldByValue[box])])) as Record<SalesforceSubscriptionBox, boolean>; return [{ salesforceRecordId, email, contactId: rowString(row, "Contact__c"), generalNewsletter: rowBoolean(row, "Adventure_Scientists_General_Newsletter__c"), oregonShoresNewsletter: rowBoolean(row, "Oregon_Shores_Newsletter__c"), projectBoxes, unsubscribedFromAll: rowBoolean(row, "Unsubscribed_from_all__c"), unsubscribedAt: rowDate(row, "Unsubscribed_at__c"), emailBounced: rowBoolean(row, "Email_Bounced__c") }]; }),
          newsletterSubscribers: newsletterSubscribers.flatMap((row) => { const email = rowString(row, "email"); const status = rowString(row, "status"); return email === null || status === null ? [] : [{ email, status }]; }),
          newsletterSuppressions: newsletterSuppressions.flatMap((row) => { const email = rowString(row, "email"); const reason = rowString(row, "reason"); return email === null || (reason !== "unsubscribed" && reason !== "cleaned" && reason !== "platform_optout") ? [] : [{ email, reason }]; }),
          suppressionList: suppressionList.flatMap((row) => { const email = rowString(row, "email"); const reason = rowString(row, "reason"); return email === null || (reason !== "hard_bounce" && reason !== "soft_bounce_strike3" && reason !== "complaint" && reason !== "manual") ? [] : [{ email, reason }]; }),
          consents: consents.flatMap((row) => { const scopeType = rowString(row, "scope_type"); const optedOutAt = rowDate(row, "opted_out_at"); return (scopeType !== "project" && scopeType !== "newsletter" && scopeType !== "all") || optedOutAt === null ? [] : [{ salesforceContactId: rowString(row, "salesforce_contact_id"), email: rowString(row, "email"), scopeType, scopeId: rowString(row, "scope_id"), optedOutAt }]; }),
          creationSource: "Platform backfill 2026-11",
        },
      };
    },
    async newerPlatformChangeEmails(emails, snapshotAt) {
      if (emails.length === 0) return new Set();
      const rows = await sql.unsafe<readonly Record<string, unknown>[]>(`select distinct lower(trim(email)) as email from salesforce_subscription_outbox where created_at >= ${sqlString(snapshotAt)} and lower(trim(email)) in (${emails.map((email) => sqlString(email)).join(",")})`);
      return new Set(rows.flatMap((row) => { const email = rowString(row, "email"); return email === null ? [] : [normalizeEmail(email)]; }));
    },
    async close() { await closeDatabaseConnection(connection); },
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const loader = createProductionSubscriptionBackfillLoader(env);
  try {
    const flags = parseCliFlags(args);
    const execute = readOptionalBooleanFlag(flags, "execute", false);
    const dependencies: SubscriptionBackfillRunDependencies = execute
      ? { loader, logger, writeClient: createSalesforceWriteClient(readSalesforceWriteConfig(env)) }
      : { loader, logger };
    const status = await runSubscriptionBackfill(args, dependencies);
    if (status !== 0) process.exitCode = status;
  } finally {
    await loader.close?.();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backfill-sf-subscription-preferences failed.");
    process.exitCode = 1;
  });
}
