#!/usr/bin/env tsx

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
} from "../../packages/db/src/client.ts";
import {
  createSalesforceApiClient,
  type SalesforceCaptureServiceConfig,
} from "../../packages/integrations/src/capture-services/salesforce.ts";

const outputCsvPath = ".diag-lifecycle-event-completeness-2026-04-27.csv";
const namedCaseContactName = "Matt Bromley";
const namedCaseProjectName = "WPEF Tracking Whitebark Pine OR WA 2025-2026";
const samplePerProjectDefault = 5;
const oneDayMs = 24 * 60 * 60 * 1000;

const lifecycleMilestones = [
  "signed_up",
  "received_training",
  "completed_training",
  "submitted_first_data",
] as const;
type LifecycleMilestone = (typeof lifecycleMilestones)[number];

type SampleSource = "active_project_sample" | "named_case";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface ActiveProjectInventoryRow {
  readonly project_id: string;
  readonly project_name: string;
  readonly eligible_memberships: number;
}

interface ActiveProjectSampleRow {
  readonly canonical_membership_row_id: string;
  readonly salesforce_membership_id: string;
  readonly canonical_contact_id: string;
  readonly canonical_contact_display_name: string;
  readonly canonical_salesforce_contact_id: string | null;
  readonly canonical_project_id: string | null;
  readonly canonical_project_name: string | null;
  readonly project_sample_rank: number;
}

interface NamedCaseDbContextRow {
  readonly contact_id: string;
  readonly display_name: string;
  readonly salesforce_contact_id: string | null;
  readonly membership_row_id: string | null;
  readonly project_id: string | null;
  readonly project_name: string | null;
}

interface MembershipSelection {
  readonly membershipId: string;
  canonicalMembershipRowId: string | null;
  canonicalContactId: string | null;
  canonicalContactDisplayName: string | null;
  canonicalSalesforceContactId: string | null;
  canonicalProjectId: string | null;
  canonicalProjectName: string | null;
  projectSampleRank: number | null;
  readonly sampleSources: Set<SampleSource>;
}

interface SalesforceMembershipRecord {
  readonly membershipId: string;
  readonly salesforceContactId: string | null;
  readonly contactName: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly createdDate: string | null;
  readonly trainingSentDate: string | null;
  readonly trainingCompletedDate: string | null;
  readonly firstSampleCollectedDate: string | null;
}

interface DbLifecycleEventRow {
  readonly salesforce_membership_id: string;
  readonly canonical_event_id: string;
  readonly contact_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly source_evidence_id: string;
  readonly provider_record_id: string;
  readonly project_id: string | null;
  readonly expedition_id: string | null;
  readonly rendered_project_name: string | null;
  readonly rendered_expedition_name: string | null;
  readonly source_field: string | null;
}

interface OperationalBoundaryRow {
  readonly first_successful_salesforce_sync_at: string | null;
  readonly first_lifecycle_evidence_created_at: string | null;
}

interface MilestoneComparison {
  readonly milestone: LifecycleMilestone;
  readonly sfOccurredAt: string | null;
  readonly sfPresent: boolean;
  readonly dbOccurredAts: readonly string[];
  readonly dbPresent: boolean;
  readonly bestDbOccurredAt: string | null;
  readonly dateDeltaDays: number | null;
  readonly withinOneDay: boolean | null;
  readonly sourceEvidenceIds: readonly string[];
}

interface MembershipComparison {
  readonly membershipId: string;
  readonly volunteerName: string;
  readonly salesforceContactId: string | null;
  readonly canonicalContactId: string | null;
  readonly projectName: string;
  readonly projectId: string | null;
  readonly canonicalProjectId: string | null;
  readonly canonicalMembershipRowId: string | null;
  readonly sampleSources: readonly SampleSource[];
  readonly sfRecordFound: boolean;
  readonly sfAllFourNonNull: boolean;
  readonly dbAllFourPresent: boolean;
  readonly sfNonNullMilestoneCount: number;
  readonly dbPresentMilestoneCount: number;
  readonly matchedPresenceCount: number;
  readonly exactDateMatchCount: number;
  readonly gapCount: number;
  readonly unexpectedDbWithoutSfCount: number;
  readonly olderThanOperationalBoundary: boolean | null;
  readonly milestoneComparisons: Readonly<
    Record<LifecycleMilestone, MilestoneComparison>
  >;
}

interface AggregateMilestoneStats {
  readonly milestone: LifecycleMilestone;
  sampledMembershipCount: number;
  sfPresentCount: number;
  dbPresentCount: number;
  exactDateMatchCount: number;
  gapCount: number;
  unexpectedDbWithoutSfCount: number;
}

interface ProjectSummary {
  readonly projectId: string;
  readonly projectName: string;
  readonly isActiveProjectBreadth: boolean;
  readonly sampledMembershipCount: number;
  readonly eligibleMembershipCount: number | null;
  readonly overallCompletenessPercent: number | null;
  readonly overallExactMatchPercent: number | null;
  readonly milestoneStats: Readonly<
    Record<LifecycleMilestone, AggregateMilestoneStats>
  >;
}

interface ContactSummary {
  readonly canonicalContactId: string | null;
  readonly salesforceContactId: string | null;
  readonly volunteerName: string;
  readonly sampledMembershipCount: number;
  readonly sfNonNullMilestoneCount: number;
  readonly dbPresentMilestoneCount: number;
  readonly gapCount: number;
  readonly completenessPercent: number | null;
}

interface NamedCaseDisplayEvent {
  readonly milestone: LifecycleMilestone;
  readonly occurredAt: string;
  readonly label: string;
  readonly sourceEvidenceId: string;
}

interface LifecycleTimelineRow {
  readonly id: string;
  readonly canonical_event_id: string;
  readonly occurred_at: string;
  readonly sort_key: string;
  readonly event_type: string;
  readonly project_name: string | null;
  readonly expedition_name: string | null;
}

interface NamedCaseRecentActivityRow {
  readonly id: string;
  readonly label: string;
  readonly occurredAt: string;
}

interface NamedCaseDisplayAudit {
  readonly canEvaluate: boolean;
  readonly reason: string | null;
  readonly rawDbLifecycleEvents: readonly NamedCaseDisplayEvent[];
  readonly timelineLifecycleEvents: readonly NamedCaseDisplayEvent[];
  readonly recentActivityRows: readonly NamedCaseRecentActivityRow[];
  readonly missingFromTimeline: readonly LifecycleMilestone[];
  readonly missingFromRecentActivity: readonly LifecycleMilestone[];
  readonly totalContactLifecycleEvents: number;
}

interface InvestigationResult {
  readonly comparisonRows: readonly MembershipComparison[];
  readonly projectSummaries: readonly ProjectSummary[];
  readonly milestoneSummaries: readonly AggregateMilestoneStats[];
  readonly contactSummaries: readonly ContactSummary[];
  readonly operationalBoundaryAt: string | null;
  readonly operationalBoundarySource:
    | "sync_state"
    | "source_evidence_log"
    | "none";
  readonly activeProjectInventory: readonly ActiveProjectInventoryRow[];
  readonly samplePerProject: number;
  readonly namedCaseMembershipId: string;
  readonly namedCaseVerification: MembershipComparison;
  readonly namedCaseDisplayAudit: NamedCaseDisplayAudit;
  readonly missingSalesforceMembershipIds: readonly string[];
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

function readDatabaseConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString =
    env.DATABASE_PUBLIC_URL ?? env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, WORKER_DATABASE_URL, or DATABASE_URL is required.",
    );
  }

  return connectionString;
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

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteSoqlLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function buildSqlInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSqlLiteral(value)).join(", ")})`;
}

function buildSoqlInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSoqlLiteral(value)).join(", ")})`;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function deriveLookupNameField(lookupField: string): string {
  if (lookupField.endsWith("__c")) {
    return `${lookupField.slice(0, -3)}__r.Name`;
  }

  if (lookupField.endsWith("Id")) {
    return `${lookupField.slice(0, -2)}.Name`;
  }

  return `${lookupField}.Name`;
}

