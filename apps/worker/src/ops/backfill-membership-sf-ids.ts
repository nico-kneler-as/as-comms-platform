#!/usr/bin/env tsx
/**
 * backfill-membership-sf-ids
 *
 * Re-pulls Expedition_Members__c.Id from Salesforce for every contact_membership
 * row that has source = 'salesforce' but salesforce_membership_id IS NULL.
 * Run once after migration 0025 to fill legacy rows.
 *
 * Usage (dry-run by default):
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids --execute
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids --execute --limit=500
 *
 * Required env vars (same as salesforce-capture service):
 *   DATABASE_URL or WORKER_DATABASE_URL
 *   SALESFORCE_LOGIN_URL
 *   SALESFORCE_CLIENT_ID
 *   SALESFORCE_USERNAME
 *   SALESFORCE_JWT_PRIVATE_KEY
 * Optional:
 *   SALESFORCE_JWT_EXPIRATION_SECONDS  (default 180)
 *   SALESFORCE_API_VERSION             (default 61.0)
 */
import process from "node:process";

import { and, eq, isNull, sql } from "drizzle-orm";

import {
  closeDatabaseConnection,
  contactMemberships,
  contacts,
  createDatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  createSalesforceApiClient,
  type SalesforceApiClient,
} from "@as-comms/integrations";

import { parseCliFlags, readOptionalIntegerFlag } from "./helpers.js";

const soqlBatchSize = 200;
const updateChunkSize = 500;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface MembershipCandidate {
  readonly membershipId: string;
  readonly salesforceContactId: string;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
}

interface SalesforceIdMatch {
  readonly membershipId: string;
  readonly salesforceMembershipId: string;
}

export interface BackfillMembershipSfIdsResult {
  readonly dryRun: boolean;
  readonly candidateCount: number;
  readonly matchedCount: number;
  readonly unmatchedCount: number;
  readonly updatedCount: number;
  readonly sample: readonly SalesforceIdMatch[];
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

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }

  return chunks;
}

async function loadCandidates(input: {
  readonly db: Stage1Database;
  readonly limit: number | null;
}): Promise<readonly MembershipCandidate[]> {
  const rows = await input.db
    .select({
      membershipId: contactMemberships.id,
      salesforceContactId: contacts.salesforceContactId,
      projectId: contactMemberships.projectId,
      expeditionId: contactMemberships.expeditionId,
    })
    .from(contactMemberships)
    .innerJoin(contacts, eq(contactMemberships.contactId, contacts.id))
    .where(
      and(
        eq(contactMemberships.source, "salesforce"),
        isNull(contactMemberships.salesforceMembershipId),
      ),
    )
    .orderBy(contactMemberships.id);

  const candidates = rows.filter(
    (row): row is MembershipCandidate & { salesforceContactId: string } =>
      row.salesforceContactId !== null,
  );

  return input.limit === null ? candidates : candidates.slice(0, input.limit);
}

async function fetchSfIds(
  sfClient: SalesforceApiClient,
  contactIds: readonly string[],
): Promise<readonly { Id: string; Contact__c: string; Project__c: string; Expedition__c: string }[]> {
  const quoted = contactIds.map((id) => `'${id}'`).join(",");
  const soql = `SELECT Id, Contact__c, Project__c, Expedition__c FROM Expedition_Members__c WHERE Contact__c IN (${quoted})`;
  const rows = await sfClient.queryAll(soql);

  return rows as {
    Id: string;
    Contact__c: string;
    Project__c: string;
    Expedition__c: string;
  }[];
}

export async function backfillMembershipSfIds(input: {
  readonly db: Stage1Database;
  readonly sfClient: SalesforceApiClient;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly logger?: Logger;
}): Promise<BackfillMembershipSfIdsResult> {
  const dryRun = input.dryRun ?? true;
  const logger = input.logger ?? console;

  const candidates = await loadCandidates({
    db: input.db,
    limit: input.limit ?? null,
  });

  logger.log(`Found ${candidates.length} memberships needing SF ID backfill.`);

  const uniqueContactIds = Array.from(
    new Set(candidates.map((c) => c.salesforceContactId)),
  );

  logger.log(`Querying Salesforce for ${uniqueContactIds.length} contact IDs across ${Math.ceil(uniqueContactIds.length / soqlBatchSize)} batch(es).`);

  const sfRows: {
    Id: string;
    Contact__c: string;
    Project__c: string;
    Expedition__c: string;
  }[] = [];

  for (const batch of chunkValues(uniqueContactIds, soqlBatchSize)) {
    const rows = await fetchSfIds(input.sfClient, batch);
    sfRows.push(...rows);
  }

  logger.log(`Salesforce returned ${sfRows.length} Expedition_Members__c rows.`);

  // Build lookup: (contactId, projectId, expeditionId) → SF record Id
  const sfLookup = new Map<string, string>();
  for (const row of sfRows) {
    const key = `${row.Contact__c}|${row.Project__c ?? ""}|${row.Expedition__c ?? ""}`;
    sfLookup.set(key, row.Id);
  }

  const matches: SalesforceIdMatch[] = [];
  let unmatchedCount = 0;

  for (const candidate of candidates) {
    const key = `${candidate.salesforceContactId}|${candidate.projectId ?? ""}|${candidate.expeditionId ?? ""}`;
    const sfId = sfLookup.get(key);

    if (sfId === undefined) {
      unmatchedCount += 1;
      continue;
    }

    matches.push({ membershipId: candidate.membershipId, salesforceMembershipId: sfId });
  }

  logger.log(
    `Matched: ${matches.length}, Unmatched: ${unmatchedCount}. dryRun=${String(dryRun)}`,
  );

  if (!dryRun && matches.length > 0) {
    for (const chunk of chunkValues(matches, updateChunkSize)) {
      for (const match of chunk) {
        await input.db
          .update(contactMemberships)
          .set({ salesforceMembershipId: match.salesforceMembershipId })
          .where(eq(contactMemberships.id, match.membershipId));
      }
    }
  }

  const result: BackfillMembershipSfIdsResult = {
    dryRun,
    candidateCount: candidates.length,
    matchedCount: matches.length,
    unmatchedCount,
    updatedCount: dryRun ? 0 : matches.length,
    sample: matches.slice(0, 10),
  };

  logger.log(JSON.stringify(result, null, 2));

  return result;
}

export async function runBackfillMembershipSfIdsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  const sfClient = createSalesforceApiClient({
    bearerToken: "ops-backfill-membership-sf-ids",
    loginUrl: readRequiredEnv(env, "SALESFORCE_LOGIN_URL"),
    clientId: readRequiredEnv(env, "SALESFORCE_CLIENT_ID"),
    username: readRequiredEnv(env, "SALESFORCE_USERNAME"),
    jwtPrivateKey: readRequiredEnv(env, "SALESFORCE_JWT_PRIVATE_KEY"),
    jwtExpirationSeconds: env.SALESFORCE_JWT_EXPIRATION_SECONDS !== undefined
      ? Number.parseInt(env.SALESFORCE_JWT_EXPIRATION_SECONDS, 10)
      : 180,
    apiVersion: env.SALESFORCE_API_VERSION ?? "61.0",
    contactCaptureMode: "delta_polling",
    membershipCaptureMode: "delta_polling",
  });

  try {
    await backfillMembershipSfIds({
      db: connection.db,
      sfClient,
      dryRun: !args.includes("--execute"),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null,
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
  void runBackfillMembershipSfIdsCommand(
    process.argv.slice(2),
    process.env,
  ).catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "backfill-membership-sf-ids failed.",
    );
    process.exitCode = 1;
  });
}
