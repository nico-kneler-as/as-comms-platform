#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  messageAttachments,
  type Stage1Database,
} from "@as-comms/db";
import {
  collectGmailAttachmentMetadata,
  collectGmailHtmlCidReferences,
  createGmailMailboxApiClient,
  isInlineAttachment,
  normalizeContentId,
  type GmailAttachmentMetadata,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
  type GmailMessageMetadata,
} from "@as-comms/integrations";
import { and, asc, eq, gte, like, lte } from "drizzle-orm";

import { readStage1LaunchScopeGmailConfig } from "./config.js";
import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface CandidateAttachmentRow {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly gmailAttachmentId: string;
  readonly mimeType: string;
  readonly isInline: boolean;
  readonly partIndexPath: string | null;
}

interface CachedMessageData {
  readonly attachmentMetadata: readonly GmailAttachmentMetadata[];
  readonly htmlBodyCidReferences: ReadonlySet<string>;
}

export interface RecomputeAttachmentInlineLogEntry {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly gmailAttachmentId: string;
  readonly action: "skipped" | "unchanged" | "recomputed";
  readonly reason?:
    | "no_gmail_detail"
    | "gmail_message_not_found"
    | "attachment_not_in_message";
  readonly before?: boolean;
  readonly after?: boolean;
  readonly dryRun?: boolean;
}

export interface RecomputeAttachmentInlineResult {
  readonly dryRun: boolean;
  readonly since: string;
  readonly until: string;
  readonly mailbox: string;
  readonly candidates: number;
  readonly recomputed: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly truncated: boolean;
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
    throw new Error(`${key} is required for attachment inline recompute.`);
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

function buildDefaultSince(): string {
  return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
}

function buildDefaultUntil(): string {
  return new Date().toISOString();
}

function buildGmailApiClientFromEnv(
  env: NodeJS.ProcessEnv,
): {
  readonly mailbox: string;
  readonly client: GmailMailboxApiClient;
} {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "ops-recompute-attachment-inline",
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

  return {
    mailbox: gmailConfig.liveAccount,
    client: createGmailMailboxApiClient(clientConfig),
  };
}

function logEntry(
  logger: Logger,
  entry: RecomputeAttachmentInlineLogEntry,
): void {
  logger.log(JSON.stringify(entry));
}

function parsePartIndexPathFromAttachmentId(
  attachmentId: string,
): string | null {
  const prefix = "att:gmail:";

  if (!attachmentId.startsWith(prefix)) {
    return null;
  }

  const messageIdDelimiterIndex = attachmentId.indexOf(":", prefix.length);

  if (messageIdDelimiterIndex < 0) {
    return null;
  }

  const partIndexPath = attachmentId.slice(messageIdDelimiterIndex + 1).trim();
  return partIndexPath.length > 0 ? partIndexPath : null;
}

async function loadCandidateRows(input: {
  readonly db: Stage1Database;
  readonly since: string;
  readonly until: string;
  readonly limit: number;
}): Promise<{
  readonly candidates: readonly CandidateAttachmentRow[];
  readonly truncated: boolean;
}> {
  const rows = await input.db
    .select({
      id: messageAttachments.id,
      sourceEvidenceId: messageAttachments.sourceEvidenceId,
      gmailAttachmentId: messageAttachments.gmailAttachmentId,
      mimeType: messageAttachments.mimeType,
      isInline: messageAttachments.isInline,
      createdAt: messageAttachments.createdAt,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.isInline, false),
        like(messageAttachments.mimeType, "image/%"),
        gte(messageAttachments.createdAt, new Date(input.since)),
        lte(messageAttachments.createdAt, new Date(input.until)),
      ),
    )
    .orderBy(asc(messageAttachments.createdAt), asc(messageAttachments.id))
    .limit(input.limit + 1);

  return {
    candidates: rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      sourceEvidenceId: row.sourceEvidenceId,
      gmailAttachmentId: row.gmailAttachmentId,
      mimeType: row.mimeType,
      isInline: row.isInline,
      partIndexPath: parsePartIndexPathFromAttachmentId(row.id),
    })),
    truncated: rows.length > input.limit,
  };
}

