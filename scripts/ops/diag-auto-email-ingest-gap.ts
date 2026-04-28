#!/usr/bin/env tsx
/**
 * diag-auto-email-ingest-gap
 *
 * Usage:
 *   pnpm tsx scripts/ops/diag-auto-email-ingest-gap.ts
 *   pnpm tsx scripts/ops/diag-auto-email-ingest-gap.ts --days 180
 *   pnpm tsx scripts/ops/diag-auto-email-ingest-gap.ts --days 365 --sample-size 40
 *
 * Read-only diagnostic for the D-039 owner-filter gap. It queries:
 * - Salesforce Task rows for a volunteer sample
 * - Salesforce EmailMessage rows that may represent marketing sends
 * - canonical_event_ledger email events for the same contacts
 *
 * The script prints PR-body-ready Markdown to stdout and writes a CSV artifact
 * with the raw Task / EmailMessage / DB event rows.
 *
 * This script is an ops tool, not part of `apps/web`. The repo boundary rule
 * that restricts direct `@as-comms/db` imports to the Stage 1 composition
 * root only applies to workspace packages under `apps/` and `packages/`.
 */
import process from "node:process"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type PostgresClient,
} from "../../packages/db/src/index.ts"
import {
  createSalesforceApiClient,
  normalizeEmail,
  salesforceLaunchScopeAutomatedOwnerUsernames,
  type SalesforceCaptureServiceConfig,
} from "../../packages/integrations/src/index.ts"

const DEFAULT_DAYS = 180
const DEFAULT_SAMPLE_SIZE = 20
const DEFAULT_OUTPUT_PATH = ".diag-auto-email-ingest-gap-2026-04-27.csv"
const RYAN_DAVIS_SALESFORCE_CONTACT_ID = "0033600000RP4ULAA1"
const MATT_BROMLEY_DISPLAY_NAME = "Matt Bromley"
const EMAIL_MESSAGE_CAPTURE_EXISTS_TODAY = false

const ownerAllowedUsernames = new Set(
  salesforceLaunchScopeAutomatedOwnerUsernames.map((value) =>
    value.toLowerCase(),
  ),
)

type SampleSource =
  | "named_ryan_davis"
  | "named_matt_bromley"
  | "random_active_project"

interface SampleContactRow {
  readonly id: string
  readonly display_name: string
  readonly primary_email: string | null
  readonly salesforce_contact_id: string | null
}

interface DbEmailEventRowRaw {
  readonly id: string
  readonly contact_id: string
  readonly display_name: string
  readonly salesforce_contact_id: string | null
  readonly event_type: string
  readonly occurred_at: string
  readonly channel: string
  readonly direction: string | null
  readonly source_evidence_id: string
  readonly primary_provider: string | null
  readonly payload_ref: string
  readonly subject: string | null
  readonly snippet: string | null
}

type SalesforceRow = Record<string, unknown>

interface SampleContact {
  readonly contactId: string
  readonly displayName: string
  readonly primaryEmail: string | null
  readonly salesforceContactId: string
  readonly sampleSource: SampleSource
}

interface SalesforceContactInfo {
  readonly salesforceContactId: string
  readonly displayName: string | null
  readonly primaryEmail: string | null
}

interface SalesforceTaskRow {
  readonly id: string
  readonly contactId: string
  readonly displayName: string
  readonly primaryEmail: string | null
  readonly salesforceContactId: string
  readonly sampleSource: SampleSource
  readonly createdDate: string
  readonly subject: string | null
  readonly status: string | null
  readonly type: string | null
  readonly taskSubtype: string | null
  readonly description: string | null
  readonly ownerId: string | null
  readonly ownerName: string | null
  readonly ownerUsername: string | null
  readonly emailLike: boolean
  readonly ownerAllowedByD039: boolean
  readonly wouldPassD039: boolean
}

interface SalesforceEmailMessageRow {
  readonly id: string
  readonly createdDate: string
  readonly messageDate: string | null
  readonly subject: string | null
  readonly status: string | null
  readonly fromName: string | null
  readonly fromAddress: string | null
  readonly toAddress: string | null
  readonly ccAddress: string | null
  readonly bccAddress: string | null
  readonly relatedToId: string | null
  readonly hasAttachment: boolean | null
  readonly matchedContacts: readonly SampleContact[]
  readonly matchedByRelatedToId: boolean
  readonly matchedByToAddress: boolean
}

interface DbEmailEventRow {
  readonly id: string
  readonly contactId: string
  readonly displayName: string
  readonly primaryEmail: string | null
  readonly salesforceContactId: string | null
  readonly eventType: string
  readonly occurredAt: string
  readonly channel: string
  readonly direction: string | null
  readonly sourceEvidenceId: string
  readonly primaryProvider: string | null
  readonly payloadRef: string
  readonly subject: string | null
  readonly snippet: string | null
}

interface ContactComparisonRow {
  readonly sampleContact: SampleContact
  readonly sfTaskCount: number
  readonly sfEmailMessageCount: number
  readonly dbEmailEventCount: number
}

interface EmailMessageQuerySummary {
  readonly rowsFound: number
  readonly queryErrors: readonly string[]
  readonly queryNotes: readonly string[]
}

interface OwnerSummaryRow {
  readonly ownerLabel: string
  readonly taskCount: number
  readonly taskPercent: string
  readonly sampleSubjects: string
  readonly ownerAllowedByD039: "yes" | "no"
}

interface EmailMessageSourceSummaryRow {
  readonly sourceLabel: string
  readonly rowCount: number
  readonly rowPercent: string
  readonly sampleSubjects: string
}

interface SubjectBucketSummaryRow {
  readonly bucket: string
  readonly count: number
  readonly sampleSubjects: string
  readonly ownerBreakdown: string
}

interface HypothesisMetrics {
  readonly nonAllowedEmailLikeTaskCount: number
  readonly nonAllowedEmailLikeTaskOwnerCount: number
  readonly namedBucketNonAllowedCount: number
  readonly emailMessageRowCount: number
  readonly emailMessageWithoutDbSubjectMatchCount: number
  readonly nonAllowedWithoutDbSubjectMatchCount: number
  readonly topTwoNonAllowedOwnerCoveragePercent: string
}

interface CsvArtifactRow {
  readonly rowKind: "task" | "email_message" | "db_email_event"
  readonly contactId: string
  readonly displayName: string
  readonly salesforceContactId: string | null
  readonly primaryEmail: string | null
  readonly sampleSource: SampleSource | null
  readonly sfRowId: string | null
  readonly dbEventId: string | null
  readonly createdDate: string | null
  readonly messageDate: string | null
  readonly occurredAt: string | null
  readonly ownerId: string | null
  readonly ownerName: string | null
  readonly ownerUsername: string | null
  readonly ownerAllowedByD039: string | null
  readonly wouldPassD039: string | null
  readonly status: string | null
  readonly type: string | null
  readonly taskSubtype: string | null
  readonly emailLike: string | null
  readonly subject: string | null
  readonly descriptionOrSnippet: string | null
  readonly relatedToId: string | null
  readonly fromName: string | null
  readonly fromAddress: string | null
  readonly toAddress: string | null
  readonly ccAddress: string | null
  readonly bccAddress: string | null
  readonly hasAttachment: string | null
  readonly matchedByRelatedToId: string | null
  readonly matchedByToAddress: string | null
  readonly matchedContactIds: string | null
  readonly matchedSalesforceContactIds: string | null
  readonly matchedDisplayNames: string | null
  readonly eventType: string | null
  readonly channel: string | null
  readonly direction: string | null
  readonly sourceEvidenceId: string | null
  readonly primaryProvider: string | null
  readonly payloadRef: string | null
}

type SubjectBucketKey =
  | "Hex \\d+"
  | "^Don't Forget"
  | "^Plan your Adventure"
  | "^Time to Plan"
  | "Date Pending"
  | "other"

const subjectBuckets: ReadonlyArray<{
  readonly key: Exclude<SubjectBucketKey, "other">
  readonly pattern: RegExp
}> = [
  {
    key: "Hex \\d+",
    pattern: /\bhex\s+\d+\b/iu,
  },
  {
    key: "^Don't Forget",
    pattern: /^don't forget/iu,
  },
  {
    key: "^Plan your Adventure",
    pattern: /^plan your adventure/iu,
  },
  {
    key: "^Time to Plan",
    pattern: /^time to plan/iu,
  },
  {
    key: "Date Pending",
    pattern: /\bdate pending\b/iu,
  },
]

