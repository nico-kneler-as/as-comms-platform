#!/usr/bin/env tsx
/**
 * backfill-mailchimp-campaign-body
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:backfill-mailchimp-campaign-body -- --dry-run --limit=5
 *   pnpm --filter @as-comms/worker ops:backfill-mailchimp-campaign-body -- --confirm
 *
 * Dry-run by default. Re-fetches Mailchimp campaign content for historical
 * campaign_email rows and upserts fuller plain-text snippets into the existing
 * mailchimp_campaign_activity_details.snippet field. Click rows stay untouched
 * because their snippet is the clicked URL, not campaign body text.
 */
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

import { and, asc, count, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { type MailchimpCampaignActivityDetailRecord } from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  mailchimpCampaignActivityDetails,
  type Stage1Database,
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import { type FetchImplementation } from "@as-comms/integrations";

import {
  type CliFlags,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

const sampleLimit = 10;
const defaultTimeoutMs = 30_000;
const defaultRetryCount = 2;
const defaultProgressInterval = 25;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface MailchimpCampaignBodyCandidateRow {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly activityType: MailchimpCampaignActivityDetailRecord["activityType"];
  readonly campaignId: string;
  readonly campaignName: string | null;
  readonly audienceId: string | null;
  readonly memberId: string | null;
  readonly snippet: string;
}

interface MailchimpCampaignBodyCampaignGroup {
  readonly campaignId: string;
  readonly campaignName: string | null;
  readonly rows: readonly MailchimpCampaignBodyCandidateRow[];
}

interface MailchimpCampaignContentResponse {
  readonly html?: string | null;
  readonly plain_text?: string | null;
  readonly text?: string | null;
  readonly archive_html?: string | null;
  readonly archive_text?: string | null;
}

export interface MailchimpCampaignBodyBackfillSample {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly campaignId: string;
  readonly activityType: MailchimpCampaignActivityDetailRecord["activityType"];
  readonly currentSnippet: string;
  readonly nextSnippet: string;
}

export interface BackfillMailchimpCampaignBodyResult {
  readonly dryRun: boolean;
  readonly scannedCount: number;
  readonly campaignCount: number;
  readonly fetchedCount: number;
  readonly wouldUpdateCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly skippedClickedCount: number;
  readonly missingCampaignIds: readonly string[];
  readonly failedCampaignIds: readonly string[];
  readonly sampleUpdates: readonly MailchimpCampaignBodyBackfillSample[];
}

interface MailchimpApiConfig {
  readonly baseUrl: URL;
  readonly authorizationHeader: string;
  readonly timeoutMs: number;
  readonly retryCount: number;
}

interface BackfillMailchimpCampaignBodyOptions {
  readonly campaignId: string | null;
  readonly limitCampaigns: number | null;
  readonly progressInterval: number | null;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return connectionString;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for this ops command.`);
  }

  return value;
}

function readOptionalPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
): number {
  const rawValue = env[key]?.trim();

  if (rawValue === undefined || rawValue.length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = env[key];

  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readOptionalNonNegativeIntegerFlag(
  flags: CliFlags,
  key: string,
  defaultValue: number,
): number {
  const value = readOptionalStringFlag(flags, key);

  if (value === null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Flag --${key} must be a non-negative integer.`);
  }

  return parsed;
}

function resolveMailchimpDataCenter(
  apiKey: string,
  explicitDataCenter: string | null,
): string {
  if (explicitDataCenter !== null) {
    return explicitDataCenter;
  }

  const suffix = apiKey.split("-").at(-1);

  if (suffix === undefined || suffix.length === 0) {
    throw new Error(
      "MAILCHIMP_DATA_CENTER or MAILCHIMP_SERVER_PREFIX is required when MAILCHIMP_API_KEY does not include a data-center suffix.",
    );
  }

  return suffix;
}

