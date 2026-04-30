#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type DatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  type Stage1RepositoryBundle,
} from "@as-comms/domain";
import {
  createSalesforceApiClient,
  mapSalesforceContactSnapshot,
  normalizeEmail,
  normalizePhone,
  salesforceContactSnapshotRecordSchema,
  toIsoTimestamp,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";
import type {
  IdentityResolutionCase,
  NormalizedContactGraphUpsertInput,
} from "@as-comms/contracts";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";

const defaultProbeBatchSize = 200;
const defaultSampleLimit = 5;
const topContactLimit = 10;

export const stuckIdentityAnchorCountsSql = `WITH stuck AS (
  SELECT q.id AS queue_id,
         (regexp_match(q.explanation, 'Salesforce Contact ID ([A-Za-z0-9]+)'))[1] AS sf_contact_id,
         q.source_evidence_id,
         q.opened_at
  FROM identity_resolution_queue q
  JOIN source_evidence_log sel ON sel.id = q.source_evidence_id
  WHERE q.status = 'open'
    AND q.reason_code = 'identity_missing_anchor'
    AND sel.provider_record_type = 'task_communication'
)
SELECT sf_contact_id, COUNT(*) AS stuck_count
FROM stuck
WHERE sf_contact_id IS NOT NULL
GROUP BY sf_contact_id
ORDER BY stuck_count DESC;`;

const stuckIdentityAnchorCaseRowsSql = `WITH stuck AS (
  SELECT q.id AS queue_id,
         (regexp_match(q.explanation, 'Salesforce Contact ID ([A-Za-z0-9]+)'))[1] AS sf_contact_id,
         q.source_evidence_id,
         q.opened_at
  FROM identity_resolution_queue q
  JOIN source_evidence_log sel ON sel.id = q.source_evidence_id
  WHERE q.status = 'open'
    AND q.reason_code = 'identity_missing_anchor'
    AND sel.provider_record_type = 'task_communication'
)
SELECT queue_id, sf_contact_id, source_evidence_id, opened_at
FROM stuck
WHERE sf_contact_id IS NOT NULL
ORDER BY opened_at ASC, queue_id ASC;`;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface StuckCountRow {
  readonly sf_contact_id: string;
  readonly stuck_count: string | number;
}

interface StuckCaseRow {
  readonly queue_id: string;
  readonly sf_contact_id: string;
  readonly source_evidence_id: string;
  readonly opened_at: string;
}

export interface StuckIdentityAnchorTarget {
  readonly salesforceContactId: string;
  readonly stuckCount: number;
  readonly queueCaseIds: readonly string[];
  readonly sourceEvidenceIds: readonly string[];
  readonly oldestOpenedAt: string;
}

interface SalesforceMembershipProbeRow {
  readonly Id?: unknown;
  readonly Contact__c?: unknown;
  readonly Project__c?: unknown;
  readonly Expedition__c?: unknown;
  readonly Status__c?: unknown;
  readonly attributes?: unknown;
  readonly [key: string]: unknown;
}

interface SalesforceContactProbeSnapshot {
  readonly salesforceContactId: string;
  readonly graphInput: NormalizedContactGraphUpsertInput;
  readonly hasMemberships: boolean;
  readonly primaryEmail: string | null;
  readonly normalizedPhones: readonly string[];
}

export type BucketName = "A" | "B" | "C";

export interface BucketedIdentityAnchorTarget {
  readonly bucket: BucketName;
  readonly target: StuckIdentityAnchorTarget;
  readonly snapshot: SalesforceContactProbeSnapshot | null;
}

export interface BucketClassification {
  readonly bucketA: readonly BucketedIdentityAnchorTarget[];
  readonly bucketB: readonly BucketedIdentityAnchorTarget[];
  readonly bucketC: readonly BucketedIdentityAnchorTarget[];
}

interface ProbeConfig {
  readonly membershipObjectName: string;
  readonly membershipContactField: string;
  readonly membershipProjectField: string;
  readonly membershipProjectNameField: string;
  readonly membershipExpeditionField: string;
  readonly membershipExpeditionNameField: string;
  readonly membershipRoleField: string | null;
  readonly membershipStatusField: string;
}

interface ProcessTargetResult {
  readonly bucket: BucketName;
  readonly action:
    | "would_ingest"
    | "ingested"
    | "would_terminal_skip"
    | "terminal_skipped"
    | "noop_already_anchored"
    | "noop_cases_already_closed";
  readonly resolvedCaseCount: number;
}

interface ExecutionSummary {
  readonly bucketAIngested: number;
  readonly bucketANoOp: number;
  readonly bucketBIngested: number;
  readonly bucketBNoOp: number;
  readonly bucketCTerminalSkipped: number;
  readonly bucketCNoOp: number;
  readonly errorCount: number;
  readonly errors: readonly {
    readonly key: string;
    readonly salesforceContactId: string;
    readonly message: string;
  }[];
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value =
    env.WORKER_DATABASE_URL ?? env.DATABASE_URL ?? env.DATABASE_PUBLIC_URL;

  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, DATABASE_URL, or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return value.trim();
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
      30000,
    ),
  };
}

