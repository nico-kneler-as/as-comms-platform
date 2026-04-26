#!/usr/bin/env tsx
/**
 * backfill-membership-sf-ids
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:backfill-membership-sf-ids -- --dry-run
 *   pnpm --filter @as-comms/worker ops:backfill-membership-sf-ids -- --execute
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids --dry-run
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids --execute
 *
 * Dry-run by default. Re-fetches Salesforce Expedition_Members__c ids for
 * existing canonical contact memberships and updates
 * contact_memberships.salesforce_membership_id when an unambiguous match exists.
 */
import process from "node:process";

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
  closeDatabaseConnection,
  contactMemberships,
  contacts,
  createDatabaseConnection,
} from "@as-comms/db";
import {
  createSalesforceApiClient,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";

const candidateChunkSize = 200;
const sampleLimit = 10;

interface MembershipCandidate {
  readonly membershipId: string;
  readonly salesforceContactId: string;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
  readonly role: string | null;
}

interface SalesforceMembershipRow {
  readonly id: string;
  readonly salesforceContactId: string;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
  readonly role: string | null;
  // Tie-breaker for ambiguous matches: when multiple Expedition_Members__c
  // records share the same (contact, project, expedition, role) key, the
  // newest LastModifiedDate wins. Format is the SF-native ISO 8601 string.
  readonly lastModifiedDate: string | null;
}

interface MembershipUpdate {
  readonly membershipId: string;
  readonly salesforceMembershipId: string;
}

interface BackfillPlan {
  readonly candidateCount: number;
  readonly matchedCount: number;
  readonly missingCount: number;
  readonly ambiguousCount: number;
  readonly updates: readonly MembershipUpdate[];
  readonly missingMembershipIds: readonly string[];
  readonly ambiguousMembershipIds: readonly string[];
}

function readRowStringField(
  row: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = row[fieldName];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for this ops command.`);
  }

  return value;
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: string,
): string {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? defaultValue : value;
}

function readOptionalNullableStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? null : value;
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

function readSalesforceCaptureConfig(
  env: NodeJS.ProcessEnv,
): SalesforceCaptureServiceConfig {
  return {
    bearerToken: readRequiredEnv(env, "SALESFORCE_CAPTURE_TOKEN"),
    loginUrl: readRequiredEnv(env, "SALESFORCE_LOGIN_URL"),
    clientId: readRequiredEnv(env, "SALESFORCE_CLIENT_ID"),
    username: readRequiredEnv(env, "SALESFORCE_USERNAME"),
    jwtPrivateKey: readRequiredEnv(env, "SALESFORCE_JWT_PRIVATE_KEY"),
    jwtExpirationSeconds: readOptionalPositiveIntegerEnv(
      env,
      "SALESFORCE_JWT_EXPIRATION_SECONDS",
      180,
    ),
    apiVersion: readOptionalStringEnv(env, "SALESFORCE_API_VERSION", "61.0"),
    contactCaptureMode: readOptionalStringEnv(
      env,
      "SALESFORCE_CONTACT_CAPTURE_MODE",
      "delta_polling",
    ) as "delta_polling" | "cdc_compatible",
    membershipCaptureMode: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_CAPTURE_MODE",
      "delta_polling",
    ) as "delta_polling" | "cdc_compatible",
    membershipObjectName: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_OBJECT",
      "Expedition_Members__c",
    ),
    membershipContactField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_CONTACT_FIELD",
      "Contact__c",
    ),
    membershipProjectField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_PROJECT_FIELD",
      "Project__c",
    ),
    membershipProjectNameField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_PROJECT_NAME_FIELD",
      "Project__r.Name",
    ),
    membershipExpeditionField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_FIELD",
      "Expedition__c",
    ),
    membershipExpeditionNameField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_NAME_FIELD",
      "Expedition__r.Name",
    ),
    membershipRoleField: readOptionalNullableStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_ROLE_FIELD",
    ),
    membershipStatusField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_STATUS_FIELD",
      "Status__c",
    ),
    taskContactField: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_CONTACT_FIELD",
      "WhoId",
    ),
    taskChannelField: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_CHANNEL_FIELD",
      "TaskSubtype",
    ),
    taskEmailChannelValues: ["Email"],
    taskSmsChannelValues: ["SMS", "Text"],
    taskSnippetField: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_SNIPPET_FIELD",
      "Description",
    ),
    taskOccurredAtField: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_OCCURRED_AT_FIELD",
      "CreatedDate",
    ),
    taskCrossProviderKeyField: readOptionalNullableStringEnv(
      env,
      "SALESFORCE_TASK_CROSS_PROVIDER_KEY_FIELD",
    ),
    timeoutMs: readOptionalPositiveIntegerEnv(
      env,
      "SALESFORCE_CAPTURE_TIMEOUT_MS",
      15_000,
    ),
  };
}

function quoteSoqlLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function buildInClause(values: readonly string[]): string {
  return `(${values.map(quoteSoqlLiteral).join(", ")})`;
}

function normalizeKeyPart(value: string | null): string {
  return value === null ? "" : value.trim().toLowerCase();
}

function buildMembershipMatchKey(input: {
  readonly salesforceContactId: string;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
  readonly role: string | null;
}): string {
  return [
    input.salesforceContactId,
    input.projectId ?? "",
    input.expeditionId ?? "",
    normalizeKeyPart(input.role),
  ].join("::");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function loadCandidates(input: {
  readonly connectionString: string;
  readonly limit: number;
}): Promise<readonly MembershipCandidate[]> {
  const connection = createDatabaseConnection({
    connectionString: input.connectionString,
  });

  try {
    const rows = await connection.db
      .select({
        membershipId: contactMemberships.id,
        salesforceContactId: contacts.salesforceContactId,
        projectId: contactMemberships.projectId,
        expeditionId: contactMemberships.expeditionId,
        role: contactMemberships.role,
      })
      .from(contactMemberships)
      .innerJoin(contacts, eq(contactMemberships.contactId, contacts.id))
      .where(
        and(
          isNull(contactMemberships.salesforceMembershipId),
          isNotNull(contacts.salesforceContactId),
        ),
      )
      .limit(input.limit)
      .orderBy(contactMemberships.id);

    return rows.flatMap((row) =>
      row.salesforceContactId === null
        ? []
        : [
            {
              membershipId: row.membershipId,
              salesforceContactId: row.salesforceContactId,
              projectId: row.projectId,
              expeditionId: row.expeditionId,
              role: row.role,
            },
          ],
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

function pickNewestMembershipMatch(
  matches: readonly SalesforceMembershipRow[],
): SalesforceMembershipRow | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;

  let best: SalesforceMembershipRow | null = null;
  let bestTimestamp = Number.NEGATIVE_INFINITY;

  for (const candidate of matches) {
    const timestamp = candidate.lastModifiedDate
      ? Date.parse(candidate.lastModifiedDate)
      : Number.NaN;

    if (Number.isFinite(timestamp) && timestamp > bestTimestamp) {
      best = candidate;
      bestTimestamp = timestamp;
    }
  }

  // Final fallback: if every candidate has a missing/unparseable
  // LastModifiedDate, pick the lexicographically smallest id so the choice is
  // at least deterministic across runs.
  if (best === null) {
    const sortedById = [...matches].sort((a, b) => a.id.localeCompare(b.id));
    return sortedById[0] ?? null;
  }

  return best;
}

async function loadSalesforceMembershipRows(input: {
  readonly candidates: readonly MembershipCandidate[];
  readonly env: NodeJS.ProcessEnv;
}): Promise<readonly SalesforceMembershipRow[]> {
  const config = readSalesforceCaptureConfig(input.env);
  const apiClient = createSalesforceApiClient(config);
  const rows: SalesforceMembershipRow[] = [];
  const membershipObjectName =
    config.membershipObjectName ?? "Expedition_Members__c";
  const membershipContactField = config.membershipContactField ?? "Contact__c";
  const membershipProjectField = config.membershipProjectField ?? "Project__c";
  const membershipExpeditionField =
    config.membershipExpeditionField ?? "Expedition__c";
  const membershipRoleField = config.membershipRoleField ?? null;
  const contactIds = uniqueSortedStrings(
    input.candidates.map((candidate) => candidate.salesforceContactId),
  );
  const membershipFields: string[] = ["Id", "LastModifiedDate"];
  membershipFields.push(membershipContactField);
  membershipFields.push(membershipProjectField);
  membershipFields.push(membershipExpeditionField);
  if (membershipRoleField !== null) {
    membershipFields.push(membershipRoleField);
  }

  for (const chunk of chunkValues(contactIds, candidateChunkSize)) {
    const soql = `SELECT ${membershipFields.join(", ")} FROM ${membershipObjectName} WHERE ${membershipContactField} IN ${buildInClause(
      chunk,
    )}`;
    const result = await apiClient.queryAll(soql);

    for (const row of result) {
      const salesforceMembershipId = readRowStringField(row, "Id");
      const salesforceContactId = readRowStringField(
        row,
        membershipContactField,
      );

      if (salesforceMembershipId === null || salesforceContactId === null) {
        continue;
      }

      rows.push({
        id: salesforceMembershipId,
        salesforceContactId,
        projectId: readRowStringField(row, membershipProjectField),
        expeditionId: readRowStringField(row, membershipExpeditionField),
        role:
          membershipRoleField !== null &&
          readRowStringField(row, membershipRoleField) !== null
            ? readRowStringField(row, membershipRoleField)
            : null,
        lastModifiedDate: readRowStringField(row, "LastModifiedDate"),
      });
    }
  }

  return rows;
}

export function planMembershipSalesforceIdBackfill(input: {
  readonly candidates: readonly MembershipCandidate[];
  readonly salesforceRows: readonly SalesforceMembershipRow[];
}): BackfillPlan {
  const salesforceRowsByKey = new Map<string, SalesforceMembershipRow[]>();

  for (const row of input.salesforceRows) {
    const key = buildMembershipMatchKey(row);
    const existing = salesforceRowsByKey.get(key);

    if (existing === undefined) {
      salesforceRowsByKey.set(key, [row]);
      continue;
    }

    existing.push(row);
  }

  const updates: MembershipUpdate[] = [];
  const missingMembershipIds: string[] = [];
  const ambiguousMembershipIds: string[] = [];

  for (const candidate of input.candidates) {
    const key = buildMembershipMatchKey(candidate);
    const matches = salesforceRowsByKey.get(key) ?? [];

    if (matches.length === 0) {
      missingMembershipIds.push(candidate.membershipId);
      continue;
    }

    // When multiple Expedition_Members__c records share the same
    // (contact, project, expedition, role) key, default to the one with the
    // most recent LastModifiedDate. This handles the long tail of historical
    // duplicates that SF accumulates (re-applications, role changes, etc.) —
    // the newest record is almost always the operative one. Records with no
    // LastModifiedDate (defensive: should never happen given the SOQL select)
    // sort to the bottom.
    const winner = pickNewestMembershipMatch(matches);
    if (winner === null) {
      // Pathological: matches array is non-empty but pickNewestMembershipMatch
      // couldn't return one. Treat as ambiguous to keep the operator informed.
      ambiguousMembershipIds.push(candidate.membershipId);
      continue;
    }

    updates.push({
      membershipId: candidate.membershipId,
      salesforceMembershipId: winner.id,
    });
  }

  return {
    candidateCount: input.candidates.length,
    matchedCount: updates.length,
    missingCount: missingMembershipIds.length,
    ambiguousCount: ambiguousMembershipIds.length,
    updates,
    missingMembershipIds: uniqueSortedStrings(missingMembershipIds),
    ambiguousMembershipIds: uniqueSortedStrings(ambiguousMembershipIds),
  };
}

function printPlan(plan: BackfillPlan, dryRun: boolean): void {
  console.log("backfill-membership-sf-ids");
  console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  console.log(`- candidate memberships: ${String(plan.candidateCount)}`);
  console.log(`- matched memberships: ${String(plan.matchedCount)}`);
  console.log(`- missing memberships: ${String(plan.missingCount)}`);
  console.log(`- ambiguous memberships: ${String(plan.ambiguousCount)}`);

  if (plan.updates.length > 0) {
    console.log(`Sample updates (first ${String(sampleLimit)}):`);
    for (const update of plan.updates.slice(0, sampleLimit)) {
      console.log(
        `- ${JSON.stringify({
          membershipId: update.membershipId,
          salesforceMembershipId: update.salesforceMembershipId,
          operation: dryRun ? "would_update" : "updated",
        })}`,
      );
    }
  }

  if (plan.missingMembershipIds.length > 0) {
    console.log("Missing membership ids (first 10):");
    for (const membershipId of plan.missingMembershipIds.slice(0, 10)) {
      console.log(`- ${membershipId}`);
    }
  }

  if (plan.ambiguousMembershipIds.length > 0) {
    console.log("Ambiguous membership ids (first 10):");
    for (const membershipId of plan.ambiguousMembershipIds.slice(0, 10)) {
      console.log(`- ${membershipId}`);
    }
  }
}

async function applyUpdates(input: {
  readonly connectionString: string;
  readonly updates: readonly MembershipUpdate[];
}): Promise<void> {
  const connection = createDatabaseConnection({
    connectionString: input.connectionString,
  });

  try {
    for (const update of input.updates) {
      await connection.db
        .update(contactMemberships)
        .set({
          salesforceMembershipId: update.salesforceMembershipId,
          updatedAt: new Date(),
        })
        .where(eq(contactMemberships.id, update.membershipId));
    }
  } finally {
    await closeDatabaseConnection(connection);
  }
}

export async function runBackfillMembershipSfIds(input: {
  readonly connectionString: string;
  readonly env: NodeJS.ProcessEnv;
  readonly dryRun: boolean;
  readonly limit: number;
}): Promise<BackfillPlan & { readonly dryRun: boolean }> {
  const candidates = await loadCandidates({
    connectionString: input.connectionString,
    limit: input.limit,
  });

  if (candidates.length === 0) {
    const emptyPlan: BackfillPlan = {
      candidateCount: 0,
      matchedCount: 0,
      missingCount: 0,
      ambiguousCount: 0,
      updates: [],
      missingMembershipIds: [],
      ambiguousMembershipIds: [],
    };

    printPlan(emptyPlan, input.dryRun);
    return {
      dryRun: input.dryRun,
      ...emptyPlan,
    };
  }

  const salesforceRows = await loadSalesforceMembershipRows({
    candidates,
    env: input.env,
  });
  const plan = planMembershipSalesforceIdBackfill({
    candidates,
    salesforceRows,
  });

  printPlan(plan, input.dryRun);

  if (input.dryRun) {
    console.log(
      "Dry run complete. Re-run with --execute to persist these membership id updates.",
    );
    return {
      dryRun: true,
      ...plan,
    };
  }

  if (plan.updates.length === 0) {
    console.log("No membership Salesforce ids needed updates.");
    return {
      dryRun: false,
      ...plan,
    };
  }

  await applyUpdates({
    connectionString: input.connectionString,
    updates: plan.updates,
  });

  console.log("Membership Salesforce id backfill complete.");
  console.log(`- updated memberships: ${String(plan.matchedCount)}`);

  return {
    dryRun: false,
    ...plan,
  };
}

export async function runBackfillMembershipSfIdsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRunRequested = readOptionalBooleanFlag(flags, "dry-run", false);
  const executeRequested = readOptionalBooleanFlag(flags, "execute", false);

  if (dryRunRequested && executeRequested) {
    throw new Error("Use either --dry-run or --execute, not both.");
  }

  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error("DATABASE_URL or WORKER_DATABASE_URL is required.");
  }

  await runBackfillMembershipSfIds({
    connectionString,
    env,
    dryRun: !executeRequested,
    // Postgres int4 max is 2_147_483_647. Number.MAX_SAFE_INTEGER (2^53-1)
    // overflows the limit parameter on the wire, so use a large-but-int4-safe
    // default. The fleet has ~10k memberships at most, so 1B is effectively
    // "no limit".
    limit: readOptionalIntegerFlag(flags, "limit", 1_000_000_000),
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void runBackfillMembershipSfIdsCommand(process.argv.slice(2), process.env).catch(
    (error: unknown) => {
      if (error instanceof Error) {
        console.error("backfill-membership-sf-ids failed:", error.message);
        if (error.stack) console.error(error.stack);
        if ("cause" in error && error.cause) console.error("cause:", error.cause);
      } else {
        console.error("backfill-membership-sf-ids failed:", error);
      }
      process.exitCode = 1;
    },
  );
}
