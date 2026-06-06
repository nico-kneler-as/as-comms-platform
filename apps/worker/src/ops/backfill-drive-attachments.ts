#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  type MessageAttachmentInsert,
  type Stage1RepositoryBundle,
} from "@as-comms/domain";
import {
  buildGmailMessageDriveAttachmentId,
  collectGmailDriveAttachments,
  createGmailMailboxApiClient,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
} from "@as-comms/integrations";

import { readStage1LaunchScopeGmailConfig } from "./config.js";
import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalStringFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface DriveAttachmentCandidateRow {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly capturedMailbox: string;
}

export interface BackfillDriveAttachmentsLogEntry {
  readonly providerRecordId: string;
  readonly sourceEvidenceId: string;
  readonly capturedMailbox: string;
  readonly outcome:
    | "not-found-in-mailbox"
    | "fetch-failed"
    | "no-drive-attachments"
    | "would-insert"
    | "inserted"
    | "skipped-existing";
  readonly driveAttachmentCount: number;
  readonly errorMessage?: string;
}

export interface BackfillDriveAttachmentsResult {
  readonly dryRun: boolean;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly candidatesScanned: number;
  readonly driveAttachmentsInserted: number;
  readonly messagesWithoutDriveAnchors: number;
  readonly messagesNotFoundInMailbox: number;
  readonly fetchFailures: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands.",
    );
  }

  return connectionString;
}

function readRequiredStringEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required for Drive attachment backfill.`);
  }

  return value.trim();
}

function parseWindowTimestamp(value: string, flagName: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Flag --${flagName} must be a valid ISO-8601 timestamp.`);
  }

  return parsed.toISOString();
}