function readProbeConfig(env: NodeJS.ProcessEnv): ProbeConfig {
  return {
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
  };
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

function quoteSoqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function readRowStringField(
  row: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = fieldName.split(".").reduce<unknown>((current, part) => {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, row);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function fallbackDisplayName(input: {
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly salesforceContactId: string;
}): string {
  if (input.name !== null) {
    return input.name;
  }

  const parts = [input.firstName, input.lastName].filter(
    (value): value is string => value !== null,
  );

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return input.salesforceContactId;
}

export function buildContactProbeSoql(
  salesforceContactIds: readonly string[],
): string {
  return [
    "SELECT Id, Email, Phone, MobilePhone, FirstName, LastName, Name, CreatedDate, LastModifiedDate, Volunteer_ID_Plain__c",
    "FROM Contact",
    `WHERE Id IN (${salesforceContactIds.map((id) => quoteSoqlString(id)).join(", ")})`,
  ].join(" ");
}

export function buildMembershipProbeSoql(
  salesforceContactIds: readonly string[],
  config: ProbeConfig,
): string {
  const fields = [
    "Id",
    config.membershipContactField,
    config.membershipProjectField,
    config.membershipProjectNameField,
    config.membershipExpeditionField,
    config.membershipExpeditionNameField,
    ...(config.membershipRoleField === null ? [] : [config.membershipRoleField]),
    config.membershipStatusField,
  ];

  return [
    `SELECT ${fields.join(", ")}`,
    `FROM ${config.membershipObjectName}`,
    `WHERE ${config.membershipContactField} IN (${salesforceContactIds.map((id) => quoteSoqlString(id)).join(", ")})`,
    `AND ${config.membershipProjectField} != null`,
  ].join(" ");
}

export function classifyBucketedTargets(input: {
  readonly targets: readonly StuckIdentityAnchorTarget[];
  readonly snapshotsBySalesforceContactId: ReadonlyMap<
    string,
    SalesforceContactProbeSnapshot
  >;
}): BucketClassification {
  const bucketA: BucketedIdentityAnchorTarget[] = [];
  const bucketB: BucketedIdentityAnchorTarget[] = [];
  const bucketC: BucketedIdentityAnchorTarget[] = [];

  for (const target of input.targets) {
    const snapshot = input.snapshotsBySalesforceContactId.get(
      target.salesforceContactId,
    );

    if (snapshot === undefined) {
      bucketC.push({
        bucket: "C",
        target,
        snapshot: null,
      });
      continue;
    }

    if (snapshot.hasMemberships) {
      bucketA.push({
        bucket: "A",
        target,
        snapshot,
      });
      continue;
    }

    bucketB.push({
      bucket: "B",
      target,
      snapshot,
    });
  }

  return { bucketA, bucketB, bucketC };
}

async function loadStuckTargets(
  sql: SqlRunner,
): Promise<readonly StuckIdentityAnchorTarget[]> {
  const [countRows, caseRows] = await Promise.all([
    sql.unsafe<readonly StuckCountRow[]>(stuckIdentityAnchorCountsSql),
    sql.unsafe<readonly StuckCaseRow[]>(stuckIdentityAnchorCaseRowsSql),
  ]);
  const caseIdsByContactId = new Map<string, string[]>();
  const sourceEvidenceIdsByContactId = new Map<string, Set<string>>();
  const oldestOpenedAtByContactId = new Map<string, string>();

  for (const row of caseRows) {
    const queueIds = caseIdsByContactId.get(row.sf_contact_id) ?? [];
    queueIds.push(row.queue_id);
    caseIdsByContactId.set(row.sf_contact_id, queueIds);

    const sourceEvidenceIds =
      sourceEvidenceIdsByContactId.get(row.sf_contact_id) ?? new Set<string>();
    sourceEvidenceIds.add(row.source_evidence_id);
    sourceEvidenceIdsByContactId.set(row.sf_contact_id, sourceEvidenceIds);

    const currentOldest = oldestOpenedAtByContactId.get(row.sf_contact_id);
    if (currentOldest === undefined || row.opened_at < currentOldest) {
      oldestOpenedAtByContactId.set(row.sf_contact_id, row.opened_at);
    }
  }

  return countRows.map((row) => ({
    salesforceContactId: row.sf_contact_id,
    stuckCount:
      typeof row.stuck_count === "number"
        ? row.stuck_count
        : Number.parseInt(row.stuck_count, 10),
    queueCaseIds: caseIdsByContactId.get(row.sf_contact_id) ?? [],
    sourceEvidenceIds: Array.from(
      sourceEvidenceIdsByContactId.get(row.sf_contact_id) ?? new Set<string>(),
    ).sort((left, right) => left.localeCompare(right)),
    oldestOpenedAt:
      oldestOpenedAtByContactId.get(row.sf_contact_id) ??
      "1970-01-01T00:00:00.000Z",
  }));
}

async function probeSalesforceContacts(input: {
  readonly salesforceContactIds: readonly string[];
  readonly probeBatchSize: number;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
  readonly probeConfig: ProbeConfig;
}): Promise<ReadonlyMap<string, SalesforceContactProbeSnapshot>> {
  const apiClient = createSalesforceApiClient(input.salesforceConfig);
  const contactSnapshots = new Map<string, SalesforceContactProbeSnapshot>();

  for (const batch of chunkValues(input.salesforceContactIds, input.probeBatchSize)) {
    const [contactRows, membershipRows] = await Promise.all([
      apiClient.queryAll(buildContactProbeSoql(batch)),
      apiClient.queryAll(buildMembershipProbeSoql(batch, input.probeConfig)),
    ]);

    const membershipsByContactId = new Map<string, SalesforceMembershipProbeRow[]>();

    for (const rawRow of membershipRows) {
      const membershipRow = rawRow as SalesforceMembershipProbeRow;
      const salesforceContactId = readRowStringField(
        membershipRow as Record<string, unknown>,
        input.probeConfig.membershipContactField,
      );

      if (salesforceContactId === null) {
        continue;
      }

      const rows = membershipsByContactId.get(salesforceContactId) ?? [];
      rows.push(membershipRow);
      membershipsByContactId.set(salesforceContactId, rows);
    }

    for (const rawContactRow of contactRows) {
      const contactRow = rawContactRow as Record<string, unknown>;
      const salesforceContactId = readRowStringField(contactRow, "Id");
      // Salesforce returns datetimes like "2026-04-30T13:40:34.000+0000",
      // which Zod's z.string().datetime() rejects (offset disallowed by default).
      // Normalize to "...Z" via the existing helper, matching the pattern in
      // packages/integrations/src/capture-services/salesforce.ts.
      const createdAt = toIsoTimestamp(
        readRowStringField(contactRow, "CreatedDate"),
      );
      const updatedAt = toIsoTimestamp(
        readRowStringField(contactRow, "LastModifiedDate"),
      );

      if (
        salesforceContactId === null ||
        createdAt === null ||
        updatedAt === null
      ) {
        continue;
      }

      const phone = normalizePhone(readRowStringField(contactRow, "Phone"));
      const mobilePhone = normalizePhone(
        readRowStringField(contactRow, "MobilePhone"),
      );
      const primaryEmail = normalizeEmail(readRowStringField(contactRow, "Email"));
      const normalizedPhones = Array.from(
        new Set(
          [phone, mobilePhone].filter(
            (value): value is string => value !== null,
          ),
        ),
      ).sort((left, right) => left.localeCompare(right));
      const volunteerIdPlain = readRowStringField(
        contactRow,
        "Volunteer_ID_Plain__c",
      );
      const memberships = (
        membershipsByContactId.get(salesforceContactId) ?? []
      ).map((membership) => ({
        salesforceId: readRowStringField(
          membership as Record<string, unknown>,
          "Id",
        ),
        projectId: readRowStringField(
          membership as Record<string, unknown>,
          input.probeConfig.membershipProjectField,
        ),
        projectName: readRowStringField(
          membership as Record<string, unknown>,
          input.probeConfig.membershipProjectNameField,
        ),
        expeditionId: readRowStringField(
          membership as Record<string, unknown>,
          input.probeConfig.membershipExpeditionField,
        ),
        expeditionName: readRowStringField(
          membership as Record<string, unknown>,
          input.probeConfig.membershipExpeditionNameField,
        ),
        role:
          input.probeConfig.membershipRoleField === null
            ? null
            : readRowStringField(
                membership as Record<string, unknown>,
                input.probeConfig.membershipRoleField,
              ),
        status: readRowStringField(
          membership as Record<string, unknown>,
          input.probeConfig.membershipStatusField,
        ),
      }));
      const snapshotRecord = salesforceContactSnapshotRecordSchema.parse({
        recordType: "contact_snapshot",
        recordId: salesforceContactId,
        salesforceContactId,
        displayName: fallbackDisplayName({
          name: readRowStringField(contactRow, "Name"),
          firstName: readRowStringField(contactRow, "FirstName"),
          lastName: readRowStringField(contactRow, "LastName"),
          salesforceContactId,
        }),
        primaryEmail,
        primaryPhone: phone ?? mobilePhone,
        normalizedEmails: primaryEmail === null ? [] : [primaryEmail],
        normalizedPhones,
        volunteerIdPlainValues:
          volunteerIdPlain === null ? [] : [volunteerIdPlain],
        createdAt,
        updatedAt,
        memberships,
      });

      contactSnapshots.set(salesforceContactId, {
        salesforceContactId,
        graphInput: mapSalesforceContactSnapshot(snapshotRecord),
        hasMemberships: memberships.length > 0,
        primaryEmail,
        normalizedPhones,
      });
    }
  }

  return contactSnapshots;
}

function redactEmail(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const atIndex = value.indexOf("@");

  if (atIndex <= 1) {
    return "***";
  }

  return `${value[0] ?? "*"}***${value.slice(atIndex)}`;
}

function redactPhone(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const suffix = value.slice(-2);
  return `***${suffix}`;
}

function buildSampleRows(
  targets: readonly BucketedIdentityAnchorTarget[],
  sampleLimit: number,
): readonly Record<string, unknown>[] {
  return targets.slice(0, sampleLimit).map(({ bucket, target, snapshot }) => ({
    bucket,
    salesforceContactId: target.salesforceContactId,
    stuckCount: target.stuckCount,
    displayName: snapshot?.graphInput.contact.displayName ?? null,
    email: redactEmail(snapshot?.primaryEmail ?? null),
    phones: snapshot?.normalizedPhones.map((phone) => redactPhone(phone)) ?? [],
    membershipCount: (snapshot?.graphInput.memberships ?? []).length,
  }));
}

function buildTopOffenderRows(
  classification: BucketClassification,
): readonly Record<string, unknown>[] {
  return [
    ...classification.bucketA,
    ...classification.bucketB,
    ...classification.bucketC,
  ]
    .sort((left, right) => right.target.stuckCount - left.target.stuckCount)
    .slice(0, topContactLimit)
    .map(({ bucket, target }) => ({
      salesforceContactId: target.salesforceContactId,
      stuckCount: target.stuckCount,
      bucket,
    }));
}

function createExecutionSummary(): ExecutionSummary {
  return {
    bucketAIngested: 0,
    bucketANoOp: 0,
    bucketBIngested: 0,
    bucketBNoOp: 0,
    bucketCTerminalSkipped: 0,
    bucketCNoOp: 0,
    errorCount: 0,
    errors: [],
  };
}

function addExecutionResult(
  summary: ExecutionSummary,
  result: ProcessTargetResult,
): ExecutionSummary {
  switch (result.bucket) {
    case "A":
      return result.action === "ingested" || result.action === "would_ingest"
        ? {
            ...summary,
            bucketAIngested: summary.bucketAIngested + 1,
          }
        : {
            ...summary,
            bucketANoOp: summary.bucketANoOp + 1,
          };
    case "B":
      return result.action === "ingested" || result.action === "would_ingest"
        ? {
            ...summary,
            bucketBIngested: summary.bucketBIngested + 1,
          }
        : {
            ...summary,
            bucketBNoOp: summary.bucketBNoOp + 1,
          };
    case "C":
      return result.action === "terminal_skipped" ||
        result.action === "would_terminal_skip"
        ? {
            ...summary,
            bucketCTerminalSkipped:
              summary.bucketCTerminalSkipped + result.resolvedCaseCount,
          }
        : {
            ...summary,
            bucketCNoOp: summary.bucketCNoOp + 1,
          };
  }
}

function addExecutionError(
  summary: ExecutionSummary,
  input: {
    readonly salesforceContactId: string;
    readonly error: Error;
  },
): ExecutionSummary {
  const key = `${input.error.name}:${input.error.message}`;

  return {
    ...summary,
    errorCount: summary.errorCount + 1,
    errors: [
      ...summary.errors,
      {
        key,
        salesforceContactId: input.salesforceContactId,
        message: input.error.message,
      },
    ],
  };
}

export async function markIdentityCasesResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseIds: readonly string[];
  readonly resolvedAt: string;
  readonly explanation: string;
}): Promise<number> {
  let resolvedCount = 0;

  for (const caseId of input.caseIds) {
    const currentCase = await input.repositories.identityResolutionQueue.findById(
      caseId,
    );

    if (currentCase?.status !== "open") {
      continue;
    }

    await markIdentityCaseResolved({
      repositories: input.repositories,
      caseRecord: currentCase,
      resolvedAt: input.resolvedAt,
      explanation: input.explanation,
    });
    resolvedCount += 1;
  }

  return resolvedCount;
}

async function markIdentityCaseResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: IdentityResolutionCase;
  readonly resolvedAt: string;
  readonly explanation: string;
}): Promise<void> {
  await input.repositories.identityResolutionQueue.upsert({
    ...input.caseRecord,
    status: "resolved",
    resolvedAt: input.resolvedAt,
    explanation: `${input.caseRecord.explanation} ${input.explanation}`,
  });
}