function getPathValue(
  row: Record<string, unknown>,
  fieldName: string,
): unknown {
  let cursor: unknown = row;

  for (const segment of fieldName.split(".")) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

function getStringField(
  row: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = getPathValue(row, fieldName);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseIsoLikeDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? `${value}T00:00:00.000Z`
    : value.includes("T")
      ? value
      : value.includes(" ")
        ? value.replace(" ", "T")
        : value;
  const normalizedTimezone = normalized.replace(/([+-]\d{2})$/u, "$1:00");
  const parsed = new Date(normalizedTimezone);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function differenceInCalendarDays(
  leftIso: string,
  rightIso: string,
): number | null {
  const left = parseIsoLikeDate(leftIso);
  const right = parseIsoLikeDate(rightIso);

  if (left === null || right === null) {
    return null;
  }

  return Math.round(Math.abs(left.getTime() - right.getTime()) / oneDayMs);
}

function milestoneFromEventType(eventType: string): LifecycleMilestone | null {
  switch (eventType) {
    case "lifecycle.signed_up":
      return "signed_up";
    case "lifecycle.received_training":
      return "received_training";
    case "lifecycle.completed_training":
      return "completed_training";
    case "lifecycle.submitted_first_data":
      return "submitted_first_data";
    default:
      return null;
  }
}

function getMilestoneFieldValue(
  record: SalesforceMembershipRecord | undefined,
  milestone: LifecycleMilestone,
): string | null {
  if (record === undefined) {
    return null;
  }

  switch (milestone) {
    case "signed_up":
      return record.createdDate;
    case "received_training":
      return record.trainingSentDate;
    case "completed_training":
      return record.trainingCompletedDate;
    case "submitted_first_data":
      return record.firstSampleCollectedDate;
  }
}

function selectorLifecycleLabel(input: {
  readonly milestone: LifecycleMilestone;
  readonly projectName: string | null;
  readonly expeditionName: string | null;
}): string {
  const context = input.projectName ?? input.expeditionName;

  switch (input.milestone) {
    case "signed_up":
      return context === null ? "Signed up" : `Signed up for ${context}`;
    case "received_training":
      return context === null
        ? "Received training"
        : `Received training for ${context}`;
    case "completed_training":
      return context === null
        ? "Completed training"
        : `Completed training for ${context}`;
    case "submitted_first_data":
      return context === null
        ? "Submitted first data"
        : `Submitted first data for ${context}`;
  }
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "n/a";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatPercentNumber(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator === 0) {
    return null;
  }

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function formatGapPp(sfRate: number | null, dbRate: number | null): string {
  if (sfRate === null || dbRate === null) {
    return "n/a";
  }

  return `${(sfRate - dbRate).toFixed(1)}pp`;
}

function formatDeltaDays(deltaDays: number | null): string {
  return deltaDays === null ? "n/a" : `${String(deltaDays)}d`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|");
}

function csvEscape(value: string | number | boolean | null): string {
  if (value === null) {
    return "";
  }

  const serialized = String(value);
  if (
    serialized.includes(",") ||
    serialized.includes('"') ||
    serialized.includes("\n")
  ) {
    return `"${serialized.replaceAll('"', '""')}"`;
  }

  return serialized;
}

function buildMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const headerLine = `| ${headers.map(markdownEscape).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map(
    (row) => `| ${row.map(markdownEscape).join(" | ")} |`,
  );

  return [headerLine, separatorLine, ...bodyLines].join("\n");
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

async function loadActiveProjectInventory(
  sql: SqlRunner,
): Promise<readonly ActiveProjectInventoryRow[]> {
  return sql.unsafe<readonly ActiveProjectInventoryRow[]>(`
    select
      pd.project_id,
      pd.project_name,
      count(cm.salesforce_membership_id)::int as eligible_memberships
    from project_dimensions pd
    left join contact_memberships cm
      on cm.project_id = pd.project_id
      and cm.salesforce_membership_id is not null
    where pd.is_active = true
    group by pd.project_id, pd.project_name
    order by pd.project_name asc
  `);
}

async function loadActiveProjectSample(
  sql: SqlRunner,
  samplePerProject: number,
): Promise<readonly ActiveProjectSampleRow[]> {
  return sql.unsafe<readonly ActiveProjectSampleRow[]>(`
    with membership_base as (
      select distinct on (cm.salesforce_membership_id)
        cm.id as canonical_membership_row_id,
        cm.salesforce_membership_id,
        cm.contact_id as canonical_contact_id,
        c.display_name as canonical_contact_display_name,
        c.salesforce_contact_id as canonical_salesforce_contact_id,
        cm.project_id as canonical_project_id,
        pd.project_name as canonical_project_name,
        cm.updated_at
      from contact_memberships cm
      join contacts c
        on c.id = cm.contact_id
      join project_dimensions pd
        on pd.project_id = cm.project_id
      where pd.is_active = true
        and cm.salesforce_membership_id is not null
      order by cm.salesforce_membership_id, cm.updated_at desc, cm.id desc
    ),
    ranked as (
      select
        membership_base.*,
        row_number() over (
          partition by canonical_project_id
          order by random(), salesforce_membership_id
        )::int as project_sample_rank
      from membership_base
    )
    select
      canonical_membership_row_id,
      salesforce_membership_id,
      canonical_contact_id,
      canonical_contact_display_name,
      canonical_salesforce_contact_id,
      canonical_project_id,
      canonical_project_name,
      project_sample_rank
    from ranked
    where project_sample_rank <= ${String(samplePerProject)}
    order by canonical_project_name asc, project_sample_rank asc, salesforce_membership_id asc
  `);
}

async function loadNamedCaseDbContext(
  sql: SqlRunner,
  salesforceContactId: string,
  membershipId: string,
): Promise<NamedCaseDbContextRow | null> {
  const rows = await sql.unsafe<readonly NamedCaseDbContextRow[]>(`
    select
      c.id as contact_id,
      c.display_name,
      c.salesforce_contact_id,
      cm.id as membership_row_id,
      cm.project_id,
      pd.project_name
    from contacts c
    left join contact_memberships cm
      on cm.contact_id = c.id
      and cm.salesforce_membership_id = ${quoteSqlLiteral(membershipId)}
    left join project_dimensions pd
      on pd.project_id = cm.project_id
    where c.salesforce_contact_id = ${quoteSqlLiteral(salesforceContactId)}
    order by cm.updated_at desc nulls last, cm.id desc nulls last
    limit 1
  `);

  return rows[0] ?? null;
}

async function loadOperationalBoundary(
  sql: SqlRunner,
): Promise<OperationalBoundaryRow> {
  const rows = await sql.unsafe<readonly OperationalBoundaryRow[]>(`
    select
      (
        select min(coalesce(last_successful_at, created_at))::text
        from sync_state
        where scope = 'provider'
          and provider = 'salesforce'
          and job_type in ('historical_backfill', 'live_ingest')
          and status = 'succeeded'
      ) as first_successful_salesforce_sync_at,
      (
        select min(created_at)::text
        from source_evidence_log
        where provider = 'salesforce'
          and provider_record_type = 'lifecycle_milestone'
      ) as first_lifecycle_evidence_created_at
  `);

  return (
    rows[0] ?? {
      first_successful_salesforce_sync_at: null,
      first_lifecycle_evidence_created_at: null,
    }
  );
}

function mergeSelection(
  existing: MembershipSelection | undefined,
  input: Omit<MembershipSelection, "sampleSources"> & {
    readonly sampleSource: SampleSource;
  },
): MembershipSelection {
  if (existing === undefined) {
    return {
      membershipId: input.membershipId,
      canonicalMembershipRowId: input.canonicalMembershipRowId,
      canonicalContactId: input.canonicalContactId,
      canonicalContactDisplayName: input.canonicalContactDisplayName,
      canonicalSalesforceContactId: input.canonicalSalesforceContactId,
      canonicalProjectId: input.canonicalProjectId,
      canonicalProjectName: input.canonicalProjectName,
      projectSampleRank: input.projectSampleRank,
      sampleSources: new Set([input.sampleSource]),
    };
  }

  existing.sampleSources.add(input.sampleSource);
  existing.canonicalMembershipRowId ??= input.canonicalMembershipRowId;
  existing.canonicalContactId ??= input.canonicalContactId;
  existing.canonicalContactDisplayName ??= input.canonicalContactDisplayName;
  existing.canonicalSalesforceContactId ??= input.canonicalSalesforceContactId;
  existing.canonicalProjectId ??= input.canonicalProjectId;
  existing.canonicalProjectName ??= input.canonicalProjectName;
  existing.projectSampleRank ??= input.projectSampleRank;
  return existing;
}

async function lookupNamedCaseMembership(
  client: ReturnType<typeof createSalesforceApiClient>,
  config: SalesforceCaptureServiceConfig,
): Promise<SalesforceMembershipRecord> {
  const contactNameField = deriveLookupNameField(config.membershipContactField);
  const projectNameField = config.membershipProjectNameField;
  const fields = uniqueSortedStrings([
    "Id",
    "CreatedDate",
    "Date_Training_Sent__c",
    "Date_Training_Completed__c",
    "Date_First_Sample_Collected__c",
    config.membershipContactField,
    contactNameField,
    config.membershipProjectField,
    projectNameField,
  ]);

  const exactSoql = `SELECT ${fields.join(", ")} FROM ${config.membershipObjectName} WHERE ${contactNameField} = ${quoteSoqlLiteral(namedCaseContactName)} AND ${projectNameField} = ${quoteSoqlLiteral(namedCaseProjectName)}`;
  const exactRows = await client.queryAll(exactSoql);

  if (exactRows.length === 1) {
    return mapSalesforceMembershipRow(exactRows[0], config);
  }

  const fallbackProjectPredicates = [
    `${projectNameField} = ${quoteSoqlLiteral(namedCaseProjectName)}`,
    `${projectNameField} LIKE ${quoteSoqlLiteral(`${namedCaseProjectName}%`)}`,
    `${projectNameField} LIKE ${quoteSoqlLiteral("%Whitebark Pine OR WA 2025-2026%")}`,
  ];
  const fuzzySoql = `SELECT ${fields.join(", ")} FROM ${config.membershipObjectName} WHERE ${contactNameField} = ${quoteSoqlLiteral(namedCaseContactName)} AND (${fallbackProjectPredicates.join(" OR ")})`;
  const fuzzyRows = await client.queryAll(fuzzySoql);

  if (fuzzyRows.length === 1) {
    return mapSalesforceMembershipRow(fuzzyRows[0], config);
  }

  const candidates = fuzzyRows.map((row) => ({
    membershipId: getStringField(row, "Id"),
    contactName: getStringField(row, contactNameField),
    contactId: getStringField(row, config.membershipContactField),
    projectName: getStringField(row, projectNameField),
    projectId: getStringField(row, config.membershipProjectField),
  }));

  throw new Error(
    [
      `Unable to resolve named case for ${namedCaseContactName} / ${namedCaseProjectName}.`,
      `Exact matches: ${String(exactRows.length)}.`,
      `Fuzzy matches: ${String(fuzzyRows.length)}.`,
      `Candidates: ${JSON.stringify(candidates)}`,
    ].join(" "),
  );
}

function mapSalesforceMembershipRow(
  row: Record<string, unknown>,
  config: SalesforceCaptureServiceConfig,
): SalesforceMembershipRecord {
  const contactNameField = deriveLookupNameField(config.membershipContactField);

  return {
    membershipId: getStringField(row, "Id") ?? "unknown-membership",
    salesforceContactId: getStringField(row, config.membershipContactField),
    contactName: getStringField(row, contactNameField),
    projectId: getStringField(row, config.membershipProjectField),
    projectName: getStringField(row, config.membershipProjectNameField),
    createdDate: getStringField(row, "CreatedDate"),
    trainingSentDate: getStringField(row, "Date_Training_Sent__c"),
    trainingCompletedDate: getStringField(row, "Date_Training_Completed__c"),
    firstSampleCollectedDate: getStringField(
      row,
      "Date_First_Sample_Collected__c",
    ),
  };
}

async function loadSalesforceMembershipsByIds(
  client: ReturnType<typeof createSalesforceApiClient>,
  config: SalesforceCaptureServiceConfig,
  membershipIds: readonly string[],
): Promise<ReadonlyMap<string, SalesforceMembershipRecord>> {
  const records = new Map<string, SalesforceMembershipRecord>();
  const contactNameField = deriveLookupNameField(config.membershipContactField);
  const fields = uniqueSortedStrings([
    "Id",
    "CreatedDate",
    "Date_Training_Sent__c",
    "Date_Training_Completed__c",
    "Date_First_Sample_Collected__c",
    config.membershipContactField,
    contactNameField,
    config.membershipProjectField,
    config.membershipProjectNameField,
  ]);

  for (const chunk of chunkValues(membershipIds, 100)) {
    const soql = `SELECT ${fields.join(", ")} FROM ${config.membershipObjectName} WHERE Id IN ${buildSoqlInClause(chunk)}`;
    const rows = await client.queryAll(soql);

    for (const row of rows) {
      const record = mapSalesforceMembershipRow(row, config);
      records.set(record.membershipId, record);
    }
  }

  return records;
}

async function loadDbLifecycleEvents(
  sql: SqlRunner,
  membershipIds: readonly string[],
): Promise<readonly DbLifecycleEventRow[]> {
  const rows: DbLifecycleEventRow[] = [];

  for (const chunk of chunkValues(membershipIds, 200)) {
    const inClause = buildSqlInClause(chunk);
    const result = await sql.unsafe<readonly DbLifecycleEventRow[]>(`
      select
        split_part(se.provider_record_id, ':', 1) as salesforce_membership_id,
        cel.id as canonical_event_id,
        cel.contact_id,
        cel.event_type::text as event_type,
        cel.occurred_at::text as occurred_at,
        cel.source_evidence_id,
        se.provider_record_id,
        sec.project_id,
        sec.expedition_id,
        coalesce(pd.project_alias, pd.project_name) as rendered_project_name,
        ed.expedition_name as rendered_expedition_name,
        sec.source_field
      from canonical_event_ledger cel
      join source_evidence_log se
        on se.id = cel.source_evidence_id
      left join salesforce_event_context sec
        on sec.source_evidence_id = se.id
      left join project_dimensions pd
        on pd.project_id = sec.project_id
      left join expedition_dimensions ed
        on ed.expedition_id = sec.expedition_id
      where se.provider = 'salesforce'
        and se.provider_record_type = 'lifecycle_milestone'
        and split_part(se.provider_record_id, ':', 1) in ${inClause}
        and cel.event_type::text in (
          'lifecycle.signed_up',
          'lifecycle.received_training',
          'lifecycle.completed_training',
          'lifecycle.submitted_first_data'
        )
      order by salesforce_membership_id asc, cel.occurred_at asc, cel.id asc
    `);

    rows.push(...result);
  }

  return rows;
}

async function loadLifecycleTimelineRowsForContact(
  sql: SqlRunner,
  canonicalContactId: string,
): Promise<readonly LifecycleTimelineRow[]> {
  return sql.unsafe<readonly LifecycleTimelineRow[]>(`
    select
      ctp.id,
      ctp.canonical_event_id,
      ctp.occurred_at::text as occurred_at,
      ctp.sort_key,
      cel.event_type::text as event_type,
      coalesce(pd.project_alias, pd.project_name) as project_name,
      ed.expedition_name
    from contact_timeline_projection ctp
    join canonical_event_ledger cel
      on cel.id = ctp.canonical_event_id
    join source_evidence_log se
      on se.id = cel.source_evidence_id
    left join salesforce_event_context sec
      on sec.source_evidence_id = se.id
    left join project_dimensions pd
      on pd.project_id = sec.project_id
    left join expedition_dimensions ed
      on ed.expedition_id = sec.expedition_id
    where ctp.contact_id = ${quoteSqlLiteral(canonicalContactId)}
      and cel.event_type::text in (
        'lifecycle.signed_up',
        'lifecycle.received_training',
        'lifecycle.completed_training',
        'lifecycle.submitted_first_data'
      )
    order by ctp.sort_key asc
  `);
}

function selectBestDbEvent(
  sfOccurredAt: string | null,
  events: readonly DbLifecycleEventRow[],
): DbLifecycleEventRow | null {
  if (events.length === 0) {
    return null;
  }

  if (sfOccurredAt === null) {
    return events[0] ?? null;
  }

  const sfDate = parseIsoLikeDate(sfOccurredAt);

  if (sfDate === null) {
    return events[0] ?? null;
  }

  let winner = events[0] ?? null;
  let winnerDistance = Number.POSITIVE_INFINITY;

  for (const event of events) {
    const eventDate = parseIsoLikeDate(event.occurred_at);

    if (eventDate === null) {
      continue;
    }

    const distance = Math.abs(eventDate.getTime() - sfDate.getTime());
    if (distance < winnerDistance) {
      winner = event;
      winnerDistance = distance;
    }
  }

  return winner;
}

function buildMembershipComparisons(input: {
  readonly selections: readonly MembershipSelection[];
  readonly salesforceMembershipsById: ReadonlyMap<
    string,
    SalesforceMembershipRecord
  >;
  readonly dbLifecycleEvents: readonly DbLifecycleEventRow[];
  readonly operationalBoundaryAt: string | null;
}): readonly MembershipComparison[] {
  const dbEventsByMembershipId = new Map<string, DbLifecycleEventRow[]>();

  for (const event of input.dbLifecycleEvents) {
    const existing = dbEventsByMembershipId.get(event.salesforce_membership_id);

    if (existing === undefined) {
      dbEventsByMembershipId.set(event.salesforce_membership_id, [event]);
      continue;
    }

    existing.push(event);
  }

  const operationalBoundaryDate =
    input.operationalBoundaryAt === null
      ? null
      : parseIsoLikeDate(input.operationalBoundaryAt);

  return input.selections.map((selection) => {
    const salesforceRecord = input.salesforceMembershipsById.get(
      selection.membershipId,
    );
    const membershipEvents =
      dbEventsByMembershipId.get(selection.membershipId) ?? [];
    const milestoneComparisons = {} as Record<
      LifecycleMilestone,
      MilestoneComparison
    >;

    for (const milestone of lifecycleMilestones) {
      const sfOccurredAt = getMilestoneFieldValue(salesforceRecord, milestone);
      const matchingEvents = membershipEvents.filter(
        (event) => milestoneFromEventType(event.event_type) === milestone,
      );
      const bestMatch = selectBestDbEvent(sfOccurredAt, matchingEvents);
      const dateDeltaDays =
        sfOccurredAt !== null && bestMatch !== null
          ? differenceInCalendarDays(sfOccurredAt, bestMatch.occurred_at)
          : null;

      milestoneComparisons[milestone] = {
        milestone,
        sfOccurredAt,
        sfPresent: sfOccurredAt !== null,
        dbOccurredAts: matchingEvents.map((event) => event.occurred_at),
        dbPresent: matchingEvents.length > 0,
        bestDbOccurredAt: bestMatch?.occurred_at ?? null,
        dateDeltaDays,
        withinOneDay: dateDeltaDays === null ? null : dateDeltaDays <= 1,
        sourceEvidenceIds: matchingEvents.map(
          (event) => event.source_evidence_id,
        ),
      };
    }

    const sfAllFourNonNull = lifecycleMilestones.every(
      (milestone) => milestoneComparisons[milestone].sfPresent,
    );
    const dbAllFourPresent = lifecycleMilestones.every(
      (milestone) => milestoneComparisons[milestone].dbPresent,
    );
    const sfNonNullMilestoneCount = lifecycleMilestones.filter(
      (milestone) => milestoneComparisons[milestone].sfPresent,
    ).length;
    const dbPresentMilestoneCount = lifecycleMilestones.filter(
      (milestone) => milestoneComparisons[milestone].dbPresent,
    ).length;
    const matchedPresenceCount = lifecycleMilestones.filter((milestone) => {
      const comparison = milestoneComparisons[milestone];
      return comparison.sfPresent && comparison.dbPresent;
    }).length;
    const exactDateMatchCount = lifecycleMilestones.filter((milestone) => {
      const comparison = milestoneComparisons[milestone];
      return comparison.sfPresent && comparison.withinOneDay === true;
    }).length;
    const gapCount = lifecycleMilestones.filter((milestone) => {
      const comparison = milestoneComparisons[milestone];
      return comparison.sfPresent && !comparison.dbPresent;
    }).length;
    const unexpectedDbWithoutSfCount = lifecycleMilestones.filter(
      (milestone) => {
        const comparison = milestoneComparisons[milestone];
        return !comparison.sfPresent && comparison.dbPresent;
      },
    ).length;
    const createdDate = milestoneComparisons.signed_up.sfOccurredAt;
    const olderThanOperationalBoundary =
      createdDate === null || operationalBoundaryDate === null
        ? null
        : (parseIsoLikeDate(createdDate)?.getTime() ??
            Number.POSITIVE_INFINITY) < operationalBoundaryDate.getTime();

    return {
      membershipId: selection.membershipId,
      volunteerName:
        salesforceRecord?.contactName ??
        selection.canonicalContactDisplayName ??
        selection.canonicalSalesforceContactId ??
        "Unknown volunteer",
      salesforceContactId:
        salesforceRecord?.salesforceContactId ??
        selection.canonicalSalesforceContactId ??
        null,
      canonicalContactId: selection.canonicalContactId,
      projectName:
        salesforceRecord?.projectName ??
        selection.canonicalProjectName ??
        selection.canonicalProjectId ??
        "Unknown project",
      projectId:
        salesforceRecord?.projectId ?? selection.canonicalProjectId ?? null,
      canonicalProjectId: selection.canonicalProjectId,
      canonicalMembershipRowId: selection.canonicalMembershipRowId,
      sampleSources: Array.from(selection.sampleSources).sort(),
      sfRecordFound: salesforceRecord !== undefined,
      sfAllFourNonNull,
      dbAllFourPresent,
      sfNonNullMilestoneCount,
      dbPresentMilestoneCount,
      matchedPresenceCount,
      exactDateMatchCount,
      gapCount,
      unexpectedDbWithoutSfCount,
      olderThanOperationalBoundary,
      milestoneComparisons,
    };
  });
}

function buildMilestoneSummaries(
  comparisonRows: readonly MembershipComparison[],
): readonly AggregateMilestoneStats[] {
  return lifecycleMilestones.map((milestone) => {
    const summary: AggregateMilestoneStats = {
      milestone,
      sampledMembershipCount: comparisonRows.length,
      sfPresentCount: 0,
      dbPresentCount: 0,
      exactDateMatchCount: 0,
      gapCount: 0,
      unexpectedDbWithoutSfCount: 0,
    };

    for (const row of comparisonRows) {
      const comparison = row.milestoneComparisons[milestone];

      if (comparison.sfPresent) {
        summary.sfPresentCount += 1;
      }

      if (comparison.dbPresent) {
        summary.dbPresentCount += 1;
      }

      if (
        comparison.sfPresent &&
        comparison.dbPresent &&
        comparison.withinOneDay
      ) {
        summary.exactDateMatchCount += 1;
      }

      if (comparison.sfPresent && !comparison.dbPresent) {
        summary.gapCount += 1;
      }

      if (!comparison.sfPresent && comparison.dbPresent) {
        summary.unexpectedDbWithoutSfCount += 1;
      }
    }

    return summary;
  });
}

function buildProjectSummaries(input: {
  readonly comparisonRows: readonly MembershipComparison[];
  readonly activeProjectInventory: readonly ActiveProjectInventoryRow[];
}): readonly ProjectSummary[] {
  const activeProjectById = new Map(
    input.activeProjectInventory.map((row) => [row.project_id, row]),
  );
  const projectRows = new Map<string, MembershipComparison[]>();

  for (const row of input.comparisonRows) {
    const projectKey =
      row.projectId ?? row.canonicalProjectId ?? `missing:${row.membershipId}`;
    const existing = projectRows.get(projectKey);

    if (existing === undefined) {
      projectRows.set(projectKey, [row]);
      continue;
    }

    existing.push(row);
  }

  const summaries: ProjectSummary[] = [];

  for (const inventoryRow of input.activeProjectInventory) {
    const rows = projectRows.get(inventoryRow.project_id) ?? [];
    const milestoneStats = {} as Record<
      LifecycleMilestone,
      AggregateMilestoneStats
    >;
    let sfNonNullMilestoneCount = 0;
    let matchedPresenceCount = 0;
    let exactDateMatchCount = 0;

    for (const milestone of lifecycleMilestones) {
      const stats: AggregateMilestoneStats = {
        milestone,
        sampledMembershipCount: rows.length,
        sfPresentCount: 0,
        dbPresentCount: 0,
        exactDateMatchCount: 0,
        gapCount: 0,
        unexpectedDbWithoutSfCount: 0,
      };

      for (const row of rows) {
        const comparison = row.milestoneComparisons[milestone];

        if (comparison.sfPresent) {
          stats.sfPresentCount += 1;
          sfNonNullMilestoneCount += 1;
        }

        if (comparison.dbPresent) {
          stats.dbPresentCount += 1;
        }

        if (comparison.sfPresent && comparison.dbPresent) {
          matchedPresenceCount += 1;
        }

        if (comparison.sfPresent && comparison.withinOneDay) {
          stats.exactDateMatchCount += 1;
          exactDateMatchCount += 1;
        }

        if (comparison.sfPresent && !comparison.dbPresent) {
          stats.gapCount += 1;
        }

        if (!comparison.sfPresent && comparison.dbPresent) {
          stats.unexpectedDbWithoutSfCount += 1;
        }
      }

      milestoneStats[milestone] = stats;
    }

    summaries.push({
      projectId: inventoryRow.project_id,
      projectName: inventoryRow.project_name,
      isActiveProjectBreadth: true,
      sampledMembershipCount: rows.length,
      eligibleMembershipCount: inventoryRow.eligible_memberships,
      overallCompletenessPercent: formatPercentNumber(
        matchedPresenceCount,
        sfNonNullMilestoneCount,
      ),
      overallExactMatchPercent: formatPercentNumber(
        exactDateMatchCount,
        sfNonNullMilestoneCount,
      ),
      milestoneStats,
    });
  }

  for (const [projectKey, rows] of projectRows.entries()) {
    if (
      rows.length === 0 ||
      activeProjectById.has(
        rows[0]?.projectId ?? rows[0]?.canonicalProjectId ?? "",
      )
    ) {
      continue;
    }

    const milestoneStats = {} as Record<
      LifecycleMilestone,
      AggregateMilestoneStats
    >;
    let sfNonNullMilestoneCount = 0;
    let matchedPresenceCount = 0;
    let exactDateMatchCount = 0;

    for (const milestone of lifecycleMilestones) {
      const stats: AggregateMilestoneStats = {
        milestone,
        sampledMembershipCount: rows.length,
        sfPresentCount: 0,
        dbPresentCount: 0,
        exactDateMatchCount: 0,
        gapCount: 0,
        unexpectedDbWithoutSfCount: 0,
      };

      for (const row of rows) {
        const comparison = row.milestoneComparisons[milestone];

        if (comparison.sfPresent) {
          stats.sfPresentCount += 1;
          sfNonNullMilestoneCount += 1;
        }

        if (comparison.dbPresent) {
          stats.dbPresentCount += 1;
        }

        if (comparison.sfPresent && comparison.dbPresent) {
          matchedPresenceCount += 1;
        }

        if (comparison.sfPresent && comparison.withinOneDay) {
          stats.exactDateMatchCount += 1;
          exactDateMatchCount += 1;
        }

        if (comparison.sfPresent && !comparison.dbPresent) {
          stats.gapCount += 1;
        }

        if (!comparison.sfPresent && comparison.dbPresent) {
          stats.unexpectedDbWithoutSfCount += 1;
        }
      }

      milestoneStats[milestone] = stats;
    }

    const firstRow = rows[0];

    summaries.push({
      projectId: firstRow.projectId ?? projectKey,
      projectName: firstRow.projectName,
      isActiveProjectBreadth: false,
      sampledMembershipCount: rows.length,
      eligibleMembershipCount: null,
      overallCompletenessPercent: formatPercentNumber(
        matchedPresenceCount,
        sfNonNullMilestoneCount,
      ),
      overallExactMatchPercent: formatPercentNumber(
        exactDateMatchCount,
        sfNonNullMilestoneCount,
      ),
      milestoneStats,
    });
  }

  return summaries.sort((left, right) =>
    left.projectName.localeCompare(right.projectName),
  );
}

function buildContactSummaries(
  comparisonRows: readonly MembershipComparison[],
): readonly ContactSummary[] {
  const grouped = new Map<string, MembershipComparison[]>();

  for (const row of comparisonRows) {
    const key =
      row.canonicalContactId ?? row.salesforceContactId ?? row.volunteerName;
    const existing = grouped.get(key);

    if (existing === undefined) {
      grouped.set(key, [row]);
      continue;
    }

    existing.push(row);
  }

  const summaries: ContactSummary[] = [];

  for (const rows of grouped.values()) {
    const firstRow = rows[0];
    const sfNonNullMilestoneCount = rows.reduce(
      (sum, row) => sum + row.sfNonNullMilestoneCount,
      0,
    );
    const dbPresentMilestoneCount = rows.reduce(
      (sum, row) => sum + row.matchedPresenceCount,
      0,
    );
    const gapCount = rows.reduce((sum, row) => sum + row.gapCount, 0);

    summaries.push({
      canonicalContactId: firstRow.canonicalContactId,
      salesforceContactId: firstRow.salesforceContactId,
      volunteerName: firstRow.volunteerName,
      sampledMembershipCount: rows.length,
      sfNonNullMilestoneCount,
      dbPresentMilestoneCount,
      gapCount,
      completenessPercent: formatPercentNumber(
        dbPresentMilestoneCount,
        sfNonNullMilestoneCount,
      ),
    });
  }

  return summaries.sort((left, right) => {
    if (right.gapCount !== left.gapCount) {
      return right.gapCount - left.gapCount;
    }

    return left.volunteerName.localeCompare(right.volunteerName);
  });
}

function buildRecentActivityLikeSelector(
  timelineRows: readonly LifecycleTimelineRow[],
): readonly NamedCaseRecentActivityRow[] {
  return timelineRows
    .slice()
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    .slice(0, 5)
    .map((row) => {
      const milestone = milestoneFromEventType(row.event_type);

      if (milestone === null) {
        throw new Error(
          `Unexpected lifecycle event type in timeline rows: ${row.event_type}`,
        );
      }

      return {
        id: row.id,
        label: selectorLifecycleLabel({
          milestone,
          projectName: row.project_name,
          expeditionName: row.expedition_name,
        }),
        occurredAt: row.occurred_at,
      };
    });
}

function findMatchingTimelineEvent(
  expected: NamedCaseDisplayEvent,
  timelineEvents: readonly NamedCaseDisplayEvent[],
): NamedCaseDisplayEvent | null {
  for (const event of timelineEvents) {
    if (event.milestone !== expected.milestone) {
      continue;
    }

    if (event.label !== expected.label) {
      continue;
    }

    const deltaDays = differenceInCalendarDays(
      expected.occurredAt,
      event.occurredAt,
    );

    if (deltaDays !== null && deltaDays <= 1) {
      return event;
    }
  }

  return null;
}

async function buildNamedCaseDisplayAudit(input: {
  readonly namedCaseVerification: MembershipComparison;
  readonly namedCaseMembershipId: string;
  readonly dbLifecycleEvents: readonly DbLifecycleEventRow[];
  readonly sql: SqlRunner;
}): Promise<NamedCaseDisplayAudit> {
  if (input.namedCaseVerification.canonicalContactId === null) {
    return {
      canEvaluate: false,
      reason:
        "Named case canonical contact id was not found in Postgres, so the timeline selector path could not be evaluated.",
      rawDbLifecycleEvents: [],
      timelineLifecycleEvents: [],
      recentActivityRows: [],
      missingFromTimeline: [],
      missingFromRecentActivity: [],
      totalContactLifecycleEvents: 0,
    };
  }

  const rawDbLifecycleEvents = input.dbLifecycleEvents
    .filter(
      (event) => event.salesforce_membership_id === input.namedCaseMembershipId,
    )
    .map((event) => {
      const milestone = milestoneFromEventType(event.event_type);

      if (milestone === null) {
        throw new Error(
          `Unexpected lifecycle event type for named case: ${event.event_type}`,
        );
      }

      return {
        milestone,
        occurredAt: event.occurred_at,
        label: selectorLifecycleLabel({
          milestone,
          projectName: event.rendered_project_name,
          expeditionName: event.rendered_expedition_name,
        }),
        sourceEvidenceId: event.source_evidence_id,
      };
    });

  const timelineRows = await loadLifecycleTimelineRowsForContact(
    input.sql,
    input.namedCaseVerification.canonicalContactId,
  );
  const timelineLifecycleEvents = timelineRows.map((row) => {
    const milestone = milestoneFromEventType(row.event_type);

    if (milestone === null) {
      throw new Error(
        `Unexpected lifecycle event type in timeline rows: ${row.event_type}`,
      );
    }

    return {
      milestone,
      occurredAt: row.occurred_at,
      label: selectorLifecycleLabel({
        milestone,
        projectName: row.project_name,
        expeditionName: row.expedition_name,
      }),
      sourceEvidenceId: row.canonical_event_id,
    };
  });
  const recentActivityRows = buildRecentActivityLikeSelector(timelineRows);
  const missingFromTimeline: LifecycleMilestone[] = [];
  const missingFromRecentActivity: LifecycleMilestone[] = [];

  for (const expected of rawDbLifecycleEvents) {
    if (findMatchingTimelineEvent(expected, timelineLifecycleEvents) === null) {
      missingFromTimeline.push(expected.milestone);
      continue;
    }

    const isInRecentActivity = recentActivityRows.some((row) => {
      if (row.label !== expected.label) {
        return false;
      }

      const deltaDays = differenceInCalendarDays(
        expected.occurredAt,
        row.occurredAt,
      );
      return deltaDays !== null && deltaDays <= 1;
    });

    if (!isInRecentActivity) {
      missingFromRecentActivity.push(expected.milestone);
    }
  }

  return {
    canEvaluate: true,
    reason: null,
    rawDbLifecycleEvents,
    timelineLifecycleEvents,
    recentActivityRows,
    missingFromTimeline,
    missingFromRecentActivity,
    totalContactLifecycleEvents: timelineRows.length,
  };
}

function buildCsv(comparisonRows: readonly MembershipComparison[]): string {
  const headers = [
    "membership_id",
    "sample_sources",
    "volunteer_name",
    "salesforce_contact_id",
    "canonical_contact_id",
    "project_name",
    "project_id",
    "canonical_project_id",
    "canonical_membership_row_id",
    "sf_record_found",
    "sf_all_four_non_null",
    "db_all_four_present",
    "sf_non_null_milestone_count",
    "db_present_milestone_count",
    "matched_presence_count",
    "exact_date_match_count",
    "gap_count",
    "unexpected_db_without_sf_count",
    "older_than_operational_boundary",
  ];

  for (const milestone of lifecycleMilestones) {
    headers.push(`${milestone}_sf_occurred_at`);
    headers.push(`${milestone}_sf_present`);
    headers.push(`${milestone}_db_present`);
    headers.push(`${milestone}_db_best_occurred_at`);
    headers.push(`${milestone}_db_occurred_ats`);
    headers.push(`${milestone}_date_delta_days`);
    headers.push(`${milestone}_within_one_day`);
    headers.push(`${milestone}_source_evidence_ids`);
  }

  const lines = [headers.map(csvEscape).join(",")];

  for (const row of comparisonRows) {
    const values: (string | number | boolean | null)[] = [
      row.membershipId,
      row.sampleSources.join("|"),
      row.volunteerName,
      row.salesforceContactId,
      row.canonicalContactId,
      row.projectName,
      row.projectId,
      row.canonicalProjectId,
      row.canonicalMembershipRowId,
      row.sfRecordFound,
      row.sfAllFourNonNull,
      row.dbAllFourPresent,
      row.sfNonNullMilestoneCount,
      row.dbPresentMilestoneCount,
      row.matchedPresenceCount,
      row.exactDateMatchCount,
      row.gapCount,
      row.unexpectedDbWithoutSfCount,
      row.olderThanOperationalBoundary,
    ];

    for (const milestone of lifecycleMilestones) {
      const comparison = row.milestoneComparisons[milestone];
      values.push(comparison.sfOccurredAt);
      values.push(comparison.sfPresent);
      values.push(comparison.dbPresent);
      values.push(comparison.bestDbOccurredAt);
      values.push(comparison.dbOccurredAts.join("|"));
      values.push(comparison.dateDeltaDays);
      values.push(comparison.withinOneDay);
      values.push(comparison.sourceEvidenceIds.join("|"));
    }

    lines.push(values.map(csvEscape).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function buildTopLineSummary(result: InvestigationResult): string {
  const comparisonRows = result.comparisonRows;
  const sampleSize = comparisonRows.length;
  const membershipsWithSfAllFour = comparisonRows.filter(
    (row) => row.sfAllFourNonNull,
  ).length;
  const membershipsWithDbAllFour = comparisonRows.filter(
    (row) => row.dbAllFourPresent,
  ).length;
  const totalSfNonNullMilestones = comparisonRows.reduce(
    (sum, row) => sum + row.sfNonNullMilestoneCount,
    0,
  );
  const totalDbMatchedMilestones = comparisonRows.reduce(
    (sum, row) => sum + row.matchedPresenceCount,
    0,
  );
  const totalExactDateMatches = comparisonRows.reduce(
    (sum, row) => sum + row.exactDateMatchCount,
    0,
  );
  const activeProjectCount = result.activeProjectInventory.length;
  const activeProjectsWithoutEligibleMemberships =
    result.activeProjectInventory.filter(
      (row) => row.eligible_memberships === 0,
    ).length;
  const missingSfRows = result.missingSalesforceMembershipIds.length;

  const lines = [
    `- Sampled memberships: ${String(sampleSize)} total (${String(activeProjectCount)} active projects in breadth sample, ${String(activeProjectsWithoutEligibleMemberships)} with 0 sampleable memberships carrying \`salesforce_membership_id\`).`,
    `- Memberships where SF has all 4 lifecycle dates non-null: ${String(membershipsWithSfAllFour)}.`,
    `- Memberships where DB has all 4 lifecycle events present: ${String(membershipsWithDbAllFour)}.`,
    `- Overall lifecycle completeness: ${String(totalDbMatchedMilestones)}/${String(totalSfNonNullMilestones)} SF-non-null milestone slots have DB events (${formatPercent(totalDbMatchedMilestones, totalSfNonNullMilestones)}).`,
    `- Exact date agreement within 1 day: ${String(totalExactDateMatches)}/${String(totalSfNonNullMilestones)} SF-non-null milestone slots (${formatPercent(totalExactDateMatches, totalSfNonNullMilestones)}).`,
  ];

  if (result.operationalBoundaryAt !== null) {
    lines.push(
      `- D.3 boundary used for age-split analysis: ${result.operationalBoundaryAt} (source: \`${result.operationalBoundarySource}\`).`,
    );
  }

  if (missingSfRows > 0) {
    lines.push(
      `- Sampled membership ids missing from Salesforce lookup: ${String(missingSfRows)} (${result.missingSalesforceMembershipIds.join(", ")}).`,
    );
  }

  return lines.join("\n");
}

function milestoneCell(comparison: MilestoneComparison): string {
  if (!comparison.sfPresent && !comparison.dbPresent) {
    return "SF:- DB:-";
  }

  if (comparison.sfPresent && !comparison.dbPresent) {
    return "SF:Y DB:-";
  }

  if (!comparison.sfPresent && comparison.dbPresent) {
    return "SF:- DB:Y";
  }

  return `SF:Y DB:Y delta:${formatDeltaDays(comparison.dateDeltaDays)}`;
}

function buildPerMembershipSection(result: InvestigationResult): string {
  const namedCaseId = result.namedCaseMembershipId;
  const selectedRows = result.comparisonRows
    .slice()
    .sort((left, right) => {
      if (left.membershipId === namedCaseId) {
        return -1;
      }

      if (right.membershipId === namedCaseId) {
        return 1;
      }

      if (right.gapCount !== left.gapCount) {
        return right.gapCount - left.gapCount;
      }

      return left.projectName.localeCompare(right.projectName);
    })
    .slice(0, 20);

  const membershipTable = buildMarkdownTable(
    [
      "Volunteer",
      "Project",
      "Membership",
      "Signed up",
      "Received training",
      "Completed training",
      "Submitted first data",
    ],
    selectedRows.map((row) => [
      `${row.volunteerName} (${row.salesforceContactId ?? "no-sf-contact-id"})`,
      `${row.projectName} (${row.projectId ?? "no-project-id"})`,
      row.membershipId,
      milestoneCell(row.milestoneComparisons.signed_up),
      milestoneCell(row.milestoneComparisons.received_training),
      milestoneCell(row.milestoneComparisons.completed_training),
      milestoneCell(row.milestoneComparisons.submitted_first_data),
    ]),
  );

  const contactSummaryTable = buildMarkdownTable(
    [
      "Volunteer",
      "Sampled memberships",
      "SF non-null slots",
      "DB present slots",
      "Gap slots",
      "Completeness",
    ],
    result.contactSummaries
      .slice(0, 12)
      .map((row) => [
        `${row.volunteerName} (${row.salesforceContactId ?? row.canonicalContactId ?? "no-id"})`,
        String(row.sampledMembershipCount),
        String(row.sfNonNullMilestoneCount),
        String(row.dbPresentMilestoneCount),
        String(row.gapCount),
        row.completenessPercent === null
          ? "n/a"
          : `${row.completenessPercent.toFixed(1)}%`,
      ]),
  );

  return [
    `Subset shown below; full raw comparison is in \`${outputCsvPath}\`.`,
    "",
    membershipTable,
    "",
    "Contact gap summary:",
    "",
    contactSummaryTable,
  ].join("\n");
}

function buildPerProjectSection(result: InvestigationResult): string {
  return buildMarkdownTable(
    [
      "Project",
      "Sampled",
      "Signed up",
      "Received training",
      "Completed training",
      "Submitted first data",
      "Overall completeness",
    ],
    result.projectSummaries.map((summary) => {
      const renderMilestone = (milestone: LifecycleMilestone): string => {
        const stats = summary.milestoneStats[milestone];
        const sfRate = formatPercentNumber(
          stats.sfPresentCount,
          summary.sampledMembershipCount,
        );
        const dbRate = formatPercentNumber(
          stats.dbPresentCount,
          summary.sampledMembershipCount,
        );

        return `SF ${sfRate === null ? "n/a" : `${sfRate.toFixed(1)}%`} / DB ${dbRate === null ? "n/a" : `${dbRate.toFixed(1)}%`} / gap ${formatGapPp(sfRate, dbRate)}`;
      };

      return [
        summary.isActiveProjectBreadth
          ? `${summary.projectName} (${summary.projectId})`
          : `${summary.projectName} (${summary.projectId}, named-case only)`,
        String(summary.sampledMembershipCount),
        renderMilestone("signed_up"),
        renderMilestone("received_training"),
        renderMilestone("completed_training"),
        renderMilestone("submitted_first_data"),
        summary.overallCompletenessPercent === null
          ? "n/a"
          : `${summary.overallCompletenessPercent.toFixed(1)}% (${summary.overallExactMatchPercent?.toFixed(1) ?? "n/a"}% exact <=1d)`,
      ];
    }),
  );
}

function buildPerMilestoneSection(result: InvestigationResult): string {
  return buildMarkdownTable(
    [
      "Milestone",
      "Total SF non-null count",
      "Total DB present count",
      "Gap count",
      "Gap %",
      "Exact <=1d",
      "Unexpected DB when SF null",
    ],
    result.milestoneSummaries.map((summary) => [
      summary.milestone,
      String(summary.sfPresentCount),
      String(summary.dbPresentCount),
      String(summary.gapCount),
      formatPercent(summary.gapCount, summary.sfPresentCount),
      formatPercent(summary.exactDateMatchCount, summary.sfPresentCount),
      String(summary.unexpectedDbWithoutSfCount),
    ]),
  );
}

function buildHypothesisSection(result: InvestigationResult): string {
  const milestoneById = new Map(
    result.milestoneSummaries.map((summary) => [summary.milestone, summary]),
  );
  const preBoundaryRows = result.comparisonRows.filter(
    (row) => row.olderThanOperationalBoundary === true,
  );
  const postBoundaryRows = result.comparisonRows.filter(
    (row) => row.olderThanOperationalBoundary === false,
  );
  const preBoundarySfSlots = preBoundaryRows.reduce(
    (sum, row) => sum + row.sfNonNullMilestoneCount,
    0,
  );
  const preBoundaryDbSlots = preBoundaryRows.reduce(
    (sum, row) => sum + row.matchedPresenceCount,
    0,
  );
  const postBoundarySfSlots = postBoundaryRows.reduce(
    (sum, row) => sum + row.sfNonNullMilestoneCount,
    0,
  );
  const postBoundaryDbSlots = postBoundaryRows.reduce(
    (sum, row) => sum + row.matchedPresenceCount,
    0,
  );
  const preBoundaryCompleteness = formatPercentNumber(
    preBoundaryDbSlots,
    preBoundarySfSlots,
  );
  const postBoundaryCompleteness = formatPercentNumber(
    postBoundaryDbSlots,
    postBoundarySfSlots,
  );
  const projectCompletenessValues = result.projectSummaries
    .map((summary) => summary.overallCompletenessPercent)
    .filter((value): value is number => value !== null);
  const projectSpread =
    projectCompletenessValues.length === 0
      ? null
      : Number(
          (
            Math.max(...projectCompletenessValues) -
            Math.min(...projectCompletenessValues)
          ).toFixed(1),
        );
  const zeroCompletenessProjects = result.projectSummaries.filter(
    (summary) =>
      summary.sampledMembershipCount > 0 &&
      summary.overallCompletenessPercent !== null &&
      summary.overallCompletenessPercent === 0,
  );
  const lowCompletenessProjects = result.projectSummaries.filter(
    (summary) =>
      summary.sampledMembershipCount > 0 &&
      summary.overallCompletenessPercent !== null &&
      summary.overallCompletenessPercent <= 40,
  );
  const highCompletenessProjects = result.projectSummaries.filter(
    (summary) =>
      summary.sampledMembershipCount > 0 &&
      summary.overallCompletenessPercent !== null &&
      summary.overallCompletenessPercent >= 75,
  );
  const milestoneWithSevereGap = result.milestoneSummaries.find(
    (summary) =>
      summary.sfPresentCount > 0 && summary.gapCount === summary.sfPresentCount,
  );
  const milestoneWithHighGap = result.milestoneSummaries.find((summary) => {
    if (summary.sfPresentCount < 5) {
      return false;
    }

    return summary.gapCount / summary.sfPresentCount >= 0.8;
  });
  const displayAudit = result.namedCaseDisplayAudit;

  const d1Lines: string[] = [];
  for (const milestone of lifecycleMilestones) {
    const stats = milestoneById.get(milestone);

    if (stats === undefined) {
      continue;
    }

    const nullCount = stats.sampledMembershipCount - stats.sfPresentCount;
    d1Lines.push(
      `${milestone}: ${String(nullCount)}/${String(stats.sampledMembershipCount)} sampled memberships have NULL in SF (${formatPercent(nullCount, stats.sampledMembershipCount)}).`,
    );
  }

  const d2Status =
    milestoneWithSevereGap !== undefined
      ? "supported"
      : milestoneWithHighGap !== undefined
        ? "inconclusive"
        : "not supported";
  const d3Status =
    preBoundaryCompleteness !== null &&
    postBoundaryCompleteness !== null &&
    preBoundarySfSlots >= 8 &&
    postBoundarySfSlots >= 8 &&
    postBoundaryCompleteness - preBoundaryCompleteness >= 20
      ? "supported"
      : preBoundaryCompleteness === null || postBoundaryCompleteness === null
        ? "inconclusive"
        : "not supported";
  const d4Status =
    projectSpread !== null &&
    projectSpread >= 30 &&
    lowCompletenessProjects.length > 0 &&
    highCompletenessProjects.length > 0
      ? "supported"
      : projectSpread === null
        ? "inconclusive"
        : "not supported";
  const d5Status = !displayAudit.canEvaluate
    ? "inconclusive"
    : displayAudit.rawDbLifecycleEvents.length === 0
      ? "not supported"
      : displayAudit.missingFromTimeline.length > 0 ||
          displayAudit.missingFromRecentActivity.length > 0
        ? "supported"
        : "not supported";

  const fixOptions: string[] = [];

  if (d2Status === "supported" || d4Status === "supported") {
    fixOptions.push(
      "- `F.1 Backfill missing lifecycle events.` Pros: closes the historical gap retroactively. Cons: needs a replay/backfill operation and depends on safe dedupe.",
    );
  }

  if (d2Status === "supported") {
    fixOptions.push(
      "- `F.2 Fix ingest mapping bug.` Pros: fixes future ingest at the mapper/provider boundary. Cons: does not repair historical gaps without a backfill.",
    );
  }

  if (d3Status === "supported") {
    if (!fixOptions.some((line) => line.includes("F.1"))) {
      fixOptions.push(
        "- `F.1 Backfill missing lifecycle events.` Pros: closes the historical gap retroactively. Cons: needs a replay/backfill operation and depends on safe dedupe.",
      );
    }
    fixOptions.push(
      "- `F.3 Widen time-window filter.` Pros: lets older memberships ingest going forward or during replay. Cons: replay cost and duplicate-event risk if dedupe is wrong.",
    );
  }

  if (d5Status === "supported") {
    fixOptions.push(
      "- `F.4 Fix display grouping.` Pros: repairs the operator-visible rail without touching ingest. Cons: only fixes the surface if underlying canonical data is already complete.",
    );
  }

  if (d4Status === "supported") {
    fixOptions.push(
      "- Per-project exclusion is supported by the data, but no pre-listed `F.2-F.4` option maps exactly to a project-specific capture/filter bug. If Nico approves phase 2, that would need a targeted filter/query fix plus any needed `F.1` backfill.",
    );
  }

  return [
    `- D.1 SF source data legitimately NULL: supported baseline. ${d1Lines.join(" ")}`,
    milestoneWithSevereGap !== undefined
      ? `- D.2 Ingest mapping drops specific milestone types: supported. ${milestoneWithSevereGap.milestone} is 0/${String(milestoneWithSevereGap.sfPresentCount)} in DB despite non-null SF dates, which is consistent with a milestone-type drop.`
      : milestoneWithHighGap !== undefined
        ? `- D.2 Ingest mapping drops specific milestone types: inconclusive. ${milestoneWithHighGap.milestone} shows a high gap (${String(milestoneWithHighGap.gapCount)}/${String(milestoneWithHighGap.sfPresentCount)} missing), but the sample alone does not isolate mapping from age/project effects.`
        : "- D.2 Ingest mapping drops specific milestone types: not supported. No milestone is universally absent from DB when present in SF.",
    result.operationalBoundaryAt === null
      ? "- D.3 Time-window filter misses older memberships: inconclusive. No operational boundary could be derived from `sync_state` or persisted lifecycle evidence."
      : `- D.3 Time-window filter misses older memberships: ${d3Status}. Using ${result.operationalBoundaryAt} as the operational boundary (${result.operationalBoundarySource}), pre-boundary completeness is ${preBoundaryCompleteness === null ? "n/a" : `${preBoundaryCompleteness.toFixed(1)}%`} (${String(preBoundaryDbSlots)}/${String(preBoundarySfSlots)} slots) vs post-boundary ${postBoundaryCompleteness === null ? "n/a" : `${postBoundaryCompleteness.toFixed(1)}%`} (${String(postBoundaryDbSlots)}/${String(postBoundarySfSlots)} slots).`,
    projectSpread === null
      ? "- D.4 Per-project filter excludes certain project types: inconclusive. No sampled project carried enough SF-non-null lifecycle data to measure cross-project variation."
      : `- D.4 Per-project filter excludes certain project types: ${d4Status}. Project completeness ranges from ${projectCompletenessValues.length === 0 ? "n/a" : `${Math.min(...projectCompletenessValues).toFixed(1)}%`} to ${projectCompletenessValues.length === 0 ? "n/a" : `${Math.max(...projectCompletenessValues).toFixed(1)}%`} (spread ${projectSpread.toFixed(1)}pp). Low-completeness sampled projects (<=40%): ${lowCompletenessProjects.length === 0 ? "none" : lowCompletenessProjects.map((summary) => `${summary.projectName} (${summary.overallCompletenessPercent?.toFixed(1)}%)`).join(", ")}. High-completeness sampled projects (>=75%): ${highCompletenessProjects.length === 0 ? "none" : highCompletenessProjects.map((summary) => `${summary.projectName} (${summary.overallCompletenessPercent?.toFixed(1)}%)`).join(", ")}. Zero-completeness sampled projects: ${zeroCompletenessProjects.length === 0 ? "none" : zeroCompletenessProjects.map((summary) => summary.projectName).join(", ")}.`,
    !displayAudit.canEvaluate
      ? `- D.5 Display grouping filters out events that are in DB: inconclusive. ${displayAudit.reason}`
      : `- D.5 Display grouping filters out events that are in DB: ${d5Status}. Named case raw DB lifecycle events for the membership: ${String(displayAudit.rawDbLifecycleEvents.length)}. Total lifecycle items in the contact timeline: ${String(displayAudit.timelineLifecycleEvents.length)}. Matching milestones missing from full timeline: ${displayAudit.missingFromTimeline.length === 0 ? "none" : displayAudit.missingFromTimeline.join(", ")}. Matching milestones present in timeline but absent from right-rail recent activity: ${displayAudit.missingFromRecentActivity.length === 0 ? "none" : displayAudit.missingFromRecentActivity.join(", ")}. Total contact lifecycle items feeding the selector: ${String(displayAudit.totalContactLifecycleEvents)}.`,
    "",
    "Phase-2 options to evaluate later only if Nico signs off in the PR thread:",
    ...(fixOptions.length > 0
      ? fixOptions
      : [
          "- No phase-2 fix options are enumerated yet because the current evidence does not confirm a concrete fixable hypothesis beyond expected SF NULL baselines.",
        ]),
  ].join("\n");
}

function buildNamedCaseSection(result: InvestigationResult): string {
  const namedCase = result.namedCaseVerification;
  const milestoneLines = lifecycleMilestones.map((milestone) => {
    const comparison = namedCase.milestoneComparisons[milestone];

    return `- ${milestone}: SF ${comparison.sfPresent ? comparison.sfOccurredAt : "NULL"} / DB ${comparison.dbPresent ? comparison.dbOccurredAts.join(", ") : "missing"} / delta ${formatDeltaDays(comparison.dateDeltaDays)}.`;
  });
  const displayAudit = result.namedCaseDisplayAudit;
  const recentActivityPreview =
    displayAudit.recentActivityRows.length === 0
      ? "none"
      : displayAudit.recentActivityRows
          .map((row) => `${row.label} @ ${row.occurredAt}`)
          .join("; ");

  return [
    `- Membership: ${namedCase.membershipId}`,
    `- Volunteer: ${namedCase.volunteerName} (${namedCase.salesforceContactId ?? "no-sf-contact-id"} / canonical ${namedCase.canonicalContactId ?? "missing"})`,
    `- Project: ${namedCase.projectName} (${namedCase.projectId ?? "no-project-id"})`,
    ...milestoneLines,
    displayAudit.canEvaluate
      ? `- Right-rail selector replica produced ${String(displayAudit.recentActivityRows.length)} recent lifecycle rows for the contact. Preview: ${recentActivityPreview}`
      : `- Right-rail selector replica could not be evaluated: ${displayAudit.reason}`,
    displayAudit.canEvaluate
      ? `- Screenshot alignment: ${displayAudit.missingFromRecentActivity.length > 0 ? "the screenshot showing only 'Completed training' is consistent with a display-side omission on top of the underlying data." : namedCase.gapCount > 0 ? "the screenshot showing only 'Completed training' is consistent with underlying lifecycle-event incompleteness for this membership, not a selector-side omission." : "the current DB + selector replica does not reproduce the screenshot gap."}`
      : "- Screenshot alignment: inconclusive because the selector path could not be evaluated from the local DB context.",
  ].join("\n");
}

function buildMarkdownReport(result: InvestigationResult): string {
  return [
    "# Top-line summary",
    buildTopLineSummary(result),
    "",
    "# Per-membership comparison table",
    buildPerMembershipSection(result),
    "",
    "# Per-project summary table",
    buildPerProjectSection(result),
    "",
    "# Per-milestone-type summary table",
    buildPerMilestoneSection(result),
    "",
    "# Hypothesis confirmation",
    buildHypothesisSection(result),
    "",
    "# Verification of named case",
    buildNamedCaseSection(result),
  ].join("\n\n");
}

async function runInvestigation(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly samplePerProject: number;
}): Promise<InvestigationResult> {
  const salesforceConfig = readSalesforceCaptureConfig(input.env);
  const connection = createDatabaseConnection({
    connectionString: readDatabaseConnectionString(input.env),
  });
  const salesforceClient = createSalesforceApiClient(salesforceConfig);

  try {
    const sql = connection.sql as unknown as SqlRunner;
    const [
      activeProjectInventory,
      activeProjectSample,
      operationalBoundaryRow,
    ] = await Promise.all([
      loadActiveProjectInventory(sql),
      loadActiveProjectSample(sql, input.samplePerProject),
      loadOperationalBoundary(sql),
    ]);

    const namedCaseMembership = await lookupNamedCaseMembership(
      salesforceClient,
      salesforceConfig,
    );
    const namedCaseDbContext =
      namedCaseMembership.salesforceContactId === null
        ? null
        : await loadNamedCaseDbContext(
            sql,
            namedCaseMembership.salesforceContactId,
            namedCaseMembership.membershipId,
          );

    const selectionsByMembershipId = new Map<string, MembershipSelection>();

    for (const row of activeProjectSample) {
      const existing = selectionsByMembershipId.get(
        row.salesforce_membership_id,
      );

      selectionsByMembershipId.set(
        row.salesforce_membership_id,
        mergeSelection(existing, {
          membershipId: row.salesforce_membership_id,
          canonicalMembershipRowId: row.canonical_membership_row_id,
          canonicalContactId: row.canonical_contact_id,
          canonicalContactDisplayName: row.canonical_contact_display_name,
          canonicalSalesforceContactId: row.canonical_salesforce_contact_id,
          canonicalProjectId: row.canonical_project_id,
          canonicalProjectName: row.canonical_project_name,
          projectSampleRank: row.project_sample_rank,
          sampleSource: "active_project_sample",
        }),
      );
    }

    const existingNamedCase = selectionsByMembershipId.get(
      namedCaseMembership.membershipId,
    );
    selectionsByMembershipId.set(
      namedCaseMembership.membershipId,
      mergeSelection(existingNamedCase, {
        membershipId: namedCaseMembership.membershipId,
        canonicalMembershipRowId: namedCaseDbContext?.membership_row_id ?? null,
        canonicalContactId: namedCaseDbContext?.contact_id ?? null,
        canonicalContactDisplayName: namedCaseDbContext?.display_name ?? null,
        canonicalSalesforceContactId:
          namedCaseDbContext?.salesforce_contact_id ??
          namedCaseMembership.salesforceContactId,
        canonicalProjectId:
          namedCaseDbContext?.project_id ?? namedCaseMembership.projectId,
        canonicalProjectName:
          namedCaseDbContext?.project_name ?? namedCaseMembership.projectName,
        projectSampleRank: null,
        sampleSource: "named_case",
      }),
    );

    const selections = [...selectionsByMembershipId.values()].sort(
      (left, right) => left.membershipId.localeCompare(right.membershipId),
    );
    const membershipIds = selections.map((selection) => selection.membershipId);
    const salesforceMembershipsById = await loadSalesforceMembershipsByIds(
      salesforceClient,
      salesforceConfig,
      membershipIds,
    );
    const dbLifecycleEvents = await loadDbLifecycleEvents(sql, membershipIds);
    const operationalBoundaryAt =
      operationalBoundaryRow.first_successful_salesforce_sync_at ??
      operationalBoundaryRow.first_lifecycle_evidence_created_at;
    const operationalBoundarySource =
      operationalBoundaryRow.first_successful_salesforce_sync_at !== null
        ? "sync_state"
        : operationalBoundaryRow.first_lifecycle_evidence_created_at !== null
          ? "source_evidence_log"
          : "none";
    const comparisonRows = buildMembershipComparisons({
      selections,
      salesforceMembershipsById,
      dbLifecycleEvents,
      operationalBoundaryAt,
    });
    const projectSummaries = buildProjectSummaries({
      comparisonRows,
      activeProjectInventory,
    });
    const milestoneSummaries = buildMilestoneSummaries(comparisonRows);
    const contactSummaries = buildContactSummaries(comparisonRows);
    const namedCaseVerification = comparisonRows.find(
      (row) => row.membershipId === namedCaseMembership.membershipId,
    );

    if (namedCaseVerification === undefined) {
      throw new Error(
        `Named case membership ${namedCaseMembership.membershipId} did not survive comparison assembly.`,
      );
    }

    const namedCaseDisplayAudit = await buildNamedCaseDisplayAudit({
      namedCaseVerification,
      namedCaseMembershipId: namedCaseMembership.membershipId,
      dbLifecycleEvents,
      sql,
    });
    const missingSalesforceMembershipIds = membershipIds.filter(
      (membershipId) => !salesforceMembershipsById.has(membershipId),
    );

    return {
      comparisonRows,
      projectSummaries,
      milestoneSummaries,
      contactSummaries,
      operationalBoundaryAt,
      operationalBoundarySource,
      activeProjectInventory,
      samplePerProject: input.samplePerProject,
      namedCaseMembershipId: namedCaseMembership.membershipId,
      namedCaseVerification,
      namedCaseDisplayAudit,
      missingSalesforceMembershipIds,
    };
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      days: { type: "string" },
      "sample-per-project": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      [
        "Usage: pnpm tsx scripts/ops/diag-lifecycle-event-completeness.ts [--days 180] [--sample-per-project 5]",
        "",
        "--days is accepted only for compatibility with the composed Railway env pattern from investigation 3.1.",
        "This diagnostic intentionally does not apply any age filter to sampled memberships or to DB event comparison.",
      ].join("\n"),
    );
    return;
  }

  const samplePerProject =
    values["sample-per-project"] === undefined
      ? samplePerProjectDefault
      : Number.parseInt(values["sample-per-project"], 10);

  if (!Number.isInteger(samplePerProject) || samplePerProject <= 0) {
    throw new Error("--sample-per-project must be a positive integer.");
  }

  if (values.days !== undefined) {
    console.log(
      `Compatibility note: received --days ${values.days}; no membership/event time filter was applied by design for this investigation.`,
    );
  }

  const result = await runInvestigation({
    env: process.env,
    samplePerProject,
  });
  const csv = buildCsv(result.comparisonRows);
  await writeFile(outputCsvPath, csv, "utf8");

  console.log(`Wrote CSV artifact: ${outputCsvPath}`);
  console.log("");
  console.log(buildMarkdownReport(result));
}

void main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