function readMailchimpApiConfig(env: NodeJS.ProcessEnv): MailchimpApiConfig {
  const apiKey = readRequiredEnv(env, "MAILCHIMP_API_KEY");
  const baseUrl = readOptionalStringEnv(env, "MAILCHIMP_API_BASE_URL");
  const dataCenter =
    readOptionalStringEnv(env, "MAILCHIMP_DATA_CENTER") ??
    readOptionalStringEnv(env, "MAILCHIMP_SERVER_PREFIX");
  const timeoutMs = readOptionalPositiveIntegerEnv(
    env,
    "MAILCHIMP_API_TIMEOUT_MS",
    defaultTimeoutMs,
  );
  const retryCount = readOptionalPositiveIntegerEnv(
    env,
    "MAILCHIMP_API_RETRY_COUNT",
    defaultRetryCount,
  );

  return {
    baseUrl:
      baseUrl === null
        ? new URL(
            `https://${resolveMailchimpDataCenter(apiKey, dataCenter)}.api.mailchimp.com/3.0/`,
          )
        : new URL(baseUrl),
    authorizationHeader: `Basic ${Buffer.from(`anystring:${apiKey}`, "utf8").toString("base64")}`,
    timeoutMs,
    retryCount,
  };
}

function normalizeCampaignBodyText(value: string): string {
  return value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[ \t]*\n[ \t]*/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeCampaignBodyText(value);
  return normalized.length > 0 ? normalized : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu,
    (match, entity: string) => {
      const lowered = entity.toLowerCase();

      switch (lowered) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        case "nbsp":
          return " ";
        default:
          break;
      }

      if (lowered.startsWith("#x")) {
        const codePoint = Number.parseInt(lowered.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      if (lowered.startsWith("#")) {
        const codePoint = Number.parseInt(lowered.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      return match;
    },
  );
}

function htmlToPlainText(html: string): string {
  const withoutScripts = html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ");
  const withLineBreaks = withoutScripts
    .replaceAll(/<\s*br\s*\/?\s*>/giu, "\n")
    .replaceAll(
      /<\/(p|div|section|article|header|footer|tr|li|h[1-6])>/giu,
      "\n\n",
    )
    .replaceAll(/<li\b[^>]*>/giu, "- ");
  const stripped = withLineBreaks.replaceAll(/<[^>]+>/gu, " ");

  return normalizeCampaignBodyText(
    decodeHtmlEntities(stripped).replaceAll(/\u00a0/gu, " "),
  );
}

function stripMailchimpFooter(value: string): string {
  const boundaries = [
    "\n============================================================",
    "\nCopyright ©",
    "\nWant to change how you receive these emails?",
    "\nOur mailing address is:",
  ];
  let earliestBoundary = -1;

  for (const boundary of boundaries) {
    const index = value.indexOf(boundary);

    if (index === -1) {
      continue;
    }

    if (earliestBoundary === -1 || index < earliestBoundary) {
      earliestBoundary = index;
    }
  }

  return earliestBoundary === -1 ? value : value.slice(0, earliestBoundary);
}

function sanitizeMailchimpBodyText(value: string): string {
  return normalizeCampaignBodyText(
    stripMailchimpFooter(value)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !/^\*\|[A-Z0-9_:]+\|\*$/u.test(line))
      .join("\n"),
  );
}

function extractCampaignBodyText(
  content: MailchimpCampaignContentResponse,
): string | null {
  const plainTextCandidates = [
    content.plain_text,
    content.text,
    content.archive_text,
  ];

  for (const candidate of plainTextCandidates) {
    const normalized = normalizeOptionalString(candidate);

    if (normalized !== null) {
      return sanitizeMailchimpBodyText(normalized);
    }
  }

  const htmlCandidates = [content.html, content.archive_html];

  for (const candidate of htmlCandidates) {
    const normalized = normalizeOptionalString(candidate);

    if (normalized !== null) {
      return sanitizeMailchimpBodyText(htmlToPlainText(normalized));
    }
  }

  return null;
}

function buildMailchimpCampaignContentUrl(
  baseUrl: URL,
  campaignId: string,
): URL {
  return new URL(
    `campaigns/${encodeURIComponent(campaignId)}/content`,
    baseUrl,
  );
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);

  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);

  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.max(0, dateMs - Date.now());
}

