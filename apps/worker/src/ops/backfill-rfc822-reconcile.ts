#!/usr/bin/env tsx
/**
 * backfill-rfc822-reconcile
 *
 * Retroactive reconcile pass for pending_composer_outbounds rows that were
 * orphaned by the pre-rfc822 fingerprint-only reconcile path. Finds rows
 * where:
 *   - sentRfc822MessageId IS NOT NULL
 *   - reconciledEventId IS NULL
 *   - status IN ('pending', 'confirmed', 'orphaned')
 *
 * For each, looks up gmail_message_details by rfc822MessageId, finds the
 * matching canonical_event_ledger row, and calls markConfirmed.
 *
 * Usage:
 *   pnpm --filter @as-comms/worker exec tsx src/ops/backfill-rfc822-reconcile.ts [--dry-run]
 */
import process from "node:process";

import { type CanonicalEventRecord } from "@as-comms/contracts";
import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
} from "@as-comms/db";
import type { PendingComposerOutboundRecord } from "@as-comms/domain";

import { parseCliFlags, readOptionalBooleanFlag } from "./helpers.js";

interface BackfillSummary {
  readonly processed: number;
  readonly reconciled: number;
  readonly skipped: number;
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

async function findCanonicalOutboundEvent(input: {
  readonly pending: PendingComposerOutboundRecord;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
}): Promise<CanonicalEventRecord | null> {
  const rfc822MessageId = input.pending.sentRfc822MessageId;

  if (rfc822MessageId === null) {
    return null;
  }

  const gmailDetail =
    await input.repositories.gmailMessageDetails.findByRfc822MessageId(
      rfc822MessageId,
    );

  if (gmailDetail === null) {
    return null;
  }

  return input.repositories.canonicalEvents.findBySourceEvidenceId(
    gmailDetail.sourceEvidenceId,
    "communication.email.outbound",
  );
}

async function backfillRfc822Reconcile(input: {
  readonly dryRun: boolean;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
}): Promise<BackfillSummary> {
  const candidates =
    await input.repositories.pendingOutbounds.listUnreconciledWithRfc822();
  let reconciled = 0;
  let skipped = 0;

  for (const pending of candidates) {
    const canonicalEvent = await findCanonicalOutboundEvent({
      pending,
      repositories: input.repositories,
    });

    if (canonicalEvent === null) {
      skipped += 1;
      console.info(
        `[skip] pending=${pending.id} rfc822=${pending.sentRfc822MessageId ?? "null"} reason=no_match`,
      );
      continue;
    }

    if (input.dryRun) {
      console.info(
        `[dry-run] pending=${pending.id} rfc822=${pending.sentRfc822MessageId ?? "null"} canonicalEvent=${canonicalEvent.id}`,
      );
    } else {
      await input.repositories.pendingOutbounds.markConfirmed(pending.id, {
        reconciledEventId: canonicalEvent.id,
      });
      console.info(
        `[reconciled] pending=${pending.id} rfc822=${pending.sentRfc822MessageId ?? "null"} canonicalEvent=${canonicalEvent.id}`,
      );
    }

    reconciled += 1;
  }

  return {
    processed: candidates.length,
    reconciled,
    skipped,
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = readOptionalBooleanFlag(flags, "dry-run", false);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const summary = await backfillRfc822Reconcile({
      dryRun,
      repositories,
    });

    console.info(
      `Processed ${String(summary.processed)} candidates, reconciled ${String(summary.reconciled)}, skipped ${String(summary.skipped)} (no match).`,
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
