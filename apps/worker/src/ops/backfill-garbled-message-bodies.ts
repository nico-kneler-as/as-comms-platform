#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  gmailMessageDetails,
  type Stage1Database,
} from "@as-comms/db";
import { isLikelyBinaryNoise } from "@as-comms/integrations";

import { parseCliFlags, readOptionalIntegerFlag } from "./helpers.js";

const BINARY_FALLBACK_PLACEHOLDER =
  "[Message body could not be extracted — open in Gmail]";
const DEFAULT_BATCH_SIZE = 200;
const BINARY_NOISE_MIN_LENGTH = 32;
const REPLACEMENT_CHARACTER = "�";

interface BackfillLogger {
  info(message: string): void;
}

interface GarbledMessageBodyCandidateRow {
  readonly sourceEvidenceId: string;
  readonly bodyTextPreview: string;
}

export interface GarbledMessageBodiesBackfillResult {
  readonly dryRun: boolean;
  readonly limit: number | null;
  readonly scanned: number;
  readonly garbled: number;
  readonly dryRunWouldUpdate: number;
  readonly updated: number;
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

function calculateReplacementRatio(text: string): number {
  if (text.length < BINARY_NOISE_MIN_LENGTH) {
    return 0;
  }

  let suspicious = 0;
  let total = 0;

  for (const ch of text) {
    total += 1;

    if (ch === REPLACEMENT_CHARACTER) {
      suspicious += 1;
      continue;
    }

    const code = ch.codePointAt(0) ?? 0;

    if (
      code < 0x20 &&
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d
    ) {
      suspicious += 1;
    }
  }

  return total === 0 ? 0 : suspicious / total;
}

async function loadCandidateBatch(input: {
  readonly db: Stage1Database;
  readonly afterSourceEvidenceId: string | null;
  readonly batchSize: number;
}): Promise<readonly GarbledMessageBodyCandidateRow[]> {
  return input.db
    .select({
      sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
    })
    .from(gmailMessageDetails)
    .where(
      and(
        isNull(gmailMessageDetails.bodyKind),
        sql<boolean>`length(${gmailMessageDetails.bodyTextPreview}) >= ${BINARY_NOISE_MIN_LENGTH}`,
        input.afterSourceEvidenceId === null
          ? undefined
          : gt(gmailMessageDetails.sourceEvidenceId, input.afterSourceEvidenceId),
      ),
    )
    .orderBy(asc(gmailMessageDetails.sourceEvidenceId))
    .limit(input.batchSize);
}

async function updateGarbledBodyRow(input: {
  readonly db: Stage1Database;
  readonly sourceEvidenceId: string;
}): Promise<void> {
  await input.db
    .update(gmailMessageDetails)
    .set({
      bodyTextPreview: BINARY_FALLBACK_PLACEHOLDER,
      snippetClean: BINARY_FALLBACK_PLACEHOLDER,
      bodyKind: "binary_fallback",
      updatedAt: new Date(),
    })
    .where(eq(gmailMessageDetails.sourceEvidenceId, input.sourceEvidenceId));
}

export async function backfillGarbledMessageBodies(input: {
  readonly db: Stage1Database;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: BackfillLogger;
}): Promise<GarbledMessageBodiesBackfillResult> {
  const dryRun = input.dryRun ?? true;
  const limit = input.limit ?? null;
  const logger = input.logger ?? {
    info(message: string) {
      console.info(message);
    },
  };

  let remaining = limit;
  let afterSourceEvidenceId: string | null = null;
  let scanned = 0;
  let garbled = 0;
  let dryRunWouldUpdate = 0;
  let updated = 0;

  for (;;) {
    const batchSize =
      remaining === null
        ? DEFAULT_BATCH_SIZE
        : Math.min(DEFAULT_BATCH_SIZE, remaining);

    if (batchSize <= 0) {
      break;
    }

    const candidates = await loadCandidateBatch({
      db: input.db,
      afterSourceEvidenceId,
      batchSize,
    });

    if (candidates.length === 0) {
      break;
    }

    afterSourceEvidenceId =
      candidates.at(-1)?.sourceEvidenceId ?? afterSourceEvidenceId;
    scanned += candidates.length;
    remaining = remaining === null ? null : remaining - candidates.length;

    for (const candidate of candidates) {
      if (!isLikelyBinaryNoise(candidate.bodyTextPreview)) {
        continue;
      }

      garbled += 1;
      const replacementRatio = calculateReplacementRatio(
        candidate.bodyTextPreview,
      );

      if (dryRun) {
        dryRunWouldUpdate += 1;
        logger.info(
          JSON.stringify({
            source_evidence_id: candidate.sourceEvidenceId,
            body_len: candidate.bodyTextPreview.length,
            replacement_ratio: Number(replacementRatio.toFixed(4)),
            sample: candidate.bodyTextPreview.slice(0, 80),
          }),
        );
        continue;
      }

      await updateGarbledBodyRow({
        db: input.db,
        sourceEvidenceId: candidate.sourceEvidenceId,
      });
      updated += 1;
    }
  }

  return {
    dryRun,
    limit,
    scanned,
    garbled,
    dryRunWouldUpdate,
    updated,
  };
}

export async function runBackfillGarbledMessageBodiesCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const execute = Boolean(flags.execute);
  const explicitDryRun = Boolean(flags["dry-run"]);

  if (execute && explicitDryRun) {
    throw new Error("Flags --execute and --dry-run are mutually exclusive.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const result = await backfillGarbledMessageBodies({
      db: connection.db,
      dryRun: !execute,
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null,
    });

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runBackfillGarbledMessageBodiesCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "backfill-garbled-message-bodies failed.",
      );
      process.exitCode = 1;
    },
  );
}
