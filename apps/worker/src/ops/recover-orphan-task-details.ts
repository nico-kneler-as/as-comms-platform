#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import type {
  IdentityResolutionCase,
  SalesforceCommunicationDetailRecord,
} from "@as-comms/contracts";
import {
  buildSalesforceTaskFields,
  classifySalesforceTaskMessageKind,
  createSalesforceApiClient,
  resolveTaskChannel,
  salesforceTaskCommunicationRecordSchema,
  sha256Json,
  toIsoTimestamp,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";
import { buildSalesforceCommunicationDetailFromTaskRecord } from "./backfill-salesforce-communication-details.js";

const defaultProbeBatchSize = 200;
const defaultSampleLimit = 5;

export const recoverOrphanTaskDetailsSql = `WITH stuck AS (
  SELECT q.id AS queue_id, q.source_evidence_id,
         (regexp_match(q.explanation, 'Salesforce Contact ID ([A-Za-z0-9]+)'))[1] AS sf_contact_id
  FROM identity_resolution_queue q
  JOIN source_evidence_log sel ON sel.id = q.source_evidence_id
  WHERE q.status = 'open'
    AND q.reason_code = 'identity_missing_anchor'
    AND sel.provider_record_type = 'task_communication'
)
SELECT s.queue_id, s.source_evidence_id, sel.provider_record_id AS sf_task_id,
       sel.occurred_at, sel.received_at,
       sec.salesforce_contact_id AS context_who,
       sec.project_id, sec.expedition_id, sec.source_field
FROM stuck s
JOIN source_evidence_log sel ON sel.id = s.source_evidence_id
LEFT JOIN salesforce_event_context sec ON sec.source_evidence_id = s.source_evidence_id
LEFT JOIN salesforce_communication_details scd ON scd.source_evidence_id = s.source_evidence_id
WHERE scd.source_evidence_id IS NULL
ORDER BY sel.occurred_at DESC;`;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface StuckOrphanTaskRow {
  readonly queue_id: string;
  readonly source_evidence_id: string;
  readonly sf_task_id: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly context_who: string | null;
  readonly project_id: string | null;
  readonly expedition_id: string | null;
  readonly source_field: string | null;
}

export interface OrphanTaskCaseTarget {
  readonly queueCaseId: string;
  readonly sourceEvidenceId: string;
  readonly salesforceTaskId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly salesforceContactId: string | null;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
  readonly sourceField: string | null;
}

interface TaskRecoveryTarget {
  readonly salesforceTaskId: string;
  readonly cases: readonly OrphanTaskCaseTarget[];
}

type SalesforceRow = Record<string, unknown>;

export type RecoveryBucket = "R" | "M" | "U";

export interface TaskRecoveryCasePlan {
  readonly bucket: RecoveryBucket;
  readonly queueCaseId: string;
  readonly sourceEvidenceId: string;
  readonly salesforceTaskId: string;
  readonly salesforceTaskSubtype: string | null;
  readonly explanation: string | null;
  readonly detail: SalesforceCommunicationDetailRecord | null;
}

interface ExecutionSummary {
  readonly recoveredCount: number;
  readonly missingCount: number;
  readonly missingTerminalSkipped: number;
  readonly unmappedCount: number;
  readonly unmappedTerminalSkipped: number;
  readonly taskSubtypeCounts: Readonly<Record<string, number>>;
  readonly errors: readonly {
    readonly key: string;
    readonly salesforceTaskId: string;
    readonly message: string;
  }[];
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
}

function getTaskFieldConfig(config: SalesforceCaptureServiceConfig) {
  return {
    taskContactField: config.taskContactField ?? "WhoId",
    taskChannelField: config.taskChannelField ?? "TaskSubtype",
    taskOccurredAtField: config.taskOccurredAtField ?? "CreatedDate",
    taskCrossProviderKeyField: config.taskCrossProviderKeyField ?? null,
  };
}

function getTaskChannelConfig(config: SalesforceCaptureServiceConfig) {
  return {
    taskChannelField: config.taskChannelField ?? "TaskSubtype",
    taskEmailChannelValues: config.taskEmailChannelValues ?? ["Email"],
    taskSmsChannelValues: config.taskSmsChannelValues ?? ["SMS", "Text"],
  };
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
      "SALESFORCE_MEMBERSHIP_OBJECT_NAME",
      "Expedition_Members__c",
    ),
    membershipContactField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_CONTACT_FIELD",
      "Contact__c",
    ),
    membershipProjectField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_PROJECT_FIELD",
      "Project__c",
    ),
    membershipProjectNameField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_PROJECT_NAME_FIELD",
      "Project__r.Name",
    ),
    membershipExpeditionField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_EXPEDITION_FIELD",
      "Expedition__c",
    ),
    membershipExpeditionNameField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_EXPEDITION_NAME_FIELD",
      "Expedition__r.Name",
    ),
    membershipRoleField: readOptionalNullableStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_ROLE_FIELD",
    ),
    membershipStatusField: readOptionalStringEnv(
      env,
      "SALESFORCE_MEMBERSHIP_STATUS_FIELD",
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
    taskEmailChannelValues: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_EMAIL_CHANNEL_VALUES",
      "Email",
    )
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    taskSmsChannelValues: readOptionalStringEnv(
      env,
      "SALESFORCE_TASK_SMS_CHANNEL_VALUES",
      "SMS,Text",
    )
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
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
      "SALESFORCE_TIMEOUT_MS",
      15_000,
    ),
  };
}

function quoteSoqlLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
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

function getStringField(
  row: SalesforceRow,
  fieldName: string | null,
): string | null {
  if (fieldName === null) {
    return null;
  }

  const rawValue = row[fieldName];
  return typeof rawValue === "string" && rawValue.trim().length > 0
    ? rawValue
    : null;
}

async function loadStuckOrphanTaskRows(
  sql: SqlRunner,
): Promise<readonly OrphanTaskCaseTarget[]> {
  const rows = await sql.unsafe<readonly StuckOrphanTaskRow[]>(
    recoverOrphanTaskDetailsSql,
  );

  return rows.map((row) => ({
    queueCaseId: row.queue_id,
    sourceEvidenceId: row.source_evidence_id,
    salesforceTaskId: row.sf_task_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    salesforceContactId: row.context_who,
    projectId: row.project_id,
    expeditionId: row.expedition_id,
    sourceField: row.source_field,
  }));
}

export function groupCasesBySalesforceTaskId(
  cases: readonly OrphanTaskCaseTarget[],
): readonly TaskRecoveryTarget[] {
  const grouped = new Map<string, OrphanTaskCaseTarget[]>();

  for (const entry of cases) {
    const bucket = grouped.get(entry.salesforceTaskId) ?? [];
    bucket.push(entry);
    grouped.set(entry.salesforceTaskId, bucket);
  }

  return Array.from(grouped.entries())
    .map(([salesforceTaskId, groupedCases]) => ({
      salesforceTaskId,
      cases: groupedCases.sort((left, right) =>
        left.sourceEvidenceId.localeCompare(right.sourceEvidenceId),
      ),
    }))
    .sort((left, right) => left.salesforceTaskId.localeCompare(right.salesforceTaskId));
}

export function buildTaskProbeSoql(
  salesforceTaskIds: readonly string[],
  config: SalesforceCaptureServiceConfig,
): string {
  const fields = buildSalesforceTaskFields(getTaskFieldConfig(config));
  return `SELECT ${fields.join(", ")} FROM Task WHERE Id IN (${salesforceTaskIds
    .map(quoteSoqlLiteral)
    .join(", ")})`;
}

async function probeSalesforceTasks(input: {
  readonly salesforceTaskIds: readonly string[];
  readonly probeBatchSize: number;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
}): Promise<Map<string, SalesforceRow>> {
  const client = createSalesforceApiClient(input.salesforceConfig);
  const rowsById = new Map<string, SalesforceRow>();

  for (const chunk of chunkValues(input.salesforceTaskIds, input.probeBatchSize)) {
    const rows = await client.queryAll(
      buildTaskProbeSoql(chunk, input.salesforceConfig),
    );

    for (const row of rows) {
      const taskId = getStringField(row, "Id");

      if (taskId !== null) {
        rowsById.set(taskId, row);
      }
    }
  }

  return rowsById;
}