function parseNonNegativeIntegerFlag(
  value: string | null,
  flagName: string,
  defaultValue: number,
): number {
  if (value === null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Flag --${flagName} must be a non-negative integer.`);
  }

  return parsed;
}

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

function buildDefaultWindowStart(now: Date): string {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

function buildGmailApiClientFromEnv(env: NodeJS.ProcessEnv): GmailMailboxApiClient {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "ops-backfill-drive-attachments",
    liveAccount: gmailConfig.liveAccount,
    projectInboxAliases: [...gmailConfig.projectInboxAliases],
    oauthClientId: readRequiredStringEnv(env, "GMAIL_GOOGLE_OAUTH_CLIENT_ID"),
    oauthClientSecret: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_CLIENT_SECRET",
    ),
    oauthRefreshToken: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN",
    ),
    tokenUri:
      env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
    timeoutMs:
      env.GMAIL_CAPTURE_TIMEOUT_MS === undefined
        ? 15_000
        : Number.parseInt(env.GMAIL_CAPTURE_TIMEOUT_MS, 10),
  };

  return createGmailMailboxApiClient(clientConfig);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logEntry(
  logger: Logger,
  entry: BackfillDriveAttachmentsLogEntry,
): void {
  logger.log(JSON.stringify(entry));
}

export async function loadDriveAttachmentBackfillCandidates(input: {
  readonly db: Stage1Database;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly mailbox: string | null;
}): Promise<readonly DriveAttachmentCandidateRow[]> {
  const result = await input.db.execute(sql<DriveAttachmentCandidateRow>`
    SELECT
      gmd.source_evidence_id AS "sourceEvidenceId",
      gmd.provider_record_id AS "providerRecordId",
      gmd.captured_mailbox AS "capturedMailbox"
    FROM gmail_message_details gmd
    LEFT JOIN message_attachments ma
      ON ma.source_evidence_id = gmd.source_evidence_id
    WHERE gmd.body_text_preview ~ E'\\\\[image:\\\\s'
      AND ma.id IS NULL
      AND gmd.captured_mailbox IS NOT NULL
      AND (${input.windowStart}::timestamptz IS NULL OR gmd.created_at >= ${input.windowStart}::timestamptz)
      AND (${input.windowEnd}::timestamptz IS NULL OR gmd.created_at < ${input.windowEnd}::timestamptz)
      AND (${input.mailbox}::text IS NULL OR gmd.captured_mailbox = ${input.mailbox}::text)
    GROUP BY gmd.source_evidence_id, gmd.provider_record_id, gmd.captured_mailbox
    ORDER BY gmd.created_at ASC
  `);

  return normalizeSqlResultRows(
    result as
      | readonly DriveAttachmentCandidateRow[]
      | {
          readonly rows?: readonly DriveAttachmentCandidateRow[];
        },
  );
}

export async function backfillDriveAttachments(input: {
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    "messageAttachments" | "sourceEvidence"
  >;
  readonly db: Stage1Database;
  readonly apiClient: GmailMailboxApiClient;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly mailbox?: string | null;
  readonly execute: boolean;
  readonly rateLimitMs?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}): Promise<BackfillDriveAttachmentsResult> {
  const logger = input.logger ?? console;
  const rateLimitMs = input.rateLimitMs ?? 1000;
  const candidates = await loadDriveAttachmentBackfillCandidates({
    db: input.db,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    mailbox: input.mailbox ?? null,
  });

  let driveAttachmentsInserted = 0;
  let messagesWithoutDriveAnchors = 0;
  let messagesNotFoundInMailbox = 0;
  let fetchFailures = 0;
  let isFirstCandidate = true;

  for (const candidate of candidates) {
    if (!isFirstCandidate && rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
    isFirstCandidate = false;

    let message: Awaited<ReturnType<GmailMailboxApiClient["getMessage"]>>;
    try {
      message = await input.apiClient.getMessage({
        mailbox: candidate.capturedMailbox,
        messageId: candidate.providerRecordId,
      });
    } catch (error) {
      fetchFailures += 1;
      logEntry(logger, {
        providerRecordId: candidate.providerRecordId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        capturedMailbox: candidate.capturedMailbox,
        outcome: "fetch-failed",
        driveAttachmentCount: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (message === null) {
      messagesNotFoundInMailbox += 1;
      logEntry(logger, {
        providerRecordId: candidate.providerRecordId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        capturedMailbox: candidate.capturedMailbox,
        outcome: "not-found-in-mailbox",
        driveAttachmentCount: 0,
      });
      continue;
    }

    const driveAttachments = collectGmailDriveAttachments(message.payload, {
      messageIdentifier: candidate.providerRecordId,
    });

    if (driveAttachments.length === 0) {
      messagesWithoutDriveAnchors += 1;
      logEntry(logger, {
        providerRecordId: candidate.providerRecordId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        capturedMailbox: candidate.capturedMailbox,
        outcome: "no-drive-attachments",
        driveAttachmentCount: 0,
      });
      continue;
    }

    const existingAttachments =
      await input.repositories.messageAttachments.findByMessageIds([
        candidate.sourceEvidenceId,
      ]);
    const existingIds = new Set(existingAttachments.map((attachment) => attachment.id));
    const rowsToInsert: MessageAttachmentInsert[] = [];

    for (const driveAttachment of driveAttachments) {
      const attachmentId = buildGmailMessageDriveAttachmentId({
        messageId: candidate.providerRecordId,
        driveFileId: driveAttachment.driveFileId,
      });

      if (existingIds.has(attachmentId)) {
        continue;
      }

      rowsToInsert.push({
        id: attachmentId,
        provider: "drive",
        gmailAttachmentId: null,
        mimeType: "application/octet-stream",
        filename: driveAttachment.filename,
        sizeBytes: 0,
        storageKey: null,
        externalUrl: driveAttachment.driveUrl,
        isDecoration: false,
      });
    }

    if (rowsToInsert.length === 0) {
      logEntry(logger, {
        providerRecordId: candidate.providerRecordId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        capturedMailbox: candidate.capturedMailbox,
        outcome: "skipped-existing",
        driveAttachmentCount: 0,
      });
      continue;
    }

    if (!input.execute) {
      logEntry(logger, {
        providerRecordId: candidate.providerRecordId,
        sourceEvidenceId: candidate.sourceEvidenceId,
        capturedMailbox: candidate.capturedMailbox,
        outcome: "would-insert",
        driveAttachmentCount: rowsToInsert.length,
      });
      continue;
    }

    await input.repositories.messageAttachments.upsertManyForMessage(
      candidate.sourceEvidenceId,
      rowsToInsert,
    );
    driveAttachmentsInserted += rowsToInsert.length;
    logEntry(logger, {
      providerRecordId: candidate.providerRecordId,
      sourceEvidenceId: candidate.sourceEvidenceId,
      capturedMailbox: candidate.capturedMailbox,
      outcome: "inserted",
      driveAttachmentCount: rowsToInsert.length,
    });
  }

  return {
    dryRun: !input.execute,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    candidatesScanned: candidates.length,
    driveAttachmentsInserted,
    messagesWithoutDriveAnchors,
    messagesNotFoundInMailbox,
    fetchFailures,
  };
}

export async function runBackfillDriveAttachments(input: {
  readonly db: Stage1Database;
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    "messageAttachments" | "sourceEvidence"
  >;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly mailbox?: string | null;
  readonly execute?: boolean;
  readonly rateLimitMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
}): Promise<BackfillDriveAttachmentsResult> {
  const env = input.env ?? process.env;

  return backfillDriveAttachments({
    repositories: input.repositories,
    db: input.db,
    apiClient: buildGmailApiClientFromEnv(env),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    mailbox: input.mailbox ?? null,
    execute: input.execute ?? false,
    ...(input.rateLimitMs === undefined
      ? {}
      : {
          rateLimitMs: input.rateLimitMs,
        }),
    ...(input.logger === undefined ? {} : { logger: input.logger }),
  });
}

export async function runBackfillDriveAttachmentsCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const now = new Date();
  const windowStart = parseWindowTimestamp(
    readOptionalStringFlag(flags, "since") ?? buildDefaultWindowStart(now),
    "since",
  );
  const rawWindowEnd = readOptionalStringFlag(flags, "until");
  const windowEnd =
    rawWindowEnd === null ? null : parseWindowTimestamp(rawWindowEnd, "until");
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const mailbox = readOptionalStringFlag(flags, "mailbox");
  const rateLimitMs = parseNonNegativeIntegerFlag(
    readOptionalStringFlag(flags, "rate-limit-ms"),
    "rate-limit-ms",
    1000,
  );
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const result = await runBackfillDriveAttachments({
      db: connection.db,
      repositories,
      windowStart,
      windowEnd,
      mailbox,
      execute,
      rateLimitMs,
      env,
      logger,
    });

    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runBackfillDriveAttachmentsCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      const resolvedError =
        error instanceof Error ? error : new Error(String(error));

      console.error(
        `[backfill-drive-attachments:fatal] ${resolvedError.message}`,
      );
      console.error(resolvedError.stack ?? "(no stack)");

      const anyError = resolvedError as Error & Record<string, unknown>;
      for (const key of [
        "cause",
        "code",
        "detail",
        "constraint",
        "column",
        "table",
        "schema",
        "severity",
        "position",
        "where",
        "hint",
        "errno",
        "syscall",
      ]) {
        if (anyError[key] !== undefined) {
          console.error(
            `[backfill-drive-attachments:fatal:${key}] ${JSON.stringify(anyError[key])}`,
          );
        }
      }

      process.exitCode = 1;
    },
  );
}