async function processBucketedTarget(input: {
  readonly connection: DatabaseConnection;
  readonly bucketedTarget: BucketedIdentityAnchorTarget;
  readonly dryRun: boolean;
}): Promise<ProcessTargetResult> {
  let result: ProcessTargetResult | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const existingContact = await repositories.contacts.findBySalesforceContactId(
      input.bucketedTarget.target.salesforceContactId,
    );

    if (
      input.bucketedTarget.bucket === "A" ||
      input.bucketedTarget.bucket === "B"
    ) {
      const snapshot = input.bucketedTarget.snapshot;

      if (snapshot === null) {
        throw new Error(
          `Expected Salesforce probe snapshot for bucket ${input.bucketedTarget.bucket}.`,
        );
      }

      if (existingContact !== null) {
        result = {
          bucket: input.bucketedTarget.bucket,
          action: "noop_already_anchored",
          resolvedCaseCount: 0,
        };
      } else if (input.bucketedTarget.bucket === "A") {
        await normalization.upsertNormalizedContactGraph(snapshot.graphInput);
        result = {
          bucket: "A",
          action: input.dryRun ? "would_ingest" : "ingested",
          resolvedCaseCount: 0,
        };
      } else {
        await repositories.contacts.upsert(snapshot.graphInput.contact);
        for (const identity of snapshot.graphInput.identities ?? []) {
          await repositories.contactIdentities.upsert(identity);
        }
        result = {
          bucket: "B",
          action: input.dryRun ? "would_ingest" : "ingested",
          resolvedCaseCount: 0,
        };
      }
    } else {
      const resolvedCaseCount = await markIdentityCasesResolved({
        repositories,
        caseIds: input.bucketedTarget.target.queueCaseIds,
        resolvedAt: new Date().toISOString(),
        explanation: `Salesforce contact ${input.bucketedTarget.target.salesforceContactId} not found in SF - terminally skipped`,
      });

      result = {
        bucket: "C",
        action:
          resolvedCaseCount > 0
            ? input.dryRun
              ? "would_terminal_skip"
              : "terminal_skipped"
            : "noop_cases_already_closed",
        resolvedCaseCount,
      };
    }

    if (input.dryRun) {
      throw new DryRunRollback();
    }
  };

  if (input.dryRun) {
    try {
      await input.connection.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }
  } else {
    await input.connection.db.transaction(runInTransaction);
  }

  // The result is assigned inside the transaction closure before dry-run
  // rollback is thrown, but TypeScript and ESLint do not track that flow.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (result === null) {
    throw new Error(
      `Expected processing result for Salesforce contact ${input.bucketedTarget.target.salesforceContactId}.`,
    );
  }

  return result;
}

