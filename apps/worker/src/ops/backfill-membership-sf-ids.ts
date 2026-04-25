#!/usr/bin/env tsx
/**
 * backfill-membership-sf-ids
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids --dry-run
 *   pnpm --filter @as-comms/worker ops backfill-membership-sf-ids
 *
 * Re-pulls Expedition_Members__c Salesforce record Ids for legacy
 * contact_memberships rows where salesforce_membership_id is still null.
 */
import process from "node:process"

import { and, eq, isNull } from "drizzle-orm"

import {
  closeDatabaseConnection,
  contactMemberships,
  contacts,
  createDatabaseConnection,
  type DatabaseConnection,
} from "@as-comms/db"
import {
  buildContactMembershipId,
  createSalesforceApiClient,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations"

import { parseCliFlags, readOptionalBooleanFlag } from "./helpers.js"

const membershipBatchSize = 200

interface Logger {
  log(...args: readonly unknown[]): void
  error(...args: readonly unknown[]): void
}

interface MembershipBackfillCandidate {
  readonly membershipId: string
  readonly contactId: string
  readonly salesforceContactId: string
  readonly projectId: string | null
  readonly expeditionId: string | null
  readonly role: string | null
}

interface SalesforceMembershipMatch {
  readonly membershipId: string
  readonly salesforceMembershipId: string
}

interface BackfillMembershipSfIdsResult {
  readonly dryRun: boolean
  readonly candidateCount: number
  readonly matchedCount: number
  readonly updatedCount: number
  readonly unmatchedCount: number
  readonly ambiguousCount: number
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }

  return chunks
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command.",
    )
  }

  return connectionString
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for this ops command.`)
  }

  return value
}

function readOptionalPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined {
  const rawValue = env[key]?.trim()

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined
  }

  const parsed = Number.parseInt(rawValue, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`)
  }

  return parsed
}

function readSalesforceConfig(
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
    ),
    apiVersion: env.SALESFORCE_API_VERSION?.trim(),
    contactCaptureMode: readRequiredEnv(env, "SALESFORCE_CONTACT_CAPTURE_MODE") as "delta_polling" | "cdc_compatible",
    membershipCaptureMode: readRequiredEnv(
      env,
      "SALESFORCE_MEMBERSHIP_CAPTURE_MODE",
    ) as "delta_polling" | "cdc_compatible",
    membershipObjectName:
      env.SALESFORCE_EXPEDITION_MEMBER_OBJECT?.trim() ?? undefined,
    membershipContactField:
      env.SALESFORCE_EXPEDITION_MEMBER_CONTACT_FIELD?.trim() ?? undefined,
    membershipProjectField:
      env.SALESFORCE_EXPEDITION_MEMBER_PROJECT_FIELD?.trim() ?? undefined,
    membershipExpeditionField:
      env.SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_FIELD?.trim() ?? undefined,
    membershipRoleField:
      env.SALESFORCE_EXPEDITION_MEMBER_ROLE_FIELD?.trim() ?? undefined,
    membershipStatusField:
      env.SALESFORCE_EXPEDITION_MEMBER_STATUS_FIELD?.trim() ?? undefined,
    timeoutMs: readOptionalPositiveIntegerEnv(
      env,
      "SALESFORCE_CAPTURE_TIMEOUT_MS",
    ),
  }
}

function escapeSoqlLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")
}

