#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import { asc, eq, inArray } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  gmailMessageDetails,
  type Stage1Database
} from "@as-comms/db";
import {
  buildLegacyMboxRecordIdCandidates,
  importGmailMboxRecords,
  type GmailRecord
} from "@as-comms/integrations";

import { readStage1LaunchScopeGmailConfig } from "./config.js";
import {
  parseCliFlags,
  readOptionalIntegerFlag,
  readRequiredFlag
} from "./helpers.js";

interface BackfillLogger {
  info(message: string): void;
}

interface ExistingGmailBodyRow {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly bodyTextPreview: string;
  readonly snippetClean: string;
}

export interface GmailMboxBodyBackfillResult {
  readonly dryRun: boolean;
  readonly mboxPath: string;
  readonly capturedMailbox: string;
  readonly parsedRecords: number;
  readonly matchedExisting: number;
  readonly missingCount: number;
  readonly unchangedCount: number;
  readonly wouldUpdateCount: number;
  readonly updatedCount: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands."
    );
  }

  return connectionString;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function splitMboxRawMessages(mboxText: string): string[] {
  const normalized = normalizeLineEndings(mboxText);
  const lines = normalized.split("\n");
  const messages: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("From ")) {
      if (currentLines.length > 0) {
        messages.push(currentLines.join("\n").trim());
        currentLines = [];
      }

      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    messages.push(currentLines.join("\n").trim());
  }

  return messages.filter((message) => message.length > 0);
}

function isGmailMessageRecord(record: GmailRecord): record is Extract<GmailRecord, {
  readonly recordType: "message";
}> {
  return record.recordType === "message";
}

async function findExistingGmailBodyRow(input: {
  readonly db: Stage1Database;
  readonly providerRecordIds: readonly string[];
}): Promise<ExistingGmailBodyRow | null> {
  const rows = await input.db
    .select({
      sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
      providerRecordId: gmailMessageDetails.providerRecordId,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
      snippetClean: gmailMessageDetails.snippetClean
    })
    .from(gmailMessageDetails)
    .where(inArray(gmailMessageDetails.providerRecordId, [...input.providerRecordIds]))
    .orderBy(asc(gmailMessageDetails.sourceEvidenceId));

  if (rows.length === 0) {
    return null;
  }

  const rowsByRecordId = new Map<string, ExistingGmailBodyRow>();

  for (const row of rows) {
    if (!rowsByRecordId.has(row.providerRecordId)) {
      rowsByRecordId.set(row.providerRecordId, row);
    }
  }

  for (const providerRecordId of input.providerRecordIds) {
    const matchedRow = rowsByRecordId.get(providerRecordId);

    if (matchedRow !== undefined) {
      return matchedRow;
    }
  }

  return rows[0] ?? null;
}

async function updateGmailBodyRow(input: {
  readonly db: Stage1Database;
  readonly sourceEvidenceId: string;
  readonly bodyTextPreview: string;
  readonly snippetClean: string;
}): Promise<void> {
  await input.db
    .update(gmailMessageDetails)
    .set({
      bodyTextPreview: input.bodyTextPreview,
      snippetClean: input.snippetClean,
      updatedAt: new Date()
    })
    .where(eq(gmailMessageDetails.sourceEvidenceId, input.sourceEvidenceId));
}

export async function backfillGmailMboxBodies(input: {
  readonly db: Stage1Database;
  readonly mboxText: string;
  readonly mboxPath: string;
  readonly capturedMailbox: string;
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
  readonly projectInboxAliasOverride?: string | null;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: BackfillLogger;
}): Promise<GmailMboxBodyBackfillResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? {
    info(message: string) {
      console.info(message);
    }
  };
  const parsedRecords = await importGmailMboxRecords({
    mboxText: input.mboxText,
    mboxPath: input.mboxPath,
    capturedMailbox: input.capturedMailbox,
    liveAccount: input.liveAccount,
    projectInboxAliases: [...input.projectInboxAliases],
    projectInboxAliasOverride: input.projectInboxAliasOverride ?? null,
    receivedAt: new Date().toISOString(),
    limit: input.limit ?? null
  });
  const rawMessages = splitMboxRawMessages(input.mboxText);
  const selectedRawMessages =
    input.limit === null || input.limit === undefined
      ? rawMessages
      : rawMessages.slice(0, input.limit);

  let matchedExisting = 0;
  let missingCount = 0;
  let unchangedCount = 0;
  let wouldUpdateCount = 0;
  let updatedCount = 0;

  for (const [index, record] of parsedRecords.entries()) {
    if (!isGmailMessageRecord(record)) {
      continue;
    }

    const rawMessage = selectedRawMessages[index];

    if (rawMessage === undefined) {
      throw new Error(
        `Missing raw mbox message for parsed record ${String(index + 1)}.`
      );
    }

    const providerRecordIds = [
      record.recordId,
      ...buildLegacyMboxRecordIdCandidates({
        rawMessage,
        capturedMailbox: input.capturedMailbox,
        liveAccount: input.liveAccount,
        projectInboxAliases: [...input.projectInboxAliases],
        projectInboxAliasOverride: input.projectInboxAliasOverride ?? null
      })
    ];
    const existing = await findExistingGmailBodyRow({
      db: input.db,
      providerRecordIds
    });

    if (existing === null) {
      missingCount += 1;
      continue;
    }

    matchedExisting += 1;

    if (record.bodyTextPreview.length <= existing.bodyTextPreview.length) {
      unchangedCount += 1;
      continue;
    }

    wouldUpdateCount += 1;

    if (dryRun) {
      logger.info(
        JSON.stringify({
          sourceEvidenceId: existing.sourceEvidenceId,
          oldLen: existing.bodyTextPreview.length,
          newLen: record.bodyTextPreview.length,
          oldFirst60: existing.bodyTextPreview.slice(0, 60),
          newFirst60: record.bodyTextPreview.slice(0, 60)
        })
      );
      continue;
    }

    await updateGmailBodyRow({
      db: input.db,
      sourceEvidenceId: existing.sourceEvidenceId,
      bodyTextPreview: record.bodyTextPreview,
      snippetClean: record.snippetClean
    });
    updatedCount += 1;
  }

  return {
    dryRun,
    mboxPath: input.mboxPath,
    capturedMailbox: input.capturedMailbox,
    parsedRecords: parsedRecords.length,
    matchedExisting,
    missingCount,
    unchangedCount,
    wouldUpdateCount,
    updatedCount
  };
}

export async function runBackfillGmailMboxBodiesCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const flags = parseCliFlags(args);
  const execute = Boolean(flags.execute);
  const explicitDryRun = Boolean(flags["dry-run"]);

  if (execute && explicitDryRun) {
    throw new Error("Flags --execute and --dry-run are mutually exclusive.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env)
  });

  try {
    const gmailConfig = readStage1LaunchScopeGmailConfig(env);
    const mboxPath = readRequiredFlag(flags, "mbox-path");
    const mboxText = await readFile(mboxPath, "utf8");
    const result = await backfillGmailMboxBodies({
      db: connection.db,
      mboxText,
      mboxPath,
      capturedMailbox: readRequiredFlag(flags, "captured-mailbox"),
      liveAccount: gmailConfig.liveAccount,
      projectInboxAliases: [...gmailConfig.projectInboxAliases],
      dryRun: execute ? false : true,
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null
    });

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}