function printPlan(input: {
  readonly logger: Logger;
  readonly targets: readonly StuckIdentityAnchorTarget[];
  readonly classification: BucketClassification;
  readonly probeConfig: ProbeConfig;
  readonly sampleLimit: number;
  readonly probeBatchSize: number;
}): void {
  const { logger, targets, classification } = input;
  const firstBatch = targets
    .slice(0, input.probeBatchSize)
    .map((target) => target.salesforceContactId);

  logger.log("backfill-stuck-identity-anchors");
  logger.log(
    `Found ${targets.length.toString()} distinct Salesforce contacts across ${targets.reduce((total, target) => total + target.stuckCount, 0).toString()} stuck queue cases.`,
  );
  logger.log(
    `Buckets: A=${classification.bucketA.length.toString()} B=${classification.bucketB.length.toString()} C=${classification.bucketC.length.toString()}`,
  );
  logger.log("Top 10 stuck contacts by bucket:");
  logger.log(JSON.stringify(buildTopOffenderRows(classification), null, 2));
  logger.log("Sample Bucket A rows:");
  logger.log(
    JSON.stringify(buildSampleRows(classification.bucketA, input.sampleLimit), null, 2),
  );
  logger.log("Sample Bucket B rows:");
  logger.log(
    JSON.stringify(buildSampleRows(classification.bucketB, input.sampleLimit), null, 2),
  );
  logger.log("Sample Bucket C rows:");
  logger.log(
    JSON.stringify(buildSampleRows(classification.bucketC, input.sampleLimit), null, 2),
  );
  logger.log("Read SQL:");
  logger.log(stuckIdentityAnchorCountsSql);
  logger.log("SOQL contact probe for first batch:");
  logger.log(buildContactProbeSoql(firstBatch));
  logger.log("SOQL membership probe for first batch:");
  logger.log(buildMembershipProbeSoql(firstBatch, input.probeConfig));
  logger.log("Write SQL templates:");
  logger.log(
    "contacts: INSERT ... ON CONFLICT (id) DO UPDATE; contact_identities: INSERT ... ON CONFLICT (contact_id, kind, normalized_value) DO UPDATE; identity_resolution_queue: INSERT ... ON CONFLICT (id) DO UPDATE;",
  );
}