function getOptionalStringField(
  row: Record<string, unknown>,
  fieldName: string | null,
): string | null {
  if (fieldName === null) {
    return null
  }

  const value = row[fieldName]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

async function loadCandidatesWithSalesforceContactIds(
  connection: DatabaseConnection,
): Promise<readonly MembershipBackfillCandidate[]> {
  const rows = await connection.db
    .select({
      membershipId: contactMemberships.id,
      contactId: contactMemberships.contactId,
      salesforceContactId: contacts.salesforceContactId,
      projectId: contactMemberships.projectId,
      expeditionId: contactMemberships.expeditionId,
      role: contactMemberships.role,
    })
    .from(contactMemberships)
    .innerJoin(contacts, eq(contactMemberships.contactId, contacts.id))
    .where(
      and(
        eq(contactMemberships.source, "salesforce"),
        isNull(contactMemberships.salesforceMembershipId),
      ),
    )

  return rows.filter(
    (
      row,
    ): row is MembershipBackfillCandidate & { readonly salesforceContactId: string } =>
      row.salesforceContactId !== null,
  )
}

function buildMembershipSoql(input: {
  readonly membershipObjectName: string
  readonly membershipContactField: string
  readonly membershipProjectField: string
  readonly membershipExpeditionField: string
  readonly membershipRoleField: string | null
  readonly salesforceContactIds: readonly string[]
}): string {
  const fieldNames = [
    "Id",
    input.membershipContactField,
    input.membershipProjectField,
    input.membershipExpeditionField,
    ...(input.membershipRoleField === null ? [] : [input.membershipRoleField]),
  ]
  const contactIds = input.salesforceContactIds
    .map((value) => `'${escapeSoqlLiteral(value)}'`)
    .join(", ")

  return `SELECT ${fieldNames.join(", ")} FROM ${input.membershipObjectName} WHERE ${input.membershipContactField} IN (${contactIds})`
}

async function matchSalesforceMembershipIds(input: {
  readonly candidates: readonly MembershipBackfillCandidate[]
  readonly salesforceConfig: SalesforceCaptureServiceConfig
  readonly logger: Logger
}): Promise<{
  readonly matches: readonly SalesforceMembershipMatch[]
  readonly unmatchedCount: number
  readonly ambiguousCount: number
}> {
  const client = createSalesforceApiClient(input.salesforceConfig)
  const matches: SalesforceMembershipMatch[] = []
  let unmatchedCount = 0
  let ambiguousCount = 0

  for (const batch of chunkValues(input.candidates, membershipBatchSize)) {
    const uniqueSalesforceContactIds = Array.from(
      new Set(batch.map((candidate) => candidate.salesforceContactId)),
    )
    const salesforceRows = await client.queryAll(
      buildMembershipSoql({
        membershipObjectName:
          input.salesforceConfig.membershipObjectName ??
          "Expedition_Members__c",
        membershipContactField:
          input.salesforceConfig.membershipContactField ?? "Contact__c",
        membershipProjectField:
          input.salesforceConfig.membershipProjectField ?? "Project__c",
        membershipExpeditionField:
          input.salesforceConfig.membershipExpeditionField ?? "Expedition__c",
        membershipRoleField:
          input.salesforceConfig.membershipRoleField ?? null,
        salesforceContactIds: uniqueSalesforceContactIds,
      }),
    )

    const contactIdBySalesforceContactId = new Map(
      batch.map((candidate) => [
        candidate.salesforceContactId,
        candidate.contactId,
      ]),
    )
    const candidateIds = new Set(batch.map((candidate) => candidate.membershipId))
    const matchedSalesforceIdsByMembershipId = new Map<string, Set<string>>()
    const membershipContactField =
      input.salesforceConfig.membershipContactField ?? "Contact__c"
    const membershipProjectField =
      input.salesforceConfig.membershipProjectField ?? "Project__c"
    const membershipExpeditionField =
      input.salesforceConfig.membershipExpeditionField ?? "Expedition__c"
    const membershipRoleField =
      input.salesforceConfig.membershipRoleField ?? null

    for (const row of salesforceRows) {
      const salesforceContactId = getOptionalStringField(
        row,
        membershipContactField,
      )
      const salesforceMembershipId = getOptionalStringField(row, "Id")

      if (salesforceContactId === null || salesforceMembershipId === null) {
        continue
      }

      const contactId = contactIdBySalesforceContactId.get(salesforceContactId)

      if (contactId === undefined) {
        continue
      }

      const membershipId = buildContactMembershipId({
        contactId,
        projectId: getOptionalStringField(row, membershipProjectField),
        expeditionId: getOptionalStringField(row, membershipExpeditionField),
        role: getOptionalStringField(row, membershipRoleField),
      })

      if (!candidateIds.has(membershipId)) {
        continue
      }

      const existing =
        matchedSalesforceIdsByMembershipId.get(membershipId) ?? new Set<string>()
      existing.add(salesforceMembershipId)
      matchedSalesforceIdsByMembershipId.set(membershipId, existing)
    }

    for (const candidate of batch) {
      const salesforceIds =
        matchedSalesforceIdsByMembershipId.get(candidate.membershipId) ?? null

      if (salesforceIds === null || salesforceIds.size === 0) {
        unmatchedCount += 1
        continue
      }

      if (salesforceIds.size > 1) {
        ambiguousCount += 1
        input.logger.error(
          `Skipping ambiguous Salesforce membership match for ${candidate.membershipId}: ${Array.from(
            salesforceIds,
          ).join(", ")}`,
        )
        continue
      }

      const sfId = Array.from(salesforceIds)[0]
      if (sfId === undefined) continue
      matches.push({
        membershipId: candidate.membershipId,
        salesforceMembershipId: sfId,
      })
    }
  }

  return {
    matches,
    unmatchedCount,
    ambiguousCount,
  }
}

async function applyMatches(input: {
  readonly connection: DatabaseConnection
  readonly matches: readonly SalesforceMembershipMatch[]
  readonly dryRun: boolean
}): Promise<number> {
  if (input.dryRun) {
    return 0
  }

  let updatedCount = 0

  for (const match of input.matches) {
    const updatedRows = await input.connection.db
      .update(contactMemberships)
      .set({
        salesforceMembershipId: match.salesforceMembershipId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contactMemberships.id, match.membershipId),
          isNull(contactMemberships.salesforceMembershipId),
        ),
      )
      .returning({
        id: contactMemberships.id,
      })

    updatedCount += updatedRows.length
  }

  return updatedCount
}

export async function runBackfillMembershipSfIdsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<BackfillMembershipSfIdsResult> {
  const flags = parseCliFlags(args)
  const dryRun = readOptionalBooleanFlag(flags, "dry-run", false)
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  })

  try {
    const candidates = await loadCandidatesWithSalesforceContactIds(connection)
    const salesforceConfig = readSalesforceConfig(env)
    const { matches, unmatchedCount, ambiguousCount } =
      await matchSalesforceMembershipIds({
        candidates,
        salesforceConfig,
        logger,
      })
    const updatedCount = await applyMatches({
      connection,
      matches,
      dryRun,
    })

    const result = {
      dryRun,
      candidateCount: candidates.length,
      matchedCount: matches.length,
      updatedCount,
      unmatchedCount,
      ambiguousCount,
    } satisfies BackfillMembershipSfIdsResult

    logger.log(
      dryRun
        ? `[dry-run] would update ${matches.length.toString()} rows`
        : `updated ${updatedCount.toString()} rows`,
    )
    logger.log(JSON.stringify(result, null, 2))

    return result
  } finally {
    await closeDatabaseConnection(connection)
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  void runBackfillMembershipSfIdsCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Backfill membership Salesforce Ids failed.",
      )
      process.exitCode = 1
    },
  )
}
