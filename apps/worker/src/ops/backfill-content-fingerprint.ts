#!/usr/bin/env tsx
import process from "node:process";

import {
  asc,
  eq,
  sql
} from "drizzle-orm";

import {
  canonicalEventSchema
} from "@as-comms/contracts";
import {
  canonicalEventLedger,
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  gmailMessageDetails,
  salesforceCommunicationDetails,
  type Stage1Database
} from "@as-comms/db";
import {
  computeContentFingerprint,
  type ContentFingerprintInput
} from "@as-comms/domain";

import {
  parseCliFlags,
  readOptionalIntegerFlag
} from "./helpers.js";

const updateChunkSize = 500;

interface Logger {
  log(...args: readonly unknown[]): void;
}

interface ContentFingerprintBackfillRow {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly occurredAt: Date;
  readonly contentFingerprint: string | null;
  readonly primaryProvider: string;
  readonly direction: "inbound" | "outbound" | null;
  readonly gmailSubject: string | null;
  readonly gmailBodyTextPreview: string | null;
  readonly gmailSnippetClean: string | null;
  readonly salesforceSubject: string | null;
  readonly salesforceSnippet: string | null;
}

interface ContentFingerprintBackfillCandidate {
  readonly canonicalEventId: string;
  readonly currentContentFingerprint: string | null;
  readonly nextContentFingerprint: string | null;
}

export interface BackfillContentFingerprintResult {
  readonly dryRun: boolean;
  readonly scannedCount: number;
  readonly computedCount: number;
  readonly unchangedCount: number;
  readonly updateCount: number;
  readonly updatedCount: number;
  readonly sample: readonly ContentFingerprintBackfillCandidate[];
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command."
    );
  }

  return connectionString;
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildContentFingerprintInput(
  row: ContentFingerprintBackfillRow
): ContentFingerprintInput | null {
  if (row.primaryProvider === "gmail") {
    return {
      subject: row.gmailSubject,
      occurredAt: row.occurredAt.toISOString(),
      contactId: row.contactId,
      channel: "email",
      direction: row.direction,
      previewText: row.gmailBodyTextPreview ?? row.gmailSnippetClean
    };
  }

  if (row.primaryProvider === "salesforce") {
    return {
      subject: row.salesforceSubject,
      occurredAt: row.occurredAt.toISOString(),
      contactId: row.contactId,
      channel: "email",
      direction: row.direction,
      previewText: row.salesforceSnippet
    };
  }

  return null;
}

async function loadBackfillRows(input: {
  readonly db: Stage1Database;
  readonly limit: number | null;
}): Promise<readonly ContentFingerprintBackfillRow[]> {
  const rows = await input.db
    .select({
      canonicalEventId: canonicalEventLedger.id,
      contactId: canonicalEventLedger.contactId,
      occurredAt: canonicalEventLedger.occurredAt,
      contentFingerprint: canonicalEventLedger.contentFingerprint,
      primaryProvider:
        sql<string>`${canonicalEventLedger.provenance} ->> 'primaryProvider'`,
      direction:
        sql<"inbound" | "outbound" | null>`${canonicalEventLedger.provenance} ->> 'direction'`,
      gmailSubject: gmailMessageDetails.subject,
      gmailBodyTextPreview: gmailMessageDetails.bodyTextPreview,
      gmailSnippetClean: gmailMessageDetails.snippetClean,
      salesforceSubject: salesforceCommunicationDetails.subject,
      salesforceSnippet: salesforceCommunicationDetails.snippet
    })
    .from(canonicalEventLedger)
    .leftJoin(
      gmailMessageDetails,
      eq(gmailMessageDetails.sourceEvidenceId, canonicalEventLedger.sourceEvidenceId)
    )
    .leftJoin(
      salesforceCommunicationDetails,
      eq(
        salesforceCommunicationDetails.sourceEvidenceId,
        canonicalEventLedger.sourceEvidenceId
      )
    )
    .where(eq(canonicalEventLedger.channel, "email"))
    .orderBy(
      asc(canonicalEventLedger.occurredAt),
      asc(canonicalEventLedger.id)
    );

  return input.limit === null ? rows : rows.slice(0, input.limit);
}

export async function backfillContentFingerprint(input: {
  readonly db: Stage1Database;
  readonly repositories?: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: Logger;
}): Promise<BackfillContentFingerprintResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;
  const rows = await loadBackfillRows({
    db: input.db,
    limit: input.limit ?? null
  });
  const candidates: ContentFingerprintBackfillCandidate[] = [];
  let computedCount = 0;
  let unchangedCount = 0;

  for (const row of rows) {
    const fingerprintInput = buildContentFingerprintInput(row);
    const nextContentFingerprint =
      fingerprintInput === null
        ? null
        : computeContentFingerprint(fingerprintInput);

    if (nextContentFingerprint !== null) {
      computedCount += 1;
    }

    if (row.contentFingerprint === nextContentFingerprint) {
      unchangedCount += 1;
      continue;
    }

    candidates.push({
      canonicalEventId: row.canonicalEventId,
      currentContentFingerprint: row.contentFingerprint,
      nextContentFingerprint
    });
  }

  if (!dryRun && candidates.length > 0) {
    if (input.repositories === undefined) {
      throw new Error("repositories are required when --execute is used.");
    }

    const events = await input.repositories.canonicalEvents.listByIds(
      candidates.map((candidate) => candidate.canonicalEventId)
    );
    const eventById = new Map(events.map((event) => [event.id, event] as const));

    for (const chunk of chunkValues(candidates, updateChunkSize)) {
      for (const candidate of chunk) {
        const event = eventById.get(candidate.canonicalEventId);

        if (event === undefined) {
          continue;
        }

        await input.repositories.canonicalEvents.upsert(
          canonicalEventSchema.parse({
            ...event,
            contentFingerprint: candidate.nextContentFingerprint
          })
        );
      }
    }
  }

  logger.log(
    JSON.stringify(
      {
        dryRun,
        scannedCount: rows.length,
        computedCount,
        unchangedCount,
        updateCount: candidates.length,
        updatedCount: dryRun ? 0 : candidates.length,
        sample: candidates.slice(0, 10)
      },
      null,
      2
    )
  );

  return {
    dryRun,
    scannedCount: rows.length,
    computedCount,
    unchangedCount,
    updateCount: candidates.length,
    updatedCount: dryRun ? 0 : candidates.length,
    sample: candidates.slice(0, 10)
  };
}

export async function runBackfillContentFingerprintCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env)
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);

    await backfillContentFingerprint({
      db: connection.db,
      repositories,
      dryRun: !args.includes("--execute"),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const entrypointPath = process.argv[1];

if (
  entrypointPath !== undefined &&
  import.meta.url === `file://${entrypointPath}`
) {
  void runBackfillContentFingerprintCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "backfill-content-fingerprint failed."
      );
      process.exitCode = 1;
    }
  );
}