function printExecutionSummary(input: {
  readonly logger: Logger;
  readonly dryRun: boolean;
  readonly summary: ExecutionSummary;
  readonly classification: BucketClassification;
}): void {
  const bucketCaseDrain = [
    ...input.classification.bucketA,
    ...input.classification.bucketB,
  ].reduce((total, item) => total + item.target.stuckCount, 0);
  const estimatedDrain =
    bucketCaseDrain +
    input.summary.bucketCTerminalSkipped;

  input.logger.log(
    JSON.stringify(
      {
        event: "stuck_identity_anchor_backfill.completed",
        dryRun: input.dryRun,
        bucketA: {
          count: input.classification.bucketA.length,
          ingested: input.summary.bucketAIngested,
          noOpAlreadyAnchored: input.summary.bucketANoOp,
        },
        bucketB: {
          count: input.classification.bucketB.length,
          ingested: input.summary.bucketBIngested,
          noOpAlreadyAnchored: input.summary.bucketBNoOp,
        },
        bucketC: {
          count: input.classification.bucketC.length,
          terminalSkipped: input.summary.bucketCTerminalSkipped,
          noOpAlreadyClosed: input.summary.bucketCNoOp,
        },
        errors: {
          count: input.summary.errorCount,
          examples: input.summary.errors.slice(0, 5),
        },
        estimatedStuckCaseDrainAfterNextCronTicks: estimatedDrain,
      },
      null,
      2,
    ),
  );
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const probeBatchSize = readOptionalIntegerFlag(
    flags,
    "batch-size",
    defaultProbeBatchSize,
  );
  const sampleLimit = readOptionalIntegerFlag(
    flags,
    "sample-limit",
    defaultSampleLimit,
  );
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const targets = await loadStuckTargets(connection.sql as unknown as SqlRunner);

    if (targets.length === 0) {
      logger.log("No open stuck task_communication identity-anchor cases found.");
      return;
    }

    const salesforceConfig = readSalesforceCaptureConfig(env);
    const probeConfig = readProbeConfig(env);
    const snapshotsBySalesforceContactId = await probeSalesforceContacts({
      salesforceContactIds: targets.map((target) => target.salesforceContactId),
      probeBatchSize,
      salesforceConfig,
      probeConfig,
    });
    const classification = classifyBucketedTargets({
      targets,
      snapshotsBySalesforceContactId,
    });

    printPlan({
      logger,
      targets,
      classification,
      probeConfig,
      sampleLimit,
      probeBatchSize,
    });

    let summary = createExecutionSummary();

    for (const bucketedTarget of [
      ...classification.bucketA,
      ...classification.bucketB,
      ...classification.bucketC,
    ]) {
      try {
        const result = await processBucketedTarget({
          connection,
          bucketedTarget,
          dryRun,
        });
        summary = addExecutionResult(summary, result);
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        summary = addExecutionError(summary, {
          salesforceContactId: bucketedTarget.target.salesforceContactId,
          error: resolvedError,
        });
        logger.error(
          `Failed processing ${bucketedTarget.target.salesforceContactId}: ${resolvedError.message}`,
        );
      }
    }

    printExecutionSummary({
      logger,
      dryRun,
      summary,
      classification,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}