export async function recomputeAttachmentInline(input: {
  readonly db: Stage1Database;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly apiClient: GmailMailboxApiClient;
  readonly mailbox: string;
  readonly since: string;
  readonly until: string;
  readonly execute: boolean;
  readonly limit: number;
  readonly logger?: Logger;
}): Promise<RecomputeAttachmentInlineResult> {
  const logger = input.logger ?? console;
  const { candidates, truncated } = await loadCandidateRows({
    db: input.db,
    since: input.since,
    until: input.until,
    limit: input.limit,
  });
  const gmailDetails = await input.repositories.gmailMessageDetails.listBySourceEvidenceIds(
    candidates.map((candidate) => candidate.sourceEvidenceId),
  );
  const gmailDetailsBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const messageCache = new Map<string, Promise<CachedMessageData | null>>();

  let recomputed = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const detail = gmailDetailsBySourceEvidenceId.get(candidate.sourceEvidenceId);

    if (detail === undefined) {
      skipped += 1;
      logEntry(logger, {
        id: candidate.id,
        sourceEvidenceId: candidate.sourceEvidenceId,
        gmailAttachmentId: candidate.gmailAttachmentId,
        action: "skipped",
        reason: "no_gmail_detail",
      });
      continue;
    }

    let cachedMessage = messageCache.get(candidate.sourceEvidenceId);

    if (cachedMessage === undefined) {
      cachedMessage = input.apiClient
        .getMessage({
          mailbox: input.mailbox,
          messageId: detail.providerRecordId,
        })
        .then((message: GmailMessageMetadata | null) => {
          if (message === null) {
            return null;
          }

          return {
            attachmentMetadata: collectGmailAttachmentMetadata(message.payload),
            htmlBodyCidReferences: new Set(
              collectGmailHtmlCidReferences(message.payload, {
                messageIdentifier: detail.providerRecordId,
              })
                .map((value) => normalizeContentId(value))
                .filter((value): value is string => value !== null),
            ),
          };
        });
      messageCache.set(candidate.sourceEvidenceId, cachedMessage);
    }

    const messageData = await cachedMessage;

    if (messageData === null) {
      skipped += 1;
      logEntry(logger, {
        id: candidate.id,
        sourceEvidenceId: candidate.sourceEvidenceId,
        gmailAttachmentId: candidate.gmailAttachmentId,
        action: "skipped",
        reason: "gmail_message_not_found",
      });
      continue;
    }

    if (candidate.partIndexPath === null) {
      skipped += 1;
      logEntry(logger, {
        id: candidate.id,
        sourceEvidenceId: candidate.sourceEvidenceId,
        gmailAttachmentId: candidate.gmailAttachmentId,
        action: "skipped",
        reason: "attachment_not_in_message",
      });
      continue;
    }

    const attachment = messageData.attachmentMetadata.find(
      (value) => value.partIndexPath === candidate.partIndexPath,
    );

    if (attachment === undefined) {
      skipped += 1;
      logEntry(logger, {
        id: candidate.id,
        sourceEvidenceId: candidate.sourceEvidenceId,
        gmailAttachmentId: candidate.gmailAttachmentId,
        action: "skipped",
        reason: "attachment_not_in_message",
      });
      continue;
    }

    const nextIsInline = isInlineAttachment({
      attachment,
      htmlBodyCidReferences: messageData.htmlBodyCidReferences,
    });

    if (nextIsInline === candidate.isInline) {
      unchanged += 1;
      logEntry(logger, {
        id: candidate.id,
        sourceEvidenceId: candidate.sourceEvidenceId,
        gmailAttachmentId: candidate.gmailAttachmentId,
        action: "unchanged",
      });
      continue;
    }

    if (input.execute) {
      await input.db
        .update(messageAttachments)
        .set({ isInline: nextIsInline })
        .where(eq(messageAttachments.id, candidate.id));
    }

    recomputed += 1;
    logEntry(logger, {
      id: candidate.id,
      sourceEvidenceId: candidate.sourceEvidenceId,
      gmailAttachmentId: candidate.gmailAttachmentId,
      action: "recomputed",
      before: candidate.isInline,
      after: nextIsInline,
      dryRun: !input.execute,
    });
  }

  return {
    dryRun: !input.execute,
    since: input.since,
    until: input.until,
    mailbox: input.mailbox,
    candidates: candidates.length,
    recomputed,
    unchanged,
    skipped,
    truncated,
  };
}

export async function runRecomputeAttachmentInlineCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const since = parseWindowTimestamp(
    readOptionalStringFlag(flags, "since") ?? buildDefaultSince(),
    "since",
  );
  const until = parseWindowTimestamp(
    readOptionalStringFlag(flags, "until") ?? buildDefaultUntil(),
    "until",
  );
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 1000);

  if (new Date(since).getTime() > new Date(until).getTime()) {
    throw new Error("Flag --since must be earlier than or equal to --until.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const gmail = buildGmailApiClientFromEnv(env);
    const result = await recomputeAttachmentInline({
      db: connection.db,
      repositories,
      apiClient: gmail.client,
      mailbox: gmail.mailbox,
      since,
      until,
      execute,
      limit,
      logger,
    });

    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  await runRecomputeAttachmentInlineCommand(process.argv.slice(2), process.env);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Attachment inline recompute failed.",
    );
    process.exitCode = 1;
  });
}