async function readErrorResponseText(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

async function fetchMailchimpCampaignContent(input: {
  readonly campaignId: string;
  readonly fetchImplementation: FetchImplementation;
  readonly apiConfig: MailchimpApiConfig;
}): Promise<MailchimpCampaignContentResponse | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= input.apiConfig.retryCount; attempt += 1) {
    const response = await input.fetchImplementation(
      buildMailchimpCampaignContentUrl(input.apiConfig.baseUrl, input.campaignId),
      {
        method: "GET",
        headers: {
          authorization: input.apiConfig.authorizationHeader,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(input.apiConfig.timeoutMs),
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (response.ok) {
      return (await response.json()) as MailchimpCampaignContentResponse;
    }

    const body = await readErrorResponseText(response);
    const message =
      body.trim().length === 0
        ? `Mailchimp campaign content request failed with status ${String(response.status)} for campaign ${input.campaignId}.`
        : `Mailchimp campaign content request failed with status ${String(response.status)} for campaign ${input.campaignId}: ${body.trim()}`;
    lastError = new Error(message);

    if (
      attempt >= input.apiConfig.retryCount ||
      (response.status !== 429 && response.status < 500)
    ) {
      break;
    }

    await sleep(
      parseRetryAfterMs(response.headers.get("retry-after")) ??
        1000 * (attempt + 1),
    );
  }

  throw lastError ?? new Error("Mailchimp campaign content request failed.");
}

function truncateForLog(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

async function loadMailchimpCampaignBodyCandidates(
  db: Stage1Database,
  options: Pick<BackfillMailchimpCampaignBodyOptions, "campaignId">,
): Promise<readonly MailchimpCampaignBodyCandidateRow[]> {
  const where =
    options.campaignId === null
      ? and(
          isNotNull(mailchimpCampaignActivityDetails.campaignId),
          ne(mailchimpCampaignActivityDetails.activityType, "clicked"),
        )
      : and(
          isNotNull(mailchimpCampaignActivityDetails.campaignId),
          ne(mailchimpCampaignActivityDetails.activityType, "clicked"),
          eq(mailchimpCampaignActivityDetails.campaignId, options.campaignId),
        );
  const rows = await db
    .select({
      sourceEvidenceId: mailchimpCampaignActivityDetails.sourceEvidenceId,
      providerRecordId: mailchimpCampaignActivityDetails.providerRecordId,
      activityType: mailchimpCampaignActivityDetails.activityType,
      campaignId: mailchimpCampaignActivityDetails.campaignId,
      campaignName: mailchimpCampaignActivityDetails.campaignName,
      audienceId: mailchimpCampaignActivityDetails.audienceId,
      memberId: mailchimpCampaignActivityDetails.memberId,
      snippet: mailchimpCampaignActivityDetails.snippet,
    })
    .from(mailchimpCampaignActivityDetails)
    .where(where)
    .orderBy(
      asc(mailchimpCampaignActivityDetails.campaignId),
      asc(mailchimpCampaignActivityDetails.sourceEvidenceId),
    );

  return rows.map((row) => ({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType:
      row.activityType as MailchimpCampaignActivityDetailRecord["activityType"],
    campaignId: row.campaignId ?? "",
    campaignName: row.campaignName,
    audienceId: row.audienceId,
    memberId: row.memberId,
    snippet: row.snippet,
  }));
}

async function countSkippedClickedRows(
  db: Stage1Database,
  campaignIds: readonly string[],
): Promise<number> {
  if (campaignIds.length === 0) {
    return 0;
  }

  const rows = await db
    .select({ value: count() })
    .from(mailchimpCampaignActivityDetails)
    .where(
      and(
        inArray(mailchimpCampaignActivityDetails.campaignId, campaignIds),
        eq(mailchimpCampaignActivityDetails.activityType, "clicked"),
      ),
    );

  return rows[0]?.value ?? 0;
}

function groupCandidatesByCampaignId(
  rows: readonly MailchimpCampaignBodyCandidateRow[],
): MailchimpCampaignBodyCampaignGroup[] {
  const groups = new Map<string, MailchimpCampaignBodyCandidateRow[]>();

  for (const row of rows) {
    const existing = groups.get(row.campaignId);

    if (existing === undefined) {
      groups.set(row.campaignId, [row]);
      continue;
    }

    existing.push(row);
  }

  return Array.from(groups.entries()).map(([campaignId, groupedRows]) => ({
    campaignId,
    campaignName: groupedRows[0]?.campaignName ?? null,
    rows: groupedRows,
  }));
}

function limitCampaignGroups(
  groups: readonly MailchimpCampaignBodyCampaignGroup[],
  limitCampaigns: number | null,
): readonly MailchimpCampaignBodyCampaignGroup[] {
  return limitCampaigns === null ? groups : groups.slice(0, limitCampaigns);
}

function buildUpdatedDetailRecord(
  row: MailchimpCampaignBodyCandidateRow,
  nextSnippet: string,
): MailchimpCampaignActivityDetailRecord {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType: row.activityType,
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    memberId: row.memberId,
    campaignName: row.campaignName,
    snippet: nextSnippet,
  };
}

function buildSampleUpdate(
  row: MailchimpCampaignBodyCandidateRow,
  nextSnippet: string,
): MailchimpCampaignBodyBackfillSample {
  return {
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    campaignId: row.campaignId,
    activityType: row.activityType,
    currentSnippet: truncateForLog(normalizeCampaignBodyText(row.snippet), 120),
    nextSnippet: truncateForLog(nextSnippet, 120),
  };
}

function summarizeResult(
  result: BackfillMailchimpCampaignBodyResult,
): Record<string, unknown> {
  return {
    dryRun: result.dryRun,
    scannedCount: result.scannedCount,
    campaignCount: result.campaignCount,
    fetchedCount: result.fetchedCount,
    wouldUpdateCount: result.wouldUpdateCount,
    updatedCount: result.updatedCount,
    unchangedCount: result.unchangedCount,
    skippedClickedCount: result.skippedClickedCount,
    missingCampaignIds: result.missingCampaignIds,
    failedCampaignIds: result.failedCampaignIds,
    sampleUpdates: result.sampleUpdates,
  };
}

export async function backfillMailchimpCampaignBodies(input: {
  readonly db: Stage1Database;
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    "mailchimpCampaignActivityDetails"
  >;
  readonly fetchCampaignContent: (
    campaignId: string,
  ) => Promise<MailchimpCampaignContentResponse | null>;
  readonly dryRun?: boolean;
  readonly options?: Partial<BackfillMailchimpCampaignBodyOptions>;
  readonly logger?: Logger;
}): Promise<BackfillMailchimpCampaignBodyResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;
  const options: BackfillMailchimpCampaignBodyOptions = {
    campaignId: input.options?.campaignId ?? null,
    limitCampaigns: input.options?.limitCampaigns ?? null,
    progressInterval: input.options?.progressInterval ?? defaultProgressInterval,
  };
  const allCandidates = await loadMailchimpCampaignBodyCandidates(input.db, {
    campaignId: options.campaignId,
  });
  const campaignGroups = limitCampaignGroups(
    groupCandidatesByCampaignId(allCandidates),
    options.limitCampaigns,
  );
  const activeCampaignIds = campaignGroups.map((group) => group.campaignId);
  const skippedClickedCount = await countSkippedClickedRows(
    input.db,
    activeCampaignIds,
  );
  const missingCampaignIds = new Set<string>();
  const failedCampaignIds = new Set<string>();
  const sampleUpdates: MailchimpCampaignBodyBackfillSample[] = [];
  let fetchedCount = 0;
  let wouldUpdateCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (let index = 0; index < campaignGroups.length; index += 1) {
    const group = campaignGroups[index];

    if (group === undefined) {
      continue;
    }

    let content: MailchimpCampaignContentResponse | null;

    try {
      content = await input.fetchCampaignContent(group.campaignId);
    } catch (error) {
      failedCampaignIds.add(group.campaignId);
      logger.error(
        `Failed to fetch Mailchimp campaign ${group.campaignId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    if (content === null) {
      missingCampaignIds.add(group.campaignId);
      continue;
    }

    const nextSnippet = extractCampaignBodyText(content);

    if (nextSnippet === null || nextSnippet.length === 0) {
      missingCampaignIds.add(group.campaignId);
      continue;
    }

    fetchedCount += 1;

    for (const row of group.rows) {
      const normalizedCurrent = normalizeCampaignBodyText(row.snippet);

      if (normalizedCurrent === nextSnippet) {
        unchangedCount += 1;
        continue;
      }

      wouldUpdateCount += 1;

      if (sampleUpdates.length < sampleLimit) {
        sampleUpdates.push(buildSampleUpdate(row, nextSnippet));
      }

      if (dryRun) {
        continue;
      }

      await input.repositories.mailchimpCampaignActivityDetails.upsert(
        buildUpdatedDetailRecord(row, nextSnippet),
      );
      updatedCount += 1;
    }

    if (
      options.progressInterval !== null &&
      options.progressInterval > 0 &&
      (index + 1) % options.progressInterval === 0
    ) {
      logger.log(
        JSON.stringify({
          backfill: "mailchimp_campaign_body_progress",
          processedCampaigns: index + 1,
          totalCampaigns: campaignGroups.length,
          fetchedCount,
          wouldUpdateCount,
          updatedCount,
          failedCampaignCount: failedCampaignIds.size,
        }),
      );
    }
  }

  const result: BackfillMailchimpCampaignBodyResult = {
    dryRun,
    scannedCount: campaignGroups.reduce(
      (total, group) => total + group.rows.length,
      0,
    ),
    campaignCount: campaignGroups.length,
    fetchedCount,
    wouldUpdateCount,
    updatedCount,
    unchangedCount,
    skippedClickedCount,
    missingCampaignIds: Array.from(missingCampaignIds).sort((left, right) =>
      left.localeCompare(right),
    ),
    failedCampaignIds: Array.from(failedCampaignIds).sort((left, right) =>
      left.localeCompare(right),
    ),
    sampleUpdates,
  };

  logger.log(
    JSON.stringify(
      {
        backfill: "mailchimp_campaign_body",
        ...summarizeResult(result),
      },
      null,
      2,
    ),
  );

  return result;
}

export async function runBackfillMailchimpCampaignBodyCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  },
): Promise<BackfillMailchimpCampaignBodyResult> {
  const flags = parseCliFlags(args);
  const confirm = readOptionalBooleanFlag(flags, "confirm", false);
  const dryRunRequested = readOptionalBooleanFlag(flags, "dry-run", false);
  const limitCampaigns = readOptionalIntegerFlag(flags, "limit", 0);
  const progressInterval = readOptionalNonNegativeIntegerFlag(
    flags,
    "progress-interval",
    defaultProgressInterval,
  );

  if (confirm && dryRunRequested) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }

  const dryRun = dryRunRequested || !confirm;
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const apiConfig = readMailchimpApiConfig(env);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;

  try {
    return await backfillMailchimpCampaignBodies({
      db: connection.db,
      repositories,
      fetchCampaignContent: (campaignId) =>
        fetchMailchimpCampaignContent({
          campaignId,
          fetchImplementation,
          apiConfig,
        }),
      dryRun,
      options: {
        campaignId: readOptionalStringFlag(flags, "campaign-id"),
        limitCampaigns: limitCampaigns === 0 ? null : limitCampaigns,
        progressInterval:
          progressInterval === 0 ? null : progressInterval,
      },
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const result = await runBackfillMailchimpCampaignBodyCommand(
    process.argv.slice(2),
  );

  if (result.failedCampaignIds.length > 0) {
    throw new Error(
      `Mailchimp campaign body backfill completed with ${String(result.failedCampaignIds.length)} failed campaign fetch(es).`,
    );
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "backfill-mailchimp-campaign-body failed.",
    );
    process.exitCode = 1;
  });
}