const ryanExpectedSubjects = [
  {
    label: "Plan your Adventure Today",
    pattern: /plan your adventure today/iu,
  },
  {
    label: "Hex 36016 Date Pending",
    pattern: /hex\s+36016\s+date pending/iu,
  },
  {
    label: "Time to Plan Your Adventures",
    pattern: /time to plan your adventures/iu,
  },
  {
    label: "Don't Forget - Start Your Whitebark Pine training",
    pattern: /don't forget.*start your whitebark pine training/iu,
  },
] as const

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function buildSqlInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSqlLiteral(value)).join(", ")})`
}

function quoteSoqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
}

function buildSoqlInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSoqlString(value)).join(", ")})`
}

function buildLikeClause(rawValue: string): string {
  return `'%${rawValue
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")}%'`
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

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

function truncate(value: string | null | undefined, maxLength: number): string {
  if (typeof value !== "string") {
    return ""
  }

  const normalized = value.replace(/\s+/gu, " ").trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function normalizeComparableEmail(value: string | null | undefined): string | null {
  return normalizeEmail(value)
}

function normalizeComparableSubject(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()

  return normalized.length > 0 ? normalized : null
}

function normalizeOwnerUsername(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function extractEmailAddresses(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return []
  }

  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []

  return uniqueStrings(
    matches
      .map((match) => normalizeComparableEmail(match))
      .filter((email): email is string => email !== null),
  )
}

function matchesNormalizedSubjectPattern(
  subject: string | null | undefined,
  pattern: RegExp,
): boolean {
  const normalizedSubject = normalizeComparableSubject(subject)
  return normalizedSubject !== null && pattern.test(normalizedSubject)
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\n/gu, " ")
}

function toMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`
  const dividerLine = `| ${headers.map(() => "---").join(" | ")} |`
  const rowLines = rows.map(
    (row) => `| ${row.map((value) => escapeMarkdownCell(value)).join(" | ")} |`,
  )

  return [headerLine, dividerLine, ...rowLines].join("\n")
}

function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return ""
  }

  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")

  if (
    normalized.includes(",") ||
    normalized.includes('"') ||
    normalized.includes("\n")
  ) {
    return `"${normalized.replaceAll('"', '""')}"`
  }

  return normalized
}

function getPathValue(row: SalesforceRow, fieldName: string): unknown {
  const directValue = row[fieldName]

  if (directValue !== undefined || !fieldName.includes(".")) {
    return directValue
  }

  let currentValue: unknown = row

  for (const pathPart of fieldName.split(".")) {
    if (
      typeof currentValue !== "object" ||
      currentValue === null ||
      !(pathPart in currentValue)
    ) {
      return undefined
    }

    currentValue = (currentValue as Record<string, unknown>)[pathPart]
  }

  return currentValue
}