function buildRelatedMembershipPlaceholder(
  taskCase: OrphanTaskCaseTarget,
): SalesforceRow | null {
  return taskCase.salesforceContactId !== null ||
    taskCase.projectId !== null ||
    taskCase.expeditionId !== null ||
    taskCase.sourceField !== null
    ? {}
    : null;
}

export function buildRecoveredDetailForCase(input: {
  readonly taskCase: OrphanTaskCaseTarget;
  readonly salesforceTask: SalesforceRow;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
}): SalesforceCommunicationDetailRecord {
  const taskChannelConfig = getTaskChannelConfig(input.salesforceConfig);
  const taskSnippetField = input.salesforceConfig.taskSnippetField ?? "Description";
  const taskOccurredAtField =
    input.salesforceConfig.taskOccurredAtField ?? "CreatedDate";
  const taskContactField = input.salesforceConfig.taskContactField ?? "WhoId";
  const taskCrossProviderKeyField =
    input.salesforceConfig.taskCrossProviderKeyField ?? null;
  const channel = resolveTaskChannel({
    row: input.salesforceTask,
    relatedMembership: buildRelatedMembershipPlaceholder(input.taskCase),
    config: taskChannelConfig,
  });

  if (channel === null) {
    throw new Error(
      `Cannot build recovered detail for Salesforce Task ${input.taskCase.salesforceTaskId} with an unmapped channel.`,
    );
  }

  const subject = getStringField(input.salesforceTask, "Subject");
  const description =
    getStringField(input.salesforceTask, taskSnippetField) ??
    getStringField(input.salesforceTask, "Description");
  const occurredAt =
    toIsoTimestamp(getStringField(input.salesforceTask, taskOccurredAtField)) ??
    toIsoTimestamp(getStringField(input.salesforceTask, "CreatedDate")) ??
    input.taskCase.occurredAt;
  const messageKind = classifySalesforceTaskMessageKind({
    channel,
    taskSubtype: getStringField(input.salesforceTask, "TaskSubtype"),
    ownerId: getStringField(input.salesforceTask, "OwnerId"),
    ownerName: getStringField(input.salesforceTask, "Owner.Name"),
    ownerUsername: getStringField(input.salesforceTask, "Owner.Username"),
    subject,
  }).messageKind;
  const taskRecord = salesforceTaskCommunicationRecordSchema.parse({
    recordType: "task_communication",
    recordId: input.taskCase.salesforceTaskId,
    channel,
    messageKind,
    salesforceContactId:
      getStringField(input.salesforceTask, taskContactField) ??
      input.taskCase.salesforceContactId,
    occurredAt,
    receivedAt: input.taskCase.receivedAt,
    payloadRef: `salesforce://Task/${encodeURIComponent(input.taskCase.salesforceTaskId)}`,
    checksum: sha256Json({
      taskId: input.taskCase.salesforceTaskId,
      channel,
      messageKind,
      occurredAt,
      contactId:
        getStringField(input.salesforceTask, taskContactField) ??
        input.taskCase.salesforceContactId,
      subject,
      description,
    }),
    subject,
    snippet: description ?? subject ?? "",
    normalizedEmails: [],
    normalizedPhones: [],
    volunteerIdPlainValues: [],
    supportingRecords: [],
    crossProviderCollapseKey: getStringField(
      input.salesforceTask,
      taskCrossProviderKeyField,
    ),
    routing: {
      required: input.taskCase.projectId !== null || input.taskCase.expeditionId !== null,
      projectId: input.taskCase.projectId,
      expeditionId: input.taskCase.expeditionId,
      projectName: null,
      expeditionName: null,
    },
  });
  const detail = buildSalesforceCommunicationDetailFromTaskRecord(taskRecord);

  if (detail.sourceEvidenceId !== input.taskCase.sourceEvidenceId) {
    throw new Error(
      `Expected recovered detail sourceEvidenceId ${detail.sourceEvidenceId} to match ${input.taskCase.sourceEvidenceId}.`,
    );
  }

  return detail;
}

