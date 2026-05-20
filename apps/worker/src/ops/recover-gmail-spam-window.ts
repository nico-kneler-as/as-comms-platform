#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
} from "@as-comms/db";
import { createStage1NormalizationService, createStage1PersistenceService, type Stage1RepositoryBundle } from "@as-comms/domain";
import {
  buildGmailListQuery,
  createGmailMailboxApiClient,
  mapLiveGmailMessageToRecord,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
} from "@as-comms/integrations";

import { createStage1IngestService, type Stage1IngestService } from "../ingest/index.js";
import { readStage1LaunchScopeGmailConfig } from "./config.js";
import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readRequiredFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

export interface RecoverGmailSpamWindowLogEntry {
  readonly id: string;
  readonly foundInDb: boolean;
  readonly action: "skipped" | "captured";
  readonly labelIds: readonly string[] | null;
}

export interface RecoverGmailSpamWindowResult {
  readonly dryRun: boolean;
  readonly mailbox: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly query: string;
  readonly checked: number;
  readonly foundInDb: number;
  readonly missing: number;
  readonly skipped: number;
  readonly captured: number;
  readonly notFoundInMailbox: number;
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
    throw new Error(`${key} is required for Gmail spam-window recovery.`);
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

function buildGmailApiClientFromEnv(
  env: NodeJS.ProcessEnv,
): {
  readonly mailbox: string;
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
  readonly client: GmailMailboxApiClient;
} {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "ops-recover-gmail-spam-window",
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
    liveAccount: gmailConfig.liveAccount,
    projectInboxAliases: [...gmailConfig.projectInboxAliases],
    client: createGmailMailboxApiClient(clientConfig),
  };
}

function logEntry(
  logger: Logger,
  entry: RecoverGmailSpamWindowLogEntry,
): void {
  logger.log(JSON.stringify(entry));
}

export async function recoverGmailSpamWindow(input: {
  readonly repositories: Pick<Stage1RepositoryBundle, "sourceEvidence">;
  readonly ingest: Pick<Stage1IngestService, "ingestGmailHistoricalRecord">;
  readonly apiClient: GmailMailboxApiClient;
  readonly mailbox: string;
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly execute: boolean;
  readonly logger?: Logger;
}): Promise<RecoverGmailSpamWindowResult> {
  const logger = input.logger ?? console;
  const query = buildGmailListQuery({
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });

  if (query === null) {
    throw new Error("Window start and end are required for Gmail spam recovery.");
  }

  const messageIds = await input.apiClient.listMessageIds({
    mailbox: input.mailbox,
    query,
  });

  let foundInDb = 0;
  let missing = 0;
  let skipped = 0;
  let captured = 0;
  let notFoundInMailbox = 0;

  for (const id of messageIds) {
    const existingRows = await input.repositories.sourceEvidence.listByProviderRecord({
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: id,
    });

    if (existingRows.length > 0) {
      foundInDb += 1;
      skipped += 1;
      logEntry(logger, {
        id,
        foundInDb: true,
        action: "skipped",
        labelIds: null,
      });
      continue;
    }

    missing += 1;

    const message = await input.apiClient.getMessage({
      mailbox: input.mailbox,
      messageId: id,
    });

    if (message === null) {
      notFoundInMailbox += 1;
      skipped += 1;
      logEntry(logger, {
        id,
        foundInDb: false,
        action: "skipped",
        labelIds: null,
      });
      continue;
    }

    if (!input.execute) {
      skipped += 1;
      logEntry(logger, {
        id,
        foundInDb: false,
        action: "skipped",
        labelIds: message.labelIds,
      });
      continue;
    }

    const record = await mapLiveGmailMessageToRecord({
      message,
      capturedMailbox: input.mailbox,
      liveAccount: input.liveAccount,
      projectInboxAliases: input.projectInboxAliases,
      receivedAt: new Date().toISOString(),
    });

    await input.ingest.ingestGmailHistoricalRecord(record, {
      overwriteDuplicateGmailMessageDetail: false,
    });

    captured += 1;
    logEntry(logger, {
      id,
      foundInDb: false,
      action: "captured",
      labelIds: message.labelIds,
    });
  }

  return {
    dryRun: !input.execute,
    mailbox: input.mailbox,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    query,
    checked: messageIds.length,
    foundInDb,
    missing,
    skipped,
    captured,
    notFoundInMailbox,
  };
}

export async function runRecoverGmailSpamWindowCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const windowStart = parseWindowTimestamp(
    readRequiredFlag(flags, "window-start"),
    "window-start",
  );
  const windowEnd = parseWindowTimestamp(
    readRequiredFlag(flags, "window-end"),
    "window-end",
  );
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const ingest = createStage1IngestService(normalization);
    const gmail = buildGmailApiClientFromEnv(env);
    const result = await recoverGmailSpamWindow({
      repositories,
      ingest,
      apiClient: gmail.client,
      mailbox: gmail.mailbox,
      liveAccount: gmail.liveAccount,
      projectInboxAliases: gmail.projectInboxAliases,
      windowStart,
      windowEnd,
      execute,
      logger,
    });

    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  await runRecoverGmailSpamWindowCommand(process.argv.slice(2), process.env);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Gmail spam-window recovery failed.",
    );
    process.exitCode = 1;
  });
}