function getStringField(row: SalesforceRow, fieldName: string): string | null {
  const value = getPathValue(row, fieldName)

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getBooleanField(row: SalesforceRow, fieldName: string): boolean | null {
  const value = getPathValue(row, fieldName)

  return typeof value === "boolean" ? value : null
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim()

  if (!value) {
    throw new Error(`${key} is required`)
  }

  return value
}

function readOptionalIntEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
): number {
  const rawValue = env[key]?.trim()

  if (!rawValue) {
    return defaultValue
  }

  const parsed = Number.parseInt(rawValue, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`)
  }

  return parsed
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: string,
): string {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : defaultValue
}

function readOptionalNullableStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : null
}

function readOptionalCsvEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValues: readonly string[],
): string[] {
  const value = env[key]?.trim()

  if (!value) {
    return [...defaultValues]
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString =
    env.DATABASE_PUBLIC_URL ?? env.WORKER_DATABASE_URL ?? env.DATABASE_URL

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, WORKER_DATABASE_URL, or DATABASE_URL is required.",
    )
  }

  return connectionString
}

function readSalesforceConfig(env: NodeJS.ProcessEnv): SalesforceCaptureServiceConfig {
  return {
    bearerToken: env.SALESFORCE_CAPTURE_TOKEN?.trim() || "diag-auto-email-ingest-gap",
    loginUrl: readRequiredEnv(env, "SALESFORCE_LOGIN_URL"),
    clientId: readRequiredEnv(env, "SALESFORCE_CLIENT_ID"),
    username: readRequiredEnv(env, "SALESFORCE_USERNAME"),
    jwtPrivateKey: readRequiredEnv(env, "SALESFORCE_JWT_PRIVATE_KEY"),
    jwtExpirationSeconds: readOptionalIntEnv(
      env,
      "SALESFORCE_JWT_EXPIRATION_SECONDS",
      180,
    ),
    apiVersion: readOptionalStringEnv(env, "SALESFORCE_API_VERSION", "61.0"),
    contactCaptureMode:
      (env.SALESFORCE_CONTACT_CAPTURE_MODE?.trim() as
        | "delta_polling"
        | "cdc_compatible"
        | undefined) ?? "delta_polling",
    membershipCaptureMode:
      (env.SALESFORCE_MEMBERSHIP_CAPTURE_MODE?.trim() as
        | "delta_polling"
        | "cdc_compatible"
        | undefined) ?? "delta_polling",
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
    membershipProjectNameField: "Project__r.Name",
    membershipExpeditionField: readOptionalStringEnv(
      env,
      "SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_FIELD",
      "Expedition__c",
    ),
    membershipExpeditionNameField: "Expedition__r.Name",
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
    taskEmailChannelValues: readOptionalCsvEnv(
      env,
      "SALESFORCE_TASK_EMAIL_CHANNEL_VALUES",
      ["Email"],
    ),
    taskSmsChannelValues: readOptionalCsvEnv(
      env,
      "SALESFORCE_TASK_SMS_CHANNEL_VALUES",
      ["SMS", "Text"],
    ),
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
    timeoutMs: readOptionalIntEnv(env, "SALESFORCE_CAPTURE_TIMEOUT_MS", 15_000),
  }
}

function toSampleContact(
  row: SampleContactRow,
  sampleSource: SampleSource,
): SampleContact {
  if (row.salesforce_contact_id === null) {
    throw new Error(
      `Expected Salesforce contact id for sample contact ${row.id} (${row.display_name}).`,
    )
  }

  return {
    contactId: row.id,
    displayName: row.display_name,
    primaryEmail: normalizeComparableEmail(row.primary_email),
    salesforceContactId: row.salesforce_contact_id,
    sampleSource,
  }
}

async function loadRequiredNamedContact(
  sql: PostgresClient,
  input: {
    readonly query: string
    readonly description: string
    readonly sampleSource: SampleSource
  },
): Promise<SampleContact> {
  const rows = await sql.unsafe<readonly SampleContactRow[]>(input.query)

  if (rows.length === 0) {
    throw new Error(`Unable to find required named case: ${input.description}.`)
  }

  return toSampleContact(rows[0], input.sampleSource)
}

async function loadRandomSampleContacts(
  sql: PostgresClient,
  input: {
    readonly sampleSize: number
    readonly excludeContactIds: readonly string[]
  },
): Promise<readonly SampleContact[]> {
  const exclusionClause =
    input.excludeContactIds.length === 0
      ? ""
      : `and c.id not in ${buildSqlInClause(input.excludeContactIds)}`

  const rows = await sql.unsafe<readonly SampleContactRow[]>(`
    select
      c.id,
      c.display_name,
      c.primary_email,
      c.salesforce_contact_id
    from contacts c
    where c.salesforce_contact_id is not null
      ${exclusionClause}
      and exists (
        select 1
        from contact_memberships cm
        join project_dimensions pd
          on pd.project_id = cm.project_id
        where cm.contact_id = c.id
          and pd.is_active = true
      )
    order by random()
    limit ${String(input.sampleSize)}
  `)

  return rows.map((row) => toSampleContact(row, "random_active_project"))
}

async function loadSalesforceContactInfo(
  client: ReturnType<typeof createSalesforceApiClient>,
  salesforceContactIds: readonly string[],
): Promise<ReadonlyMap<string, SalesforceContactInfo>> {
  const rows = await querySalesforceRowsByChunks(client, {
    objectName: "Contact",
    fields: ["Id", "Name", "Email"],
    whereField: "Id",
    values: salesforceContactIds,
  })

  return new Map(
    rows
      .map((row) => {
        const salesforceContactId = getStringField(row, "Id")

        if (salesforceContactId === null) {
          return null
        }

        return [
          salesforceContactId,
          {
            salesforceContactId,
            displayName: getStringField(row, "Name"),
            primaryEmail: normalizeComparableEmail(getStringField(row, "Email")),
          } satisfies SalesforceContactInfo,
        ] as const
      })
      .filter(
        (
          entry,
        ): entry is readonly [string, SalesforceContactInfo] => entry !== null,
      ),
  )
}

async function querySalesforceRowsByChunks(
  client: ReturnType<typeof createSalesforceApiClient>,
  input: {
    readonly objectName: string
    readonly fields: readonly string[]
    readonly whereField: string
    readonly values: readonly string[]
    readonly extraWhere?: string | null
    readonly orderBy?: string | null
    readonly chunkSize?: number
  },
): Promise<readonly SalesforceRow[]> {
  const rows: SalesforceRow[] = []

  for (const chunk of chunkValues(input.values, input.chunkSize ?? 100)) {
    const whereClauses = [
      `${input.whereField} IN ${buildSoqlInClause(chunk)}`,
      input.extraWhere ?? null,
    ].filter((value): value is string => value !== null)
    const soql = [
      `SELECT ${uniqueStrings(input.fields).join(", ")}`,
      `FROM ${input.objectName}`,
      `WHERE ${whereClauses.join(" AND ")}`,
      input.orderBy ? `ORDER BY ${input.orderBy}` : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ")

    rows.push(...(await client.queryAll(soql)))
  }

  return rows
}

function isTaskEmailLike(
  row: SalesforceRow,
  config: SalesforceCaptureServiceConfig,
): boolean {
  const taskChannelField =
    getStringField(row, config.taskChannelField) ?? getStringField(row, "TaskSubtype")
  const taskSubtype = taskChannelField?.toLowerCase() ?? null
  const subject = getStringField(row, "Subject")
  const emailChannelValues = new Set(
    config.taskEmailChannelValues.map((value) => value.toLowerCase()),
  )

  if (taskSubtype !== null && emailChannelValues.has(taskSubtype)) {
    return true
  }

  if (
    taskSubtype === "task" &&
    typeof subject === "string" &&
    /email:/iu.test(subject)
  ) {
    return true
  }

  return false
}

async function loadSalesforceTaskRows(
  client: ReturnType<typeof createSalesforceApiClient>,
  samplesBySalesforceContactId: ReadonlyMap<string, SampleContact>,
  config: SalesforceCaptureServiceConfig,
  input: {
    readonly windowStartIso: string
    readonly windowEndIso: string
  },
): Promise<readonly SalesforceTaskRow[]> {
  const allRows: SalesforceTaskRow[] = []
  const salesforceContactIds = Array.from(samplesBySalesforceContactId.keys())

  for (const chunk of chunkValues(salesforceContactIds, 100)) {
    const fields = uniqueStrings([
      "Id",
      "WhoId",
      "OwnerId",
      "Owner.Name",
      "Owner.Username",
      "CreatedDate",
      "Subject",
      "Status",
      "TaskSubtype",
      "Description",
      config.taskContactField,
      config.taskChannelField,
    ])
    const soql = [
      `SELECT ${fields.join(", ")}`,
      "FROM Task",
      `WHERE ${config.taskContactField} IN ${buildSoqlInClause(chunk)}`,
      `AND CreatedDate >= ${input.windowStartIso}`,
      `AND CreatedDate < ${input.windowEndIso}`,
      "ORDER BY CreatedDate ASC, Id ASC",
    ].join(" ")
    const rows = await client.queryAll(soql)

    for (const row of rows) {
      const salesforceContactId =
        getStringField(row, config.taskContactField) ?? getStringField(row, "WhoId")

      if (salesforceContactId === null) {
        continue
      }

      const sampleContact = samplesBySalesforceContactId.get(salesforceContactId)

      if (sampleContact === undefined) {
        continue
      }

      const ownerUsername = getStringField(row, "Owner.Username")
      const ownerAllowedByD039 =
        normalizeOwnerUsername(ownerUsername) !== null &&
        ownerAllowedUsernames.has(normalizeOwnerUsername(ownerUsername) ?? "")
      const emailLike = isTaskEmailLike(row, config)

      allRows.push({
        id:
          getStringField(row, "Id") ??
          `missing-id:${sampleContact.salesforceContactId}:${allRows.length}`,
        contactId: sampleContact.contactId,
        displayName: sampleContact.displayName,
        primaryEmail: sampleContact.primaryEmail,
        salesforceContactId: sampleContact.salesforceContactId,
        sampleSource: sampleContact.sampleSource,
        createdDate:
          getStringField(row, "CreatedDate") ?? input.windowStartIso,
        subject: getStringField(row, "Subject"),
        status: getStringField(row, "Status"),
        type: null,
        taskSubtype: getStringField(row, "TaskSubtype"),
        description: getStringField(row, "Description"),
        ownerId: getStringField(row, "OwnerId"),
        ownerName: getStringField(row, "Owner.Name"),
        ownerUsername,
        emailLike,
        ownerAllowedByD039,
        wouldPassD039: !emailLike || ownerAllowedByD039,
      })
    }
  }

  return allRows
}

function mapSamplesByEmail(
  samples: readonly SampleContact[],
  contactInfoBySalesforceId: ReadonlyMap<string, SalesforceContactInfo>,
): ReadonlyMap<string, readonly SampleContact[]> {
  const map = new Map<string, SampleContact[]>()

  for (const sample of samples) {
    const salesforceContactInfo = contactInfoBySalesforceId.get(
      sample.salesforceContactId,
    )
    const emails = uniqueStrings(
      [
        sample.primaryEmail,
        salesforceContactInfo?.primaryEmail ?? null,
      ].filter((value): value is string => value !== null),
    )

    for (const email of emails) {
      const existing = map.get(email) ?? []
      existing.push(sample)
      map.set(email, existing)
    }
  }

  return map
}

function dedupeSamples(samples: readonly SampleContact[]): readonly SampleContact[] {
  const byContactId = new Map<string, SampleContact>()

  for (const sample of samples) {
    byContactId.set(sample.contactId, sample)
  }

  return Array.from(byContactId.values())
}

async function loadSalesforceEmailMessageRows(
  client: ReturnType<typeof createSalesforceApiClient>,
  input: {
    readonly samples: readonly SampleContact[]
    readonly samplesBySalesforceContactId: ReadonlyMap<string, SampleContact>
    readonly contactInfoBySalesforceId: ReadonlyMap<string, SalesforceContactInfo>
    readonly windowStartIso: string
    readonly windowEndIso: string
  },
): Promise<{
  readonly rows: readonly SalesforceEmailMessageRow[]
  readonly querySummary: EmailMessageQuerySummary
}> {
  const fields = [
    "Id",
    "CreatedDate",
    "MessageDate",
    "Subject",
    "Status",
    "FromName",
    "FromAddress",
    "ToAddress",
    "CcAddress",
    "BccAddress",
    "RelatedToId",
    "HasAttachment",
  ]
  const rowsById = new Map<string, SalesforceRow>()
  const queryErrors: string[] = []
  const queryNotes: string[] = []
  const salesforceContactIds = Array.from(input.samplesBySalesforceContactId.keys())
  const emailsByNormalizedEmail = mapSamplesByEmail(
    input.samples,
    input.contactInfoBySalesforceId,
  )
  const sampleEmails = Array.from(emailsByNormalizedEmail.keys())

  if (salesforceContactIds.length > 0) {
    try {
      const relatedRows = await querySalesforceRowsByChunks(client, {
        objectName: "EmailMessage",
        fields,
        whereField: "RelatedToId",
        values: salesforceContactIds,
        extraWhere: `MessageDate >= ${input.windowStartIso} AND MessageDate < ${input.windowEndIso}`,
        orderBy: "MessageDate ASC, Id ASC",
      })

      for (const row of relatedRows) {
        const rowId = getStringField(row, "Id")

        if (rowId !== null) {
          rowsById.set(rowId, row)
        }
      }

      queryNotes.push(
        `RelatedToId query returned ${String(relatedRows.length)} EmailMessage rows.`,
      )
    } catch (error) {
      queryErrors.push(
        `RelatedToId EmailMessage query failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (sampleEmails.length > 0) {
    try {
      const emailRows: SalesforceRow[] = []

      for (const chunk of chunkValues(sampleEmails, 25)) {
        const emailClauses = chunk.map(
          (email) => `ToAddress LIKE ${buildLikeClause(email)}`,
        )
        const soql = [
          `SELECT ${fields.join(", ")}`,
          "FROM EmailMessage",
          `WHERE MessageDate >= ${input.windowStartIso}`,
          `AND MessageDate < ${input.windowEndIso}`,
          `AND (${emailClauses.join(" OR ")})`,
          "ORDER BY MessageDate ASC, Id ASC",
        ].join(" ")
        emailRows.push(...(await client.queryAll(soql)))
      }

      for (const row of emailRows) {
        const rowId = getStringField(row, "Id")

        if (rowId !== null) {
          rowsById.set(rowId, row)
        }
      }

      queryNotes.push(
        `ToAddress query returned ${String(emailRows.length)} EmailMessage rows before de-duplication.`,
      )
    } catch (error) {
      queryErrors.push(
        `ToAddress EmailMessage query failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  const rows = Array.from(rowsById.values()).map((row) => {
    const relatedToId = getStringField(row, "RelatedToId")
    const toAddress = getStringField(row, "ToAddress")
    const matchedSamples: SampleContact[] = []
    const matchedContactIds = new Set<string>()
    const matchedByRelatedToId =
      relatedToId !== null &&
      input.samplesBySalesforceContactId.has(relatedToId)
    const toAddressEmails = extractEmailAddresses(toAddress)
    let matchedByToAddress = false

    if (relatedToId !== null) {
      const relatedSample = input.samplesBySalesforceContactId.get(relatedToId)

      if (relatedSample !== undefined && !matchedContactIds.has(relatedSample.contactId)) {
        matchedSamples.push(relatedSample)
        matchedContactIds.add(relatedSample.contactId)
      }
    }

    for (const email of toAddressEmails) {
      const emailMatches = emailsByNormalizedEmail.get(email) ?? []

      for (const sample of emailMatches) {
        matchedByToAddress = true

        if (matchedContactIds.has(sample.contactId)) {
          continue
        }

        matchedSamples.push(sample)
        matchedContactIds.add(sample.contactId)
      }
    }

    if (!matchedByToAddress && toAddress !== null) {
      const normalizedToAddress = toAddress.toLowerCase()

      for (const [email, samples] of emailsByNormalizedEmail.entries()) {
        if (!normalizedToAddress.includes(email)) {
          continue
        }

        matchedByToAddress = true

        for (const sample of samples) {
          if (matchedContactIds.has(sample.contactId)) {
            continue
          }

          matchedSamples.push(sample)
          matchedContactIds.add(sample.contactId)
        }
      }
    }

    return {
      id: getStringField(row, "Id") ?? `missing-email-message-id:${rowsById.size}`,
      createdDate: getStringField(row, "CreatedDate") ?? input.windowStartIso,
      messageDate: getStringField(row, "MessageDate"),
      subject: getStringField(row, "Subject"),
      status: getStringField(row, "Status"),
      fromName: getStringField(row, "FromName"),
      fromAddress: getStringField(row, "FromAddress"),
      toAddress,
      ccAddress: getStringField(row, "CcAddress"),
      bccAddress: getStringField(row, "BccAddress"),
      relatedToId,
      hasAttachment: getBooleanField(row, "HasAttachment"),
      matchedContacts: dedupeSamples(matchedSamples),
      matchedByRelatedToId,
      matchedByToAddress,
    } satisfies SalesforceEmailMessageRow
  })

  return {
    rows,
    querySummary: {
      rowsFound: rows.length,
      queryErrors,
      queryNotes,
    },
  }
}

async function loadDbEmailEvents(
  sql: PostgresClient,
  samplesByContactId: ReadonlyMap<string, SampleContact>,
  input: {
    readonly windowStartIso: string
    readonly windowEndIso: string
  },
): Promise<readonly DbEmailEventRow[]> {
  const contactIds = Array.from(samplesByContactId.keys())

  if (contactIds.length === 0) {
    return []
  }

  const rows = await sql.unsafe<readonly DbEmailEventRowRaw[]>(`
    select
      cel.id,
      cel.contact_id,
      c.display_name,
      c.salesforce_contact_id,
      cel.event_type,
      cel.occurred_at::text as occurred_at,
      cel.channel,
      cel.provenance ->> 'direction' as direction,
      cel.source_evidence_id,
      cel.provenance ->> 'primaryProvider' as primary_provider,
      se.payload_ref,
      coalesce(gmd.subject, scd.subject) as subject,
      coalesce(nullif(gmd.snippet_clean, ''), nullif(scd.snippet, '')) as snippet
    from canonical_event_ledger cel
    join contacts c
      on c.id = cel.contact_id
    join source_evidence_log se
      on se.id = cel.source_evidence_id
    left join gmail_message_details gmd
      on gmd.source_evidence_id = cel.source_evidence_id
    left join salesforce_communication_details scd
      on scd.source_evidence_id = cel.source_evidence_id
    where cel.contact_id in ${buildSqlInClause(contactIds)}
      and cel.event_type::text like 'communication.email.%'
      and cel.occurred_at >= ${quoteSqlLiteral(input.windowStartIso)}::timestamptz
      and cel.occurred_at < ${quoteSqlLiteral(input.windowEndIso)}::timestamptz
    order by cel.occurred_at asc, cel.id asc
  `)

  return rows.map((row) => {
    const sample = samplesByContactId.get(row.contact_id)

    return {
      id: row.id,
      contactId: row.contact_id,
      displayName: row.display_name,
      primaryEmail: sample?.primaryEmail ?? null,
      salesforceContactId: row.salesforce_contact_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      channel: row.channel,
      direction: row.direction,
      sourceEvidenceId: row.source_evidence_id,
      primaryProvider: row.primary_provider,
      payloadRef: row.payload_ref,
      subject: row.subject,
      snippet: row.snippet,
    } satisfies DbEmailEventRow
  })
}

function buildOwnerLabel(task: SalesforceTaskRow): string {
  return task.ownerUsername ?? "[null owner]"
}

function buildEmailMessageSourceLabel(message: SalesforceEmailMessageRow): string {
  if (message.fromAddress !== null && message.fromName !== null) {
    return `${message.fromName} <${message.fromAddress}>`
  }

  if (message.fromAddress !== null) {
    return message.fromAddress
  }

  if (message.fromName !== null) {
    return message.fromName
  }

  return "[unknown sender]"
}

function buildSubjectBucket(subject: string | null): SubjectBucketKey {
  const normalizedSubject = normalizeComparableSubject(subject)

  if (normalizedSubject === null) {
    return "other"
  }

  for (const bucket of subjectBuckets) {
    if (bucket.pattern.test(normalizedSubject)) {
      return bucket.key
    }
  }

  return "other"
}

function groupValuesByKey<TValue>(
  values: readonly TValue[],
  getKey: (value: TValue) => string,
): ReadonlyMap<string, TValue[]> {
  const map = new Map<string, TValue[]>()

  for (const value of values) {
    const key = getKey(value)
    const current = map.get(key) ?? []
    current.push(value)
    map.set(key, current)
  }

  return map
}

function buildOwnerSummaryRows(
  taskRows: readonly SalesforceTaskRow[],
): readonly OwnerSummaryRow[] {
  const totalTaskRows = taskRows.length
  const grouped = groupValuesByKey(taskRows, buildOwnerLabel)

  return Array.from(grouped.entries())
    .map(([ownerLabel, rows]) => {
      const ownerAllowedByD039 =
        normalizeOwnerUsername(ownerLabel) !== null &&
        ownerAllowedUsernames.has(normalizeOwnerUsername(ownerLabel) ?? "")
          ? "yes"
          : "no"

      return {
        ownerLabel,
        taskCount: rows.length,
        taskPercent:
          totalTaskRows === 0
            ? "0.0%"
            : formatPercent((rows.length / totalTaskRows) * 100),
        sampleSubjects: uniqueStrings(
          rows
            .map((row) => row.subject)
            .filter((subject): subject is string => subject !== null),
        )
          .slice(0, 3)
          .map((subject) => truncate(subject, 80))
          .join(" | "),
        ownerAllowedByD039,
      } satisfies OwnerSummaryRow
    })
    .sort((left, right) => {
      if (right.taskCount !== left.taskCount) {
        return right.taskCount - left.taskCount
      }

      return left.ownerLabel.localeCompare(right.ownerLabel)
    })
}

function buildEmailMessageSourceSummaryRows(
  rows: readonly SalesforceEmailMessageRow[],
): readonly EmailMessageSourceSummaryRow[] {
  const totalRows = rows.length
  const grouped = groupValuesByKey(rows, buildEmailMessageSourceLabel)

  return Array.from(grouped.entries())
    .map(([sourceLabel, sourceRows]) => ({
      sourceLabel,
      rowCount: sourceRows.length,
      rowPercent:
        totalRows === 0
          ? "0.0%"
          : formatPercent((sourceRows.length / totalRows) * 100),
      sampleSubjects: uniqueStrings(
        sourceRows
          .map((row) => row.subject)
          .filter((subject): subject is string => subject !== null),
      )
        .slice(0, 3)
        .map((subject) => truncate(subject, 80))
        .join(" | "),
    }))
    .sort((left, right) => {
      if (right.rowCount !== left.rowCount) {
        return right.rowCount - left.rowCount
      }

      return left.sourceLabel.localeCompare(right.sourceLabel)
    })
}

function buildContactComparisonRows(
  samples: readonly SampleContact[],
  taskRows: readonly SalesforceTaskRow[],
  emailMessageRows: readonly SalesforceEmailMessageRow[],
  dbEvents: readonly DbEmailEventRow[],
): readonly ContactComparisonRow[] {
  const taskCountByContactId = new Map<string, number>()
  const emailMessageCountByContactId = new Map<string, number>()
  const dbCountByContactId = new Map<string, number>()

  for (const row of taskRows) {
    taskCountByContactId.set(
      row.contactId,
      (taskCountByContactId.get(row.contactId) ?? 0) + 1,
    )
  }

  for (const row of emailMessageRows) {
    for (const matchedContact of row.matchedContacts) {
      emailMessageCountByContactId.set(
        matchedContact.contactId,
        (emailMessageCountByContactId.get(matchedContact.contactId) ?? 0) + 1,
      )
    }
  }

  for (const row of dbEvents) {
    dbCountByContactId.set(
      row.contactId,
      (dbCountByContactId.get(row.contactId) ?? 0) + 1,
    )
  }

  const samplePriority: Readonly<Record<SampleSource, number>> = {
    named_ryan_davis: 0,
    named_matt_bromley: 1,
    random_active_project: 2,
  }

  return [...samples]
    .map((sampleContact) => ({
      sampleContact,
      sfTaskCount: taskCountByContactId.get(sampleContact.contactId) ?? 0,
      sfEmailMessageCount:
        emailMessageCountByContactId.get(sampleContact.contactId) ?? 0,
      dbEmailEventCount: dbCountByContactId.get(sampleContact.contactId) ?? 0,
    }))
    .sort((left, right) => {
      const priorityDiff =
        samplePriority[left.sampleContact.sampleSource] -
        samplePriority[right.sampleContact.sampleSource]

      if (priorityDiff !== 0) {
        return priorityDiff
      }

      const leftGap =
        left.sfTaskCount + left.sfEmailMessageCount - left.dbEmailEventCount
      const rightGap =
        right.sfTaskCount + right.sfEmailMessageCount - right.dbEmailEventCount

      if (rightGap !== leftGap) {
        return rightGap - leftGap
      }

      return left.sampleContact.displayName.localeCompare(
        right.sampleContact.displayName,
      )
    })
}

function buildSubjectBucketSummaryRows(
  taskRows: readonly SalesforceTaskRow[],
): readonly SubjectBucketSummaryRow[] {
  const grouped = groupValuesByKey(taskRows, (row) => buildSubjectBucket(row.subject))
  const orderedBuckets: readonly SubjectBucketKey[] = [
    "Hex \\d+",
    "^Don't Forget",
    "^Plan your Adventure",
    "^Time to Plan",
    "Date Pending",
    "other",
  ]

  return orderedBuckets.map((bucket) => {
    const rows = grouped.get(bucket) ?? []
    const ownerCounts = new Map<string, number>()

    for (const row of rows) {
      const ownerLabel = buildOwnerLabel(row)
      ownerCounts.set(ownerLabel, (ownerCounts.get(ownerLabel) ?? 0) + 1)
    }

    return {
      bucket,
      count: rows.length,
      sampleSubjects: uniqueStrings(
        rows
          .map((row) => row.subject)
          .filter((subject): subject is string => subject !== null),
      )
        .slice(0, 3)
        .map((subject) => truncate(subject, 80))
        .join(" | "),
      ownerBreakdown: Array.from(ownerCounts.entries())
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1]
          }

          return left[0].localeCompare(right[0])
        })
        .map(([ownerLabel, count]) => `${ownerLabel} (${String(count)})`)
        .join(", "),
    } satisfies SubjectBucketSummaryRow
  })
}

function buildDbSubjectsByContactId(
  dbEvents: readonly DbEmailEventRow[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>()

  for (const event of dbEvents) {
    const normalizedSubject = normalizeComparableSubject(event.subject)

    if (normalizedSubject === null) {
      continue
    }

    const current = map.get(event.contactId) ?? new Set<string>()
    current.add(normalizedSubject)
    map.set(event.contactId, current)
  }

  return new Map(
    Array.from(map.entries()).map(([contactId, subjects]) => [contactId, subjects]),
  )
}

function buildHypothesisMetrics(
  taskRows: readonly SalesforceTaskRow[],
  emailMessageRows: readonly SalesforceEmailMessageRow[],
  dbEvents: readonly DbEmailEventRow[],
): HypothesisMetrics {
  const dbSubjectsByContactId = buildDbSubjectsByContactId(dbEvents)
  const nonAllowedEmailLikeTasks = taskRows.filter(
    (row) => row.emailLike && !row.ownerAllowedByD039,
  )
  const nonAllowedOwnerCounts = new Map<string, number>()
  let namedBucketNonAllowedCount = 0
  let nonAllowedWithoutDbSubjectMatchCount = 0

  for (const row of nonAllowedEmailLikeTasks) {
    const ownerLabel = buildOwnerLabel(row)
    nonAllowedOwnerCounts.set(
      ownerLabel,
      (nonAllowedOwnerCounts.get(ownerLabel) ?? 0) + 1,
    )

    if (buildSubjectBucket(row.subject) !== "other") {
      namedBucketNonAllowedCount += 1
    }

    const subjectSet = dbSubjectsByContactId.get(row.contactId)
    const normalizedSubject = normalizeComparableSubject(row.subject)
    const matched =
      normalizedSubject !== null && subjectSet?.has(normalizedSubject) === true

    if (!matched) {
      nonAllowedWithoutDbSubjectMatchCount += 1
    }
  }

  const sortedOwnerCounts = Array.from(nonAllowedOwnerCounts.values()).sort(
    (left, right) => right - left,
  )
  const topTwoOwnerCoverage =
    nonAllowedEmailLikeTasks.length === 0
      ? 0
      : ((sortedOwnerCounts[0] ?? 0) + (sortedOwnerCounts[1] ?? 0)) /
        nonAllowedEmailLikeTasks.length
  let emailMessageWithoutDbSubjectMatchCount = 0

  for (const row of emailMessageRows) {
    const normalizedSubject = normalizeComparableSubject(row.subject)
    const matched = row.matchedContacts.some((contact) => {
      const subjectSet = dbSubjectsByContactId.get(contact.contactId)

      return normalizedSubject !== null && subjectSet?.has(normalizedSubject) === true
    })

    if (!matched) {
      emailMessageWithoutDbSubjectMatchCount += 1
    }
  }

  return {
    nonAllowedEmailLikeTaskCount: nonAllowedEmailLikeTasks.length,
    nonAllowedEmailLikeTaskOwnerCount: nonAllowedOwnerCounts.size,
    namedBucketNonAllowedCount,
    emailMessageRowCount: emailMessageRows.length,
    emailMessageWithoutDbSubjectMatchCount,
    nonAllowedWithoutDbSubjectMatchCount,
    topTwoNonAllowedOwnerCoveragePercent: formatPercent(topTwoOwnerCoverage * 100),
  }
}

function renderTopLineSummarySection(input: {
  readonly sampleCount: number
  readonly taskRows: readonly SalesforceTaskRow[]
  readonly emailMessageRows: readonly SalesforceEmailMessageRow[]
  readonly dbEvents: readonly DbEmailEventRow[]
  readonly days: number
}): string {
  const totalSfRows = input.taskRows.length + input.emailMessageRows.length
  const totalDbRows = input.dbEvents.length
  const totalGap = totalSfRows - totalDbRows
  const gapPercent = totalSfRows === 0 ? "0.0%" : formatPercent((totalGap / totalSfRows) * 100)
  const emailLikeTaskCount = input.taskRows.filter((row) => row.emailLike).length
  const ownerFilteredTaskCount = input.taskRows.filter(
    (row) => row.emailLike && !row.ownerAllowedByD039,
  ).length

  return [
    "## 1. Top-line summary",
    "",
    `- Sample size: ${String(input.sampleCount)} volunteers (Ryan Davis, Matt Bromley, plus ${String(
      Math.max(0, input.sampleCount - 2),
    )} active-project random contacts).`,
    `- Window: last ${String(input.days)} days.`,
    `- Total Salesforce rows in window: ${String(totalSfRows)} (${String(
      input.taskRows.length,
    )} Task rows, ${String(input.emailMessageRows.length)} EmailMessage rows).`,
    `- Total DB email-event rows in window: ${String(totalDbRows)}.`,
    `- Estimated overall gap: ${String(totalGap)} rows (${gapPercent}).`,
    `- Email-like Task rows in the Salesforce sample: ${String(emailLikeTaskCount)}.`,
    `- Email-like Task rows that the D-039 owner gate would exclude today: ${String(ownerFilteredTaskCount)}.`,
  ].join("\n")
}

function renderOwnerSummarySection(taskRows: readonly SalesforceTaskRow[]): string {
  const rows = buildOwnerSummaryRows(taskRows)

  return [
    "## 2. Distinct `Owner.Username` table for Salesforce Task rows",
    "",
    toMarkdownTable(
      [
        "Owner.Username",
        "Task count",
        "% of Task rows",
        "Sample subjects",
        "Allowed by D-039",
      ],
      rows.map((row) => [
        row.ownerLabel,
        String(row.taskCount),
        row.taskPercent,
        row.sampleSubjects,
        row.ownerAllowedByD039,
      ]),
    ),
  ].join("\n")
}

function renderEmailMessageSection(input: {
  readonly rows: readonly SalesforceEmailMessageRow[]
  readonly querySummary: EmailMessageQuerySummary
}): string {
  const summaryLines = [
    "## 3. EmailMessage breakdown",
    "",
    `- EmailMessage capture exists in the codebase today: ${
      EMAIL_MESSAGE_CAPTURE_EXISTS_TODAY ? "yes" : "no"
    }.`,
  ]

  for (const note of input.querySummary.queryNotes) {
    summaryLines.push(`- ${note}`)
  }

  for (const error of input.querySummary.queryErrors) {
    summaryLines.push(`- ${error}`)
  }

  if (input.rows.length === 0) {
    summaryLines.push("- No EmailMessage rows were found in the sample window.")
    return summaryLines.join("\n")
  }

  const rows = buildEmailMessageSourceSummaryRows(input.rows)

  summaryLines.push("")
  summaryLines.push(
    toMarkdownTable(
      ["Sender / system source", "Row count", "% of EmailMessage rows", "Sample subjects"],
      rows.map((row) => [
        row.sourceLabel,
        String(row.rowCount),
        row.rowPercent,
        row.sampleSubjects,
      ]),
    ),
  )

  return summaryLines.join("\n")
}

function renderPerVolunteerComparisonSection(
  rows: readonly ContactComparisonRow[],
): string {
  return [
    "## 4. Per-sample-volunteer comparison table",
    "",
    toMarkdownTable(
      [
        "Display name",
        "Salesforce contact id",
        "SF Task count",
        "SF EmailMessage count",
        "DB email-event count",
        "Gap",
        "Gap %",
      ],
      rows.map((row) => {
        const sfTotal = row.sfTaskCount + row.sfEmailMessageCount
        const gap = sfTotal - row.dbEmailEventCount
        const gapPercent =
          sfTotal === 0 ? "n/a" : formatPercent((gap / sfTotal) * 100)

        return [
          row.sampleContact.displayName,
          row.sampleContact.salesforceContactId,
          String(row.sfTaskCount),
          String(row.sfEmailMessageCount),
          String(row.dbEmailEventCount),
          String(gap),
          gapPercent,
        ]
      }),
    ),
  ].join("\n")
}

function renderSubjectBucketSection(taskRows: readonly SalesforceTaskRow[]): string {
  const rows = buildSubjectBucketSummaryRows(taskRows)

  return [
    "## 5. Subject pattern groupings",
    "",
    toMarkdownTable(
      ["Bucket", "Count", "Sample subjects", "Owner breakdown"],
      rows.map((row) => [
        row.bucket,
        String(row.count),
        row.sampleSubjects,
        row.ownerBreakdown,
      ]),
    ),
  ].join("\n")
}

function renderHypothesisSection(metrics: HypothesisMetrics): string {
  const namedBucketPercent =
    metrics.nonAllowedEmailLikeTaskCount === 0
      ? "0.0%"
      : formatPercent(
          (metrics.namedBucketNonAllowedCount /
            metrics.nonAllowedEmailLikeTaskCount) *
            100,
        )

  return [
    "## 6. Hypothesis section",
    "",
    `- Non-allowed email-like Task rows: ${String(metrics.nonAllowedEmailLikeTaskCount)} across ${String(
      metrics.nonAllowedEmailLikeTaskOwnerCount,
    )} distinct owners. The top two owners cover ${metrics.topTwoNonAllowedOwnerCoveragePercent} of that set.`,
    `- Volunteer-comms subject buckets cover ${String(metrics.namedBucketNonAllowedCount)} of those non-allowed email-like Task rows (${namedBucketPercent}).`,
    `- Subject-level DB absence is concentrated in the filtered set: ${String(
      metrics.nonAllowedWithoutDbSubjectMatchCount,
    )} non-allowed email-like Task rows have no same-contact DB subject match in the window.`,
    `- EmailMessage evidence ${metrics.emailMessageRowCount > 0 ? "is present" : "was not found"} in the sample. ${
      metrics.emailMessageRowCount > 0
        ? `${String(metrics.emailMessageWithoutDbSubjectMatchCount)} EmailMessage rows have no same-contact DB subject match.`
        : ""
    }`,
    `- The data supports whichever widening path matches the observed shape: owner-whitelist or hybrid if missed rows concentrate in a small automation-owner set, subject fallback if subject concentration is high but owners are fragmented, and a new EmailMessage ingest path if EmailMessage rows are materially present and absent from the DB.`,
  ].join("\n")
}

function renderWideningOptionsSection(metrics: HypothesisMetrics): string {
  const namedBucketPercent =
    metrics.nonAllowedEmailLikeTaskCount === 0
      ? "0.0%"
      : formatPercent(
          (metrics.namedBucketNonAllowedCount /
            metrics.nonAllowedEmailLikeTaskCount) *
            100,
        )

  const lines = [
    "## 7. Phase-2 widening options to enumerate",
    "",
    `- E.1 Widen owner whitelist. Evidence: ${String(
      metrics.nonAllowedEmailLikeTaskCount,
    )} non-allowed email-like Task rows are the direct D-039 blast radius, and the top-two-owner concentration is ${metrics.topTwoNonAllowedOwnerCoveragePercent}. Pros: preserves owner-truth if the missed rows cluster under a small automation-owner set. Cons: if owner fragmentation is high, this becomes an ongoing maintenance list.`,
    `- E.2 Replace owner filter with subject-pattern + volunteer-WhoId. Evidence: ${namedBucketPercent} of the non-allowed email-like Task rows fall into the named volunteer subject buckets. Pros: catches future automation accounts without owner maintenance when subject concentration is high. Cons: if the missed rows spill into "other", this opens the door to false positives and weakens owner-truth.`,
    `- E.3 Hybrid owner-truth primary, subject-pattern fallback. Evidence: this is supported when D-039 still correctly captures Nim Admin rows but ${String(
      metrics.nonAllowedWithoutDbSubjectMatchCount,
    )} non-allowed email-like Task rows remain absent from the DB. Pros: keeps the current owner-truth path intact and only widens the missed volunteer-pattern rows. Cons: two paths to maintain and explain.`,
    `- E.4 New Salesforce EmailMessage capture path. Evidence: ${String(
      metrics.emailMessageRowCount,
    )} EmailMessage rows were found in the sample, and ${String(
      metrics.emailMessageWithoutDbSubjectMatchCount,
    )} of them have no same-contact DB subject match. Pros: directly captures Marketing Cloud / Pardot-style sends if they live outside Task. Cons: new capture surface, new mapping work, and potentially more dedupe complexity.`,
    "",
    "_No phase-2 winner is selected in this PR. Nico chooses the strategy after review._",
  ]

  return lines.join("\n")
}

function renderNamedCaseVerificationSection(input: {
  readonly ryanSample: SampleContact
  readonly mattSample: SampleContact
  readonly taskRows: readonly SalesforceTaskRow[]
  readonly emailMessageRows: readonly SalesforceEmailMessageRow[]
  readonly dbEvents: readonly DbEmailEventRow[]
}): string {
  const ryanDbSubjects = new Set(
    input.dbEvents
      .filter((row) => row.contactId === input.ryanSample.contactId)
      .map((row) => normalizeComparableSubject(row.subject))
      .filter((value): value is string => value !== null),
  )
  const ryanSfSubjects = [
    ...input.taskRows
      .filter((row) => row.contactId === input.ryanSample.contactId)
      .map((row) => ({
        rowKind: "Task",
        subject: row.subject,
        createdAt: row.createdDate,
      })),
    ...input.emailMessageRows
      .filter((row) =>
        row.matchedContacts.some(
          (contact) => contact.contactId === input.ryanSample.contactId,
        ),
      )
      .map((row) => ({
        rowKind: "EmailMessage",
        subject: row.subject,
        createdAt: row.messageDate ?? row.createdDate,
      })),
  ]
  const mattTaskCount = input.taskRows.filter(
    (row) => row.contactId === input.mattSample.contactId,
  ).length
  const mattEmailMessageCount = input.emailMessageRows.filter((row) =>
    row.matchedContacts.some(
      (contact) => contact.contactId === input.mattSample.contactId,
    ),
  ).length
  const mattDbCount = input.dbEvents.filter(
    (row) => row.contactId === input.mattSample.contactId,
  ).length
  const lines = [
    "## 8. Verification of named cases",
    "",
    `- Ryan Davis sample anchor: ${input.ryanSample.salesforceContactId}.`,
  ]

  for (const expected of ryanExpectedSubjects) {
    const sfMatches = ryanSfSubjects.filter(
      (row) => matchesNormalizedSubjectPattern(row.subject, expected.pattern),
    )
    const dbPresent = Array.from(ryanDbSubjects).some((subjectValue) =>
      matchesNormalizedSubjectPattern(subjectValue, expected.pattern),
    )

    if (sfMatches.length === 0) {
      lines.push(
        `- Ryan check: "${expected.label}" was NOT found in the Salesforce sample rows. This needs manual follow-up because Nico's screenshots show it in Salesforce.`,
      )
      continue
    }

    lines.push(
      `- Ryan check: "${expected.label}" appears in Salesforce (${sfMatches
        .map((match) => `${match.rowKind} @ ${match.createdAt}`)
        .join(", ")}) and is ${dbPresent ? "present in" : "absent from"} the DB email-event subject set.`,
    )

    if (dbPresent) {
      lines.push(
        `- Flag: "${expected.label}" is already present in the DB sample for Ryan, which points to a bug other than pure D-039 owner scope for that row.`,
      )
    }
  }

  lines.push(
    `- Matt Bromley sample anchor: ${input.mattSample.salesforceContactId}. Salesforce rows in window: ${String(
      mattTaskCount + mattEmailMessageCount,
    )} (${String(mattTaskCount)} Task, ${String(
      mattEmailMessageCount,
    )} EmailMessage). DB email-event rows in window: ${String(mattDbCount)}. Gap: ${String(
      mattTaskCount + mattEmailMessageCount - mattDbCount,
    )}.`,
  )

  return lines.join("\n")
}

function buildCsvArtifactRows(input: {
  readonly taskRows: readonly SalesforceTaskRow[]
  readonly emailMessageRows: readonly SalesforceEmailMessageRow[]
  readonly dbEvents: readonly DbEmailEventRow[]
}): readonly CsvArtifactRow[] {
  const taskArtifactRows = input.taskRows.map((row) => ({
    rowKind: "task" as const,
    contactId: row.contactId,
    displayName: row.displayName,
    salesforceContactId: row.salesforceContactId,
    primaryEmail: row.primaryEmail,
    sampleSource: row.sampleSource,
    sfRowId: row.id,
    dbEventId: null,
    createdDate: row.createdDate,
    messageDate: null,
    occurredAt: row.createdDate,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    ownerUsername: row.ownerUsername,
    ownerAllowedByD039: String(row.ownerAllowedByD039),
    wouldPassD039: String(row.wouldPassD039),
    status: row.status,
    type: row.type,
    taskSubtype: row.taskSubtype,
    emailLike: String(row.emailLike),
    subject: row.subject,
    descriptionOrSnippet: row.description,
    relatedToId: null,
    fromName: null,
    fromAddress: null,
    toAddress: null,
    ccAddress: null,
    bccAddress: null,
    hasAttachment: null,
    matchedByRelatedToId: null,
    matchedByToAddress: null,
    matchedContactIds: row.contactId,
    matchedSalesforceContactIds: row.salesforceContactId,
    matchedDisplayNames: row.displayName,
    eventType: null,
    channel: null,
    direction: null,
    sourceEvidenceId: null,
    primaryProvider: null,
    payloadRef: null,
  }))
  const emailMessageArtifactRows = input.emailMessageRows.flatMap((row) => {
    const targetContacts: readonly (SampleContact | null)[] =
      row.matchedContacts.length === 0 ? [null] : row.matchedContacts

    return targetContacts.map((matchedContact) => ({
      rowKind: "email_message" as const,
      contactId: matchedContact?.contactId ?? "",
      displayName: matchedContact?.displayName ?? "",
      salesforceContactId: matchedContact?.salesforceContactId ?? null,
      primaryEmail: matchedContact?.primaryEmail ?? null,
      sampleSource: matchedContact?.sampleSource ?? null,
      sfRowId: row.id,
      dbEventId: null,
      createdDate: row.createdDate,
      messageDate: row.messageDate,
      occurredAt: row.messageDate ?? row.createdDate,
      ownerId: null,
      ownerName: null,
      ownerUsername: null,
      ownerAllowedByD039: null,
      wouldPassD039: null,
      status: row.status,
      type: null,
      taskSubtype: null,
      emailLike: null,
      subject: row.subject,
      descriptionOrSnippet: null,
      relatedToId: row.relatedToId,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      ccAddress: row.ccAddress,
      bccAddress: row.bccAddress,
      hasAttachment:
        row.hasAttachment === null ? null : String(row.hasAttachment),
      matchedByRelatedToId: String(row.matchedByRelatedToId),
      matchedByToAddress: String(row.matchedByToAddress),
      matchedContactIds: row.matchedContacts.map((contact) => contact.contactId).join("|"),
      matchedSalesforceContactIds: row.matchedContacts
        .map((contact) => contact.salesforceContactId)
        .join("|"),
      matchedDisplayNames: row.matchedContacts
        .map((contact) => contact.displayName)
        .join("|"),
      eventType: null,
      channel: null,
      direction: null,
      sourceEvidenceId: null,
      primaryProvider: null,
      payloadRef: null,
    }))
  })
  const dbArtifactRows = input.dbEvents.map((row) => ({
    rowKind: "db_email_event" as const,
    contactId: row.contactId,
    displayName: row.displayName,
    salesforceContactId: row.salesforceContactId,
    primaryEmail: row.primaryEmail,
    sampleSource: null,
    sfRowId: null,
    dbEventId: row.id,
    createdDate: null,
    messageDate: null,
    occurredAt: row.occurredAt,
    ownerId: null,
    ownerName: null,
    ownerUsername: null,
    ownerAllowedByD039: null,
    wouldPassD039: null,
    status: null,
    type: null,
    taskSubtype: null,
    emailLike: null,
    subject: row.subject,
    descriptionOrSnippet: row.snippet,
    relatedToId: null,
    fromName: null,
    fromAddress: null,
    toAddress: null,
    ccAddress: null,
    bccAddress: null,
    hasAttachment: null,
    matchedByRelatedToId: null,
    matchedByToAddress: null,
    matchedContactIds: row.contactId,
    matchedSalesforceContactIds: row.salesforceContactId,
    matchedDisplayNames: row.displayName,
    eventType: row.eventType,
    channel: row.channel,
    direction: row.direction,
    sourceEvidenceId: row.sourceEvidenceId,
    primaryProvider: row.primaryProvider,
    payloadRef: row.payloadRef,
  }))

  return [...taskArtifactRows, ...emailMessageArtifactRows, ...dbArtifactRows]
}

async function writeCsvArtifact(
  artifactRows: readonly CsvArtifactRow[],
  outputPath: string,
): Promise<void> {
  const headers = [
    "row_kind",
    "contact_id",
    "display_name",
    "salesforce_contact_id",
    "primary_email",
    "sample_source",
    "sf_row_id",
    "db_event_id",
    "created_date",
    "message_date",
    "occurred_at",
    "owner_id",
    "owner_name",
    "owner_username",
    "owner_allowed_by_d039",
    "would_pass_d039",
    "status",
    "type",
    "task_subtype",
    "email_like",
    "subject",
    "description_or_snippet",
    "related_to_id",
    "from_name",
    "from_address",
    "to_address",
    "cc_address",
    "bcc_address",
    "has_attachment",
    "matched_by_related_to_id",
    "matched_by_to_address",
    "matched_contact_ids",
    "matched_salesforce_contact_ids",
    "matched_display_names",
    "event_type",
    "channel",
    "direction",
    "source_evidence_id",
    "primary_provider",
    "payload_ref",
  ]
  const lines = [
    headers.join(","),
    ...artifactRows.map((row) =>
      [
        row.rowKind,
        row.contactId,
        row.displayName,
        row.salesforceContactId,
        row.primaryEmail,
        row.sampleSource,
        row.sfRowId,
        row.dbEventId,
        row.createdDate,
        row.messageDate,
        row.occurredAt,
        row.ownerId,
        row.ownerName,
        row.ownerUsername,
        row.ownerAllowedByD039,
        row.wouldPassD039,
        row.status,
        row.type,
        row.taskSubtype,
        row.emailLike,
        row.subject,
        row.descriptionOrSnippet,
        row.relatedToId,
        row.fromName,
        row.fromAddress,
        row.toAddress,
        row.ccAddress,
        row.bccAddress,
        row.hasAttachment,
        row.matchedByRelatedToId,
        row.matchedByToAddress,
        row.matchedContactIds,
        row.matchedSalesforceContactIds,
        row.matchedDisplayNames,
        row.eventType,
        row.channel,
        row.direction,
        row.sourceEvidenceId,
        row.primaryProvider,
        row.payloadRef,
      ]
        .map((value) => csvEscape(value))
        .join(","),
    ),
  ]

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8")
}

function buildMarkdownReport(input: {
  readonly samples: readonly SampleContact[]
  readonly ryanSample: SampleContact
  readonly mattSample: SampleContact
  readonly days: number
  readonly taskRows: readonly SalesforceTaskRow[]
  readonly emailMessageRows: readonly SalesforceEmailMessageRow[]
  readonly emailMessageQuerySummary: EmailMessageQuerySummary
  readonly dbEvents: readonly DbEmailEventRow[]
}): string {
  const comparisonRows = buildContactComparisonRows(
    input.samples,
    input.taskRows,
    input.emailMessageRows,
    input.dbEvents,
  )
  const hypothesisMetrics = buildHypothesisMetrics(
    input.taskRows,
    input.emailMessageRows,
    input.dbEvents,
  )

  return [
    renderTopLineSummarySection({
      sampleCount: input.samples.length,
      days: input.days,
      taskRows: input.taskRows,
      emailMessageRows: input.emailMessageRows,
      dbEvents: input.dbEvents,
    }),
    "",
    renderOwnerSummarySection(input.taskRows),
    "",
    renderEmailMessageSection({
      rows: input.emailMessageRows,
      querySummary: input.emailMessageQuerySummary,
    }),
    "",
    renderPerVolunteerComparisonSection(comparisonRows),
    "",
    renderSubjectBucketSection(input.taskRows),
    "",
    renderHypothesisSection(hypothesisMetrics),
    "",
    renderWideningOptionsSection(hypothesisMetrics),
    "",
    renderNamedCaseVerificationSection({
      ryanSample: input.ryanSample,
      mattSample: input.mattSample,
      taskRows: input.taskRows,
      emailMessageRows: input.emailMessageRows,
      dbEvents: input.dbEvents,
    }),
  ].join("\n")
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: {
        type: "string",
      },
      "sample-size": {
        type: "string",
      },
      output: {
        type: "string",
      },
    },
  })
  const days = values.days ? Number.parseInt(values.days, 10) : DEFAULT_DAYS
  const sampleSize = values["sample-size"]
    ? Number.parseInt(values["sample-size"], 10)
    : DEFAULT_SAMPLE_SIZE
  const outputPath = resolve(process.cwd(), values.output ?? DEFAULT_OUTPUT_PATH)

  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("--days must be a positive integer")
  }

  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer")
  }

  const now = new Date()
  const windowEndIso = now.toISOString()
  const windowStartIso = new Date(
    now.getTime() - days * 24 * 60 * 60 * 1000,
  ).toISOString()
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env),
  })
  const salesforceConfig = readSalesforceConfig(process.env)

  try {
    const ryanSample = await loadRequiredNamedContact(connection.sql, {
      query: `
        select id, display_name, primary_email, salesforce_contact_id
        from contacts
        where salesforce_contact_id = ${quoteSqlLiteral(
          RYAN_DAVIS_SALESFORCE_CONTACT_ID,
        )}
        limit 1
      `,
      description: `Ryan Davis (${RYAN_DAVIS_SALESFORCE_CONTACT_ID})`,
      sampleSource: "named_ryan_davis",
    })
    const mattSample = await loadRequiredNamedContact(connection.sql, {
      query: `
        select id, display_name, primary_email, salesforce_contact_id
        from contacts
        where display_name = ${quoteSqlLiteral(MATT_BROMLEY_DISPLAY_NAME)}
          and salesforce_contact_id is not null
        order by updated_at desc
        limit 1
      `,
      description: MATT_BROMLEY_DISPLAY_NAME,
      sampleSource: "named_matt_bromley",
    })
    const randomSamples = await loadRandomSampleContacts(connection.sql, {
      sampleSize,
      excludeContactIds: [ryanSample.contactId, mattSample.contactId],
    })
    const samples = [ryanSample, mattSample, ...randomSamples]
    const samplesBySalesforceContactId = new Map(
      samples.map((sample) => [sample.salesforceContactId, sample] as const),
    )
    const samplesByContactId = new Map(
      samples.map((sample) => [sample.contactId, sample] as const),
    )
    const salesforceClient = createSalesforceApiClient(salesforceConfig)
    const contactInfoBySalesforceId = await loadSalesforceContactInfo(
      salesforceClient,
      Array.from(samplesBySalesforceContactId.keys()),
    )
    const taskRows = await loadSalesforceTaskRows(
      salesforceClient,
      samplesBySalesforceContactId,
      salesforceConfig,
      {
        windowStartIso,
        windowEndIso,
      },
    )
    const {
      rows: emailMessageRows,
      querySummary: emailMessageQuerySummary,
    } = await loadSalesforceEmailMessageRows(salesforceClient, {
      samples,
      samplesBySalesforceContactId,
      contactInfoBySalesforceId,
      windowStartIso,
      windowEndIso,
    })
    const dbEvents = await loadDbEmailEvents(connection.sql, samplesByContactId, {
      windowStartIso,
      windowEndIso,
    })
    const artifactRows = buildCsvArtifactRows({
      taskRows,
      emailMessageRows,
      dbEvents,
    })

    await writeCsvArtifact(artifactRows, outputPath)

    const markdownReport = buildMarkdownReport({
      samples,
      ryanSample,
      mattSample,
      days,
      taskRows,
      emailMessageRows,
      emailMessageQuerySummary,
      dbEvents,
    })

    console.log(markdownReport)
  } finally {
    await closeDatabaseConnection(connection)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