export function planTaskRecoveryCases(input: {
  readonly taskTarget: TaskRecoveryTarget;
  readonly salesforceTask: SalesforceRow | null;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
}): readonly TaskRecoveryCasePlan[] {
  const salesforceTask = input.salesforceTask;

  if (salesforceTask === null) {
    return input.taskTarget.cases.map((taskCase) => ({
      bucket: "M",
      queueCaseId: taskCase.queueCaseId,
      sourceEvidenceId: taskCase.sourceEvidenceId,
      salesforceTaskId: taskCase.salesforceTaskId,
      salesforceTaskSubtype: null,
      explanation: `Salesforce Task ${taskCase.salesforceTaskId} no longer exists in SF — terminally skipped (orphan task_communication recovery)`,
      detail: null,
    }));
  }

  return input.taskTarget.cases.map((taskCase) => {
    const taskSubtype = getStringField(salesforceTask, "TaskSubtype");
    const channel = resolveTaskChannel({
      row: salesforceTask,
      relatedMembership: buildRelatedMembershipPlaceholder(taskCase),
      config: getTaskChannelConfig(input.salesforceConfig),
    });

    if (channel === null) {
      return {
        bucket: "U",
        queueCaseId: taskCase.queueCaseId,
        sourceEvidenceId: taskCase.sourceEvidenceId,
        salesforceTaskId: taskCase.salesforceTaskId,
        salesforceTaskSubtype: taskSubtype,
        explanation: `Salesforce Task ${taskCase.salesforceTaskId} has unmapped channel (TaskSubtype=${taskSubtype ?? "null"}, no Email: prefix) — terminally skipped pending Phase 2 classifier fix`,
        detail: null,
      };
    }

    return {
      bucket: "R",
      queueCaseId: taskCase.queueCaseId,
      sourceEvidenceId: taskCase.sourceEvidenceId,
      salesforceTaskId: taskCase.salesforceTaskId,
      salesforceTaskSubtype: taskSubtype,
      explanation: null,
      detail: buildRecoveredDetailForCase({
        taskCase,
        salesforceTask,
        salesforceConfig: input.salesforceConfig,
      }),
    };
  });
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

export async function applyTaskRecoveryPlans(input: {
  readonly db: Stage1Database;
  readonly taskTarget: TaskRecoveryTarget;
  readonly plans: readonly TaskRecoveryCasePlan[];
  readonly dryRun: boolean;
}): Promise<{
  readonly recoveredCount: number;
  readonly missingTerminalSkipped: number;
  readonly unmappedTerminalSkipped: number;
}> {
  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    let missingTerminalSkipped = 0;
    let unmappedTerminalSkipped = 0;
    let recoveredCount = 0;

    for (const plan of input.plans) {
      if (plan.bucket === "R") {
        if (plan.detail === null) {
          throw new Error(
            `Expected recovered detail for Salesforce Task ${plan.salesforceTaskId}.`,
          );
        }

        await repositories.salesforceCommunicationDetails.upsert(plan.detail);
        recoveredCount += 1;
        continue;
      }

      if (plan.explanation === null) {
        throw new Error(
          `Expected terminal-skip explanation for Salesforce Task ${plan.salesforceTaskId}.`,
        );
      }

      const resolvedCount = await markIdentityCasesResolved({
        repositories,
        caseIds: [plan.queueCaseId],
        resolvedAt: new Date().toISOString(),
        explanation: plan.explanation,
      });

      if (plan.bucket === "M") {
        missingTerminalSkipped += resolvedCount;
      } else {
        unmappedTerminalSkipped += resolvedCount;
      }
    }

    if (input.dryRun) {
      throw new DryRunRollback();
    }

    return {
      recoveredCount,
      missingTerminalSkipped,
      unmappedTerminalSkipped,
    };
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    return {
      recoveredCount: input.plans.filter((plan) => plan.bucket === "R").length,
      missingTerminalSkipped: input.plans.filter((plan) => plan.bucket === "M")
        .length,
      unmappedTerminalSkipped: input.plans.filter((plan) => plan.bucket === "U")
        .length,
    };
  }

  return input.db.transaction(runInTransaction);
}

function createExecutionSummary(): ExecutionSummary {
  return {
    recoveredCount: 0,
    missingCount: 0,
    missingTerminalSkipped: 0,
    unmappedCount: 0,
    unmappedTerminalSkipped: 0,
    taskSubtypeCounts: {},
    errors: [],
  };
}

function addTaskPlansToSummary(
  summary: ExecutionSummary,
  plans: readonly TaskRecoveryCasePlan[],
): ExecutionSummary {
  const taskSubtypeCounts = new Map(
    Object.entries(summary.taskSubtypeCounts).map(([key, value]) => [key, value]),
  );

  for (const plan of plans) {
    if (plan.bucket === "U") {
      const key = plan.salesforceTaskSubtype ?? "null";
      taskSubtypeCounts.set(key, (taskSubtypeCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    ...summary,
    recoveredCount:
      summary.recoveredCount + plans.filter((plan) => plan.bucket === "R").length,
    missingCount:
      summary.missingCount + plans.filter((plan) => plan.bucket === "M").length,
    unmappedCount:
      summary.unmappedCount + plans.filter((plan) => plan.bucket === "U").length,
    taskSubtypeCounts: Object.fromEntries(
      Array.from(taskSubtypeCounts.entries()).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function addExecutionResult(
  summary: ExecutionSummary,
  result: {
    readonly missingTerminalSkipped: number;
    readonly recoveredCount: number;
    readonly unmappedTerminalSkipped: number;
  },
): ExecutionSummary {
  return {
    ...summary,
    recoveredCount: summary.recoveredCount,
    missingCount: summary.missingCount,
    unmappedCount: summary.unmappedCount,
    missingTerminalSkipped:
      summary.missingTerminalSkipped + result.missingTerminalSkipped,
    unmappedTerminalSkipped:
      summary.unmappedTerminalSkipped + result.unmappedTerminalSkipped,
  };
}

function addExecutionError(
  summary: ExecutionSummary,
  input: {
    readonly salesforceTaskId: string;
    readonly error: Error;
  },
): ExecutionSummary {
  const key = `${input.error.name}:${input.error.message}`;

  return {
    ...summary,
    errors: [
      ...summary.errors,
      {
        key,
        salesforceTaskId: input.salesforceTaskId,
        message: input.error.message,
      },
    ],
  };
}

function buildSampleRows(
  plans: readonly TaskRecoveryCasePlan[],
  sampleLimit: number,
): readonly Record<string, string | null>[] {
  return plans.slice(0, sampleLimit).map((plan) => ({
    queueCaseId: plan.queueCaseId,
    sourceEvidenceId: plan.sourceEvidenceId,
    salesforceTaskId: plan.salesforceTaskId,
    bucket: plan.bucket,
    taskSubtype: plan.salesforceTaskSubtype,
    channel: plan.detail?.channel ?? null,
    messageKind: plan.detail?.messageKind ?? null,
    sourceLabel: plan.detail?.sourceLabel ?? null,
    explanation: plan.explanation,
  }));
}

function printPlan(input: {
  readonly logger: Logger;
  readonly taskTargets: readonly TaskRecoveryTarget[];
  readonly allPlans: readonly TaskRecoveryCasePlan[];
  readonly sampleLimit: number;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
  readonly probeBatchSize: number;
}): void {
  const firstBatch = input.taskTargets
    .slice(0, input.probeBatchSize)
    .map((target) => target.salesforceTaskId);
  const recoverable = input.allPlans.filter((plan) => plan.bucket === "R");
  const missing = input.allPlans.filter((plan) => plan.bucket === "M");
  const unmapped = input.allPlans.filter((plan) => plan.bucket === "U");

  input.logger.log("recover-orphan-task-details");
  input.logger.log(
    `Found ${input.taskTargets.length.toString()} Salesforce Tasks across ${input.allPlans.length.toString()} stuck queue cases.`,
  );
  input.logger.log(
    `Buckets: R=${recoverable.length.toString()} M=${missing.length.toString()} U=${unmapped.length.toString()}`,
  );
  input.logger.log("Sample Bucket R rows:");
  input.logger.log(
    JSON.stringify(buildSampleRows(recoverable, input.sampleLimit), null, 2),
  );
  input.logger.log("Sample Bucket M rows:");
  input.logger.log(
    JSON.stringify(buildSampleRows(missing, input.sampleLimit), null, 2),
  );
  input.logger.log("Sample Bucket U rows:");
  input.logger.log(
    JSON.stringify(buildSampleRows(unmapped, input.sampleLimit), null, 2),
  );
  input.logger.log("Read SQL:");
  input.logger.log(recoverOrphanTaskDetailsSql);
  input.logger.log("SOQL Task probe for first batch:");
  input.logger.log(buildTaskProbeSoql(firstBatch, input.salesforceConfig));
  input.logger.log("Write SQL templates:");
  input.logger.log(
    "salesforce_communication_details: INSERT ... ON CONFLICT (source_evidence_id) DO UPDATE; identity_resolution_queue: INSERT ... ON CONFLICT (id) DO UPDATE;",
  );
}

function printExecutionSummary(input: {
  readonly logger: Logger;
  readonly dryRun: boolean;
  readonly summary: ExecutionSummary;
}): void {
  input.logger.log(
    JSON.stringify(
      {
        event: "recover_orphan_task_details.completed",
        dryRun: input.dryRun,
        bucketR: {
          count: input.summary.recoveredCount,
          ingested: input.summary.recoveredCount,
        },
        bucketM: {
          count: input.summary.missingCount,
          terminalSkipped: input.summary.missingTerminalSkipped,
        },
        bucketU: {
          count: input.summary.unmappedCount,
          terminalSkipped: input.summary.unmappedTerminalSkipped,
          taskSubtypeCounts: input.summary.taskSubtypeCounts,
        },
        errors: {
          count: input.summary.errors.length,
          examples: input.summary.errors.slice(0, 5),
        },
        estimatedStuckCaseDrainAfterNextCronTick:
          input.summary.recoveredCount +
          input.summary.missingCount +
          input.summary.unmappedCount,
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
    const stuckCases = await loadStuckOrphanTaskRows(
      connection.sql as unknown as SqlRunner,
    );

    if (stuckCases.length === 0) {
      logger.log("No open orphan task_communication queue cases found.");
      return;
    }

    const salesforceConfig = readSalesforceCaptureConfig(env);
    const taskTargets = groupCasesBySalesforceTaskId(stuckCases);
    const salesforceTasksById = await probeSalesforceTasks({
      salesforceTaskIds: taskTargets.map((target) => target.salesforceTaskId),
      probeBatchSize,
      salesforceConfig,
    });
    const plansByTaskId = new Map<string, readonly TaskRecoveryCasePlan[]>();
    let summary = createExecutionSummary();

    for (const taskTarget of taskTargets) {
      const plans = planTaskRecoveryCases({
        taskTarget,
        salesforceTask:
          salesforceTasksById.get(taskTarget.salesforceTaskId) ?? null,
        salesforceConfig,
      });
      plansByTaskId.set(taskTarget.salesforceTaskId, plans);
      summary = addTaskPlansToSummary(summary, plans);
    }

    const allPlans = Array.from(plansByTaskId.values()).flat();

    printPlan({
      logger,
      taskTargets,
      allPlans,
      sampleLimit,
      salesforceConfig,
      probeBatchSize,
    });

    for (const taskTarget of taskTargets) {
      const taskPlans = plansByTaskId.get(taskTarget.salesforceTaskId);

      if (taskPlans === undefined) {
        throw new Error(
          `Expected recovery plans for Salesforce Task ${taskTarget.salesforceTaskId}.`,
        );
      }

      try {
        const result = await applyTaskRecoveryPlans({
          db: connection.db,
          taskTarget,
          plans: taskPlans,
          dryRun,
        });
        summary = addExecutionResult(summary, result);
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        summary = addExecutionError(summary, {
          salesforceTaskId: taskTarget.salesforceTaskId,
          error: resolvedError,
        });
        logger.error(
          `Failed processing Salesforce Task ${taskTarget.salesforceTaskId}: ${resolvedError.message}`,
        );
      }
    }

    printExecutionSummary({
      logger,
      dryRun,
      summary,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}
