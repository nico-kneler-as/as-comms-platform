import { createSign } from "node:crypto";

import {
  createCapturedBatchResponseSchema,
  type CapturedBatchResponse,
} from "../capture/shared.js";
import {
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  integrationHealthCheckResponseSchema,
  type SalesforceHistoricalCaptureBatchPayload,
  type SalesforceLiveCaptureBatchPayload,
  type IntegrationHealthCheckResponse,
  type IntegrationHealthStatus,
} from "@as-comms/contracts";
import {
  classifySalesforceTaskMessageKind,
  salesforceLaunchScopeAutomatedOwnerUsernames,
  salesforceContactSnapshotRecordSchema,
  salesforceLifecycleRecordSchema,
  salesforceRecordSchema,
  salesforceTaskCommunicationRecordSchema,
  type SalesforceContactSnapshotRecord,
  type SalesforceLifecycleRecord,
  type SalesforceRecord,
  type SalesforceTaskCommunicationRecord,
} from "../providers/salesforce.js";
import { z } from "zod";

import type {
  CaptureServiceHttpRequest,
  CaptureServiceHttpResponse,
  CursorMarker,
} from "./shared.js";
import {
  CaptureServiceBadRequestError,
  hasBearerToken,
  isTimestampWithinWindow,
  jsonResponse,
  normalizeEmail,
  normalizePhone,
  paginateCapturedRecords,
  parseIsoWindow,
  parseJsonRequestBody,
  sha256Json,
  toIsoTimestamp,
  uniqueValues,
} from "./shared.js";

const salesforceCaptureServiceResponseSchema =
  createCapturedBatchResponseSchema(salesforceRecordSchema);

const salesforceCaptureModeSchema = z.enum(["delta_polling", "cdc_compatible"]);

const salesforceCaptureServiceConfigSchema = z.object({
  bearerToken: z.string().min(1),
  loginUrl: z.string().url(),
  clientId: z.string().min(1),
  username: z.string().min(1),
  jwtPrivateKey: z.string().min(1),
  jwtExpirationSeconds: z.number().int().positive().default(180),
  apiVersion: z.string().min(1).default("61.0"),
  contactCaptureMode: salesforceCaptureModeSchema,
  membershipCaptureMode: salesforceCaptureModeSchema,
  membershipObjectName: z.string().min(1).default("Expedition_Members__c"),
  membershipContactField: z.string().min(1).default("Contact__c"),
  membershipProjectField: z.string().min(1).default("Project__c"),
  membershipProjectNameField: z.string().min(1).default("Project__r.Name"),
  membershipExpeditionField: z.string().min(1).default("Expedition__c"),
  membershipExpeditionNameField: z
    .string()
    .min(1)
    .default("Expedition__r.Name"),
  membershipRoleField: z.string().min(1).nullable().default(null),
  membershipStatusField: z.string().min(1).default("Status__c"),
  taskContactField: z.string().min(1).default("WhoId"),
  taskChannelField: z.string().min(1).default("TaskSubtype"),
  taskEmailChannelValues: z.array(z.string().min(1)).min(1).default(["Email"]),
  taskSmsChannelValues: z
    .array(z.string().min(1))
    .min(1)
    .default(["SMS", "Text"]),
  taskSnippetField: z.string().min(1).default("Description"),
  taskOccurredAtField: z.string().min(1).default("CreatedDate"),
  taskCrossProviderKeyField: z.string().min(1).nullable().default(null),
  timeoutMs: z.number().int().positive().default(15_000),
});
export type SalesforceCaptureServiceConfig = z.input<
  typeof salesforceCaptureServiceConfigSchema
>;
type ResolvedSalesforceCaptureServiceConfig = z.output<
  typeof salesforceCaptureServiceConfigSchema
>;

type SalesforceRow = Record<string, unknown>;

export interface SalesforceApiClient {
  queryAll(soql: string): Promise<readonly SalesforceRow[]>;
}

interface SalesforceAccessTokenCacheEntry {
  readonly accessToken: string;
  readonly instanceUrl: string;
  readonly expiresAtEpochMs: number;
}

class SalesforceHealthCheckError extends Error {
  constructor(
    readonly status: Extract<
      IntegrationHealthStatus,
      "needs_attention" | "disconnected"
    >,
    message: string,
  ) {
    super(message);
    this.name = "SalesforceHealthCheckError";
  }
}

export class SalesforcePaginationOriginError extends Error {
  constructor(input: {
    readonly expectedOrigin: string;
    readonly resolvedUrl: string;
    readonly reason: "origin" | "path";
  }) {
    const resolvedUrl = new URL(input.resolvedUrl);
    const message =
      input.reason === "origin"
        ? `Salesforce nextRecordsUrl origin mismatch: expected ${input.expectedOrigin}, received ${resolvedUrl.origin} (${resolvedUrl.host}).`
        : `Salesforce nextRecordsUrl path is outside /services/data/: ${resolvedUrl.pathname} on ${resolvedUrl.origin}. Expected origin ${input.expectedOrigin}.`;
    super(message);
    this.name = "SalesforcePaginationOriginError";
  }
}

const salesforceTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  instance_url: z.string().url(),
});

const salesforceQueryResponseSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  nextRecordsUrl: z.string().min(1).optional(),
  done: z.boolean(),
});

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isDisconnectedSalesforceAuthError(
  status: number,
  responseText: string,
): boolean {
  if (status !== 400 && status !== 401) {
    return false;
  }

  return /(invalid|expired|unauthorized|assertion|credentials|authentication)/iu.test(
    responseText,
  );
}

function resolveRemainingTimeoutMs(input: {
  readonly timeoutMs: number;
  readonly now: () => Date;
  readonly startedAtMs?: number;
}): number {
  if (input.startedAtMs === undefined) {
    return input.timeoutMs;
  }

  const elapsedMs = input.now().getTime() - input.startedAtMs;
  return Math.max(1, input.timeoutMs - elapsedMs);
}

async function exchangeSalesforceAccessToken(input: {
  readonly config: ResolvedSalesforceCaptureServiceConfig;
  readonly fetchImplementation: typeof fetch;
  readonly now: () => Date;
  readonly accessTokenCache: SalesforceAccessTokenCacheEntry | null;
  readonly timeoutMs: number;
  readonly startedAtMs?: number;
}): Promise<SalesforceAccessTokenCacheEntry> {
  const currentTime = input.now().getTime();
  const nowEpochSeconds = Math.floor(currentTime / 1000);

  if (
    input.accessTokenCache !== null &&
    input.accessTokenCache.expiresAtEpochMs - 30_000 > currentTime
  ) {
    return input.accessTokenCache;
  }

  const tokenUrl = new URL(
    "/services/oauth2/token",
    input.config.loginUrl,
  ).toString();
  let assertion: string;

  try {
    assertion = createSalesforceJwtAssertion({
      clientId: input.config.clientId,
      username: input.config.username,
      loginUrl: input.config.loginUrl,
      jwtPrivateKey: input.config.jwtPrivateKey,
      nowEpochSeconds,
      jwtExpirationSeconds: input.config.jwtExpirationSeconds,
    });
  } catch {
    throw new SalesforceHealthCheckError(
      "needs_attention",
      "Salesforce JWT signing failed.",
    );
  }

  let response: Response;
  const requestTimeoutMs =
    input.startedAtMs === undefined
      ? resolveRemainingTimeoutMs({
          timeoutMs: input.timeoutMs,
          now: input.now,
        })
      : resolveRemainingTimeoutMs({
          timeoutMs: input.timeoutMs,
          now: input.now,
          startedAtMs: input.startedAtMs,
        });

  try {
    response = await input.fetchImplementation(tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new SalesforceHealthCheckError(
        "needs_attention",
        "Salesforce token exchange timed out.",
      );
    }

    throw new SalesforceHealthCheckError(
      "needs_attention",
      "Salesforce token exchange request failed.",
    );
  }

  if (!response.ok) {
    const responseText = await response.text();

    if (isDisconnectedSalesforceAuthError(response.status, responseText)) {
      throw new SalesforceHealthCheckError(
        "disconnected",
        `Invalid or expired credentials: ${responseText}`,
      );
    }

    throw new SalesforceHealthCheckError(
      "needs_attention",
      `Salesforce token exchange failed with status ${String(response.status)}: ${responseText}`,
    );
  }

  let tokenJson: z.infer<typeof salesforceTokenResponseSchema>;

  try {
    const tokenPayload: unknown = JSON.parse(await response.text());
    tokenJson = salesforceTokenResponseSchema.parse(tokenPayload);
  } catch {
    throw new SalesforceHealthCheckError(
      "needs_attention",
      "Salesforce token exchange returned an unexpected response.",
    );
  }

  return {
    accessToken: tokenJson.access_token,
    instanceUrl: tokenJson.instance_url,
    expiresAtEpochMs: currentTime + 30 * 60 * 1000,
  } satisfies SalesforceAccessTokenCacheEntry;
}

export async function checkSalesforceCaptureServiceHealth(
  config: SalesforceCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
    readonly timeoutMs?: number;
    readonly version?: string | null;
  },
): Promise<IntegrationHealthCheckResponse> {
  const parsedConfig = salesforceCaptureServiceConfigSchema.parse(config);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  const now = input?.now ?? (() => new Date());
  const timeoutMs = Math.min(parsedConfig.timeoutMs, input?.timeoutMs ?? 5_000);
  const checkedAt = now().toISOString();
  const startedAtMs = now().getTime();

  if (typeof fetchImplementation !== "function") {
    return integrationHealthCheckResponseSchema.parse({
      service: "salesforce",
      status: "needs_attention",
      checkedAt,
      detail: "Global fetch is unavailable.",
      version: input?.version ?? null,
    });
  }

  try {
    const token = await exchangeSalesforceAccessToken({
      config: parsedConfig,
      fetchImplementation,
      now,
      accessTokenCache: null,
      timeoutMs,
      startedAtMs,
    });
    const describeUrl = new URL(
      `/services/data/v${parsedConfig.apiVersion}/sobjects/Contact/describe`,
      token.instanceUrl,
    ).toString();

    let response: Response;

    try {
      response = await fetchImplementation(describeUrl, {
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(
          resolveRemainingTimeoutMs({
            timeoutMs,
            now,
            startedAtMs,
          }),
        ),
      });
    } catch (error) {
      if (isAbortError(error)) {
        return integrationHealthCheckResponseSchema.parse({
          service: "salesforce",
          status: "needs_attention",
          checkedAt,
          detail: "Salesforce describe request timed out.",
          version: input?.version ?? null,
        });
      }

      return integrationHealthCheckResponseSchema.parse({
        service: "salesforce",
        status: "needs_attention",
        checkedAt,
        detail: "Salesforce describe request failed.",
        version: input?.version ?? null,
      });
    }

    if (response.status === 401) {
      return integrationHealthCheckResponseSchema.parse({
        service: "salesforce",
        status: "disconnected",
        checkedAt,
        detail: "Invalid or expired credentials.",
        version: input?.version ?? null,
      });
    }

    if (!response.ok) {
      return integrationHealthCheckResponseSchema.parse({
        service: "salesforce",
        status: "needs_attention",
        checkedAt,
        detail: `Salesforce describe request failed with status ${String(response.status)}.`,
        version: input?.version ?? null,
      });
    }

    // JWT bearer flow mints a fresh access token on demand and does not expose
    // a reliable token-expiry timestamp for health reporting, so we treat a
    // successful lightweight authenticated call as healthy.
    return integrationHealthCheckResponseSchema.parse({
      service: "salesforce",
      status: "healthy",
      checkedAt,
      detail: null,
      version: input?.version ?? null,
    });
  } catch (error) {
    if (error instanceof SalesforceHealthCheckError) {
      return integrationHealthCheckResponseSchema.parse({
        service: "salesforce",
        status: error.status,
        checkedAt,
        detail: error.message,
        version: input?.version ?? null,
      });
    }

    return integrationHealthCheckResponseSchema.parse({
      service: "salesforce",
      status: "needs_attention",
      checkedAt,
      detail: "Unexpected health check failure.",
      version: input?.version ?? null,
    });
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/gu, "\n");
}

function createSalesforceJwtAssertion(input: {
  readonly clientId: string;
  readonly username: string;
  readonly loginUrl: string;
  readonly jwtPrivateKey: string;
  readonly nowEpochSeconds: number;
  readonly jwtExpirationSeconds: number;
}): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: input.clientId,
    sub: input.username,
    aud: new URL(input.loginUrl).origin,
    exp: input.nowEpochSeconds + input.jwtExpirationSeconds,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}`;
  const signer = createSign("RSA-SHA256");

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(normalizePrivateKey(input.jwtPrivateKey));

  return `${signingInput}.${signature.toString("base64url")}`;
}

const lifecycleSources = [
  {
    milestone: "signed_up" as const,
    sourceField: "Expedition_Members__c.CreatedDate" as const,
    rawFieldName: "CreatedDate",
  },
  {
    milestone: "received_training" as const,
    sourceField: "Expedition_Members__c.Date_Training_Sent__c" as const,
    rawFieldName: "Date_Training_Sent__c",
  },
  {
    milestone: "completed_training" as const,
    sourceField: "Expedition_Members__c.Date_Training_Completed__c" as const,
    rawFieldName: "Date_Training_Completed__c",
  },
  {
    milestone: "submitted_first_data" as const,
    sourceField:
      "Expedition_Members__c.Date_First_Sample_Collected__c" as const,
    rawFieldName: "Date_First_Sample_Collected__c",
  },
] as const;

function isContactSnapshotRecord(
  record: SalesforceRecord,
): record is SalesforceContactSnapshotRecord {
  return record.recordType === "contact_snapshot";
}

function isLifecycleRecord(
  record: SalesforceRecord,
): record is SalesforceLifecycleRecord {
  return record.recordType === "lifecycle_milestone";
}

function isTaskCommunicationRecord(
  record: SalesforceRecord,
): record is SalesforceTaskCommunicationRecord {
  return record.recordType === "task_communication";
}

function quoteSoqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function formatSoqlDateTime(value: string): string {
  return value;
}

function formatSoqlDate(value: string): string {
  return value.slice(0, 10);
}

function buildInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSoqlString(value)).join(", ")})`;
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
function getPathValue(row: SalesforceRow, fieldName: string): unknown {
  const directValue = row[fieldName];

  if (directValue !== undefined || !fieldName.includes(".")) {
    return directValue;
  }

  const path = fieldName.split(".");
  let currentValue: unknown = row;

  for (const segment of path) {
    if (
      typeof currentValue !== "object" ||
      currentValue === null ||
      !(segment in currentValue)
    ) {
      return undefined;
    }

    currentValue = (currentValue as Record<string, unknown>)[segment];
  }

  return currentValue;
}
function dedupeRowsById(rows: readonly SalesforceRow[]): SalesforceRow[] {
  const seenIds = new Set<string>();
  const dedupedRows: SalesforceRow[] = [];

  for (const row of rows) {
    const rowId = getStringField(row, "Id");

    if (rowId === null) {
      dedupedRows.push(row);
      continue;
    }

    if (seenIds.has(rowId)) {
      continue;
    }

    seenIds.add(rowId);
    dedupedRows.push(row);
  }

  return dedupedRows;
}

function getStringField(row: SalesforceRow, fieldName: string): string | null {
  const value = getPathValue(row, fieldName);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getEmailField(row: SalesforceRow, fieldName: string): string | null {
  return normalizeEmail(getStringField(row, fieldName));
}

function getPhoneField(row: SalesforceRow, fieldName: string): string | null {
  return normalizePhone(getStringField(row, fieldName));
}

function buildSalesforceCursorMarker(record: SalesforceRecord): CursorMarker {
  if (isContactSnapshotRecord(record)) {
    return {
      occurredAt: record.updatedAt,
      recordType: record.recordType,
      recordId: record.recordId,
    };
  }

  if (isLifecycleRecord(record) || isTaskCommunicationRecord(record)) {
    return {
      occurredAt: record.occurredAt,
      recordType: record.recordType,
      recordId: record.recordId,
    };
  }

  return {
    occurredAt: "1970-01-01T00:00:00.000Z",
    recordType: record.recordType,
    recordId: record.recordId,
  };
}

function sortSalesforceRecords(
  records: readonly SalesforceRecord[],
): SalesforceRecord[] {
  return [...records].sort((left, right) => {
    const leftMarker = buildSalesforceCursorMarker(left);
    const rightMarker = buildSalesforceCursorMarker(right);

    if (leftMarker.occurredAt !== rightMarker.occurredAt) {
      return leftMarker.occurredAt.localeCompare(rightMarker.occurredAt);
    }

    if (leftMarker.recordType !== rightMarker.recordType) {
      return leftMarker.recordType.localeCompare(rightMarker.recordType);
    }

    return leftMarker.recordId.localeCompare(rightMarker.recordId);
  });
}

export function createSalesforceApiClient(
  config: SalesforceCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
  },
): SalesforceApiClient {
  const parsedConfig: ResolvedSalesforceCaptureServiceConfig =
    salesforceCaptureServiceConfigSchema.parse(config);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  const now = input?.now ?? (() => new Date());
  let accessTokenCache: SalesforceAccessTokenCacheEntry | null = null;

  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable for Salesforce capture.");
  }

  async function getAccessToken(): Promise<SalesforceAccessTokenCacheEntry> {
    accessTokenCache = await exchangeSalesforceAccessToken({
      config: parsedConfig,
      fetchImplementation,
      now,
      accessTokenCache,
      timeoutMs: parsedConfig.timeoutMs,
    });

    return accessTokenCache;
  }

  return {
    async queryAll(soql) {
      const token = await getAccessToken();
      const expectedInstanceOrigin = new URL(token.instanceUrl).origin;
      const records: SalesforceRow[] = [];
      let nextUrl = new URL(
        `/services/data/v${parsedConfig.apiVersion}/query?q=${encodeURIComponent(soql)}`,
        token.instanceUrl,
      ).toString();

      while (nextUrl.length > 0) {
        const response = await fetchImplementation(nextUrl, {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(parsedConfig.timeoutMs),
        });

        if (!response.ok) {
          const errorBodyText = await response.text();
          const errorBodyPreview = errorBodyText.slice(0, 1000);
          throw new Error(
            `Salesforce query failed with status ${String(response.status)}. Body: ${errorBodyPreview}. SOQL: ${soql.slice(0, 500)}`,
          );
        }

        const queryPayload: unknown = JSON.parse(await response.text());
        const queryResponse = salesforceQueryResponseSchema.parse(queryPayload);
        records.push(...queryResponse.records);
        if (queryResponse.nextRecordsUrl === undefined) {
          nextUrl = "";
          continue;
        }

        const resolvedNextUrl = new URL(
          queryResponse.nextRecordsUrl,
          token.instanceUrl,
        );
        if (resolvedNextUrl.origin !== expectedInstanceOrigin) {
          throw new SalesforcePaginationOriginError({
            expectedOrigin: expectedInstanceOrigin,
            resolvedUrl: resolvedNextUrl.toString(),
            reason: "origin",
          });
        }

        if (!resolvedNextUrl.pathname.startsWith("/services/data/")) {
          throw new SalesforcePaginationOriginError({
            expectedOrigin: expectedInstanceOrigin,
            resolvedUrl: resolvedNextUrl.toString(),
            reason: "path",
          });
        }

        nextUrl = resolvedNextUrl.toString();
      }

      return records;
    },
  };
}

function buildContactFields(): string[] {
  return [
    "Id",
    "Name",
    "Email",
    "Phone",
    "Volunteer_ID_Plain__c",
    "CreatedDate",
    "LastModifiedDate",
  ];
}

function buildMembershipFields(
  config: ResolvedSalesforceCaptureServiceConfig,
): string[] {
  return uniqueValues([
    "Id",
    "CreatedDate",
    "LastModifiedDate",
    "Date_Training_Sent__c",
    "Date_Training_Completed__c",
    "Date_First_Sample_Collected__c",
    config.membershipContactField,
    config.membershipProjectField,
    config.membershipProjectNameField,
    config.membershipExpeditionField,
    config.membershipExpeditionNameField,
    ...(config.membershipRoleField === null
      ? []
      : [config.membershipRoleField]),
    config.membershipStatusField,
  ]);
}

function buildTaskFields(
  config: ResolvedSalesforceCaptureServiceConfig,
): string[] {
  return uniqueValues([
    "Id",
    "CreatedDate",
    "LastModifiedDate",
    "OwnerId",
    "Owner.Name",
    "Owner.Username",
    "TaskSubtype",
    "Subject",
    "Description",
    "WhatId",
    config.taskContactField,
    config.taskChannelField,
    config.taskOccurredAtField,
    ...(config.taskCrossProviderKeyField === null
      ? []
      : [config.taskCrossProviderKeyField]),
  ]);
}

function buildContactWindowWhere(window: {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}): string {
  if (window.windowStart === null || window.windowEnd === null) {
    return "Id != null";
  }

  return `LastModifiedDate >= ${formatSoqlDateTime(window.windowStart)} AND LastModifiedDate < ${formatSoqlDateTime(window.windowEnd)}`;
}

function buildVolunteerScopedContactWhere(
  baseWhere: string,
  config: ResolvedSalesforceCaptureServiceConfig,
): string {
  // TODO(canon): lock the Stage 1 Salesforce volunteer-only Contact ingest rule in the
  // provider ingest matrix / decision log so this belt-and-suspenders filter is explicit canon.
  return `${baseWhere} AND Id IN (SELECT ${config.membershipContactField} FROM ${config.membershipObjectName} WHERE ${config.membershipContactField} != null)`;
}

function buildVolunteerScopedTaskWhere(
  baseWhere: string,
  config: ResolvedSalesforceCaptureServiceConfig,
): string {
  // D-034: non-volunteer Salesforce Tasks are dropped at capture.
  return `${baseWhere} AND ${config.taskContactField} IN (SELECT ${config.membershipContactField} FROM ${config.membershipObjectName} WHERE ${config.membershipContactField} != null)`;
}

function buildNotEmailLikeTaskWhere(
  config: ResolvedSalesforceCaptureServiceConfig,
): string {
  // De Morgan's: NOT (subtype='Email' OR (subtype='Task' AND subject LIKE '%Email:%'))
  // = (subtype != 'Email') AND (subtype != 'Task' OR NOT subject LIKE '%Email:%')
  // Pushing NOT down to leaves avoids SOQL's rejection of NOT applied to a
  // parenthesized OR group (MALFORMED_QUERY at runtime, confirmed via live
  // probes 2026-04-24).
  const notChannelEmailClauses = config.taskEmailChannelValues.map(
    (value) => `${config.taskChannelField} != ${quoteSoqlString(value)}`,
  );
  const notSubjectDerivedEmailClause = `(${config.taskChannelField} != ${quoteSoqlString("Task")} OR (NOT Subject LIKE '%Email:%'))`;

  return [...notChannelEmailClauses, notSubjectDerivedEmailClause].join(
    " AND ",
  );
}

function buildLaunchScopeEmailTaskOwnerWhere(): string {
  return `Owner.Username IN ${buildInClause([
    ...salesforceLaunchScopeAutomatedOwnerUsernames,
  ])}`;
}

function buildLaunchScopedTaskWhere(
  baseWhere: string,
  config: ResolvedSalesforceCaptureServiceConfig,
): string {
  const volunteerScopedWhere = buildVolunteerScopedTaskWhere(baseWhere, config);
  const notEmailLikeTaskWhere = buildNotEmailLikeTaskWhere(config);
  const ownerIsLaunchScope = buildLaunchScopeEmailTaskOwnerWhere();

  // D-039: volunteer-linked Salesforce email Tasks are captured only when they
  // come from the Nim Admin automation owner. Non-email Task shapes keep the
  // prior launch-scope behavior. Expressed as (NOT emailLike) OR ownerMatch,
  // with the NOT expanded via De Morgan into positive leaf predicates so
  // SOQL accepts it.
  return `${volunteerScopedWhere} AND ((${notEmailLikeTaskWhere}) OR ${ownerIsLaunchScope})`;
}

function buildTaskWindowWhere(
  window: {
    readonly mode: "historical" | "live";
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  },
  config: ResolvedSalesforceCaptureServiceConfig,
): string {
  const contactWhere =
    config.taskContactField === "WhoId"
      ? "Who.Type = 'Contact'"
      : `${config.taskContactField} != null`;

  if (window.windowStart === null || window.windowEnd === null) {
    return contactWhere;
  }

  const timestampField =
    window.mode === "historical"
      ? config.taskOccurredAtField
      : "LastModifiedDate";

  return `${contactWhere} AND ${timestampField} >= ${formatSoqlDateTime(window.windowStart)} AND ${timestampField} < ${formatSoqlDateTime(window.windowEnd)}`;
}

function buildMembershipWindowWhere(input: {
  readonly mode: "historical" | "live";
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly config: ResolvedSalesforceCaptureServiceConfig;
}): string {
  const contactField = input.config.membershipContactField;

  if (input.windowStart === null || input.windowEnd === null) {
    return `${contactField} != null`;
  }

  if (input.mode === "live") {
    return `${contactField} != null AND LastModifiedDate >= ${formatSoqlDateTime(input.windowStart)} AND LastModifiedDate < ${formatSoqlDateTime(input.windowEnd)}`;
  }

  const windowStart = input.windowStart;
  const windowEnd = input.windowEnd;
  const historicalFieldWindows = [
    "CreatedDate",
    ...lifecycleSources
      .filter((source) => source.rawFieldName !== "CreatedDate")
      .map((source) => source.rawFieldName),
  ].map((fieldName) => {
    const formatter =
      fieldName === "CreatedDate" ? formatSoqlDateTime : formatSoqlDate;

    return `(${fieldName} >= ${formatter(windowStart)} AND ${fieldName} < ${formatter(windowEnd)})`;
  });

  return `${contactField} != null AND (${historicalFieldWindows.join(" OR ")})`;
}

function buildContactSnapshotRecordWithConfig(input: {
  readonly contact: SalesforceRow;
  readonly memberships: readonly SalesforceRow[];
  readonly config: ResolvedSalesforceCaptureServiceConfig;
}): SalesforceRecord {
  const salesforceContactId = getStringField(input.contact, "Id");
  const updatedAt = toIsoTimestamp(
    getStringField(input.contact, "LastModifiedDate"),
  );
  const createdAt = toIsoTimestamp(
    getStringField(input.contact, "CreatedDate"),
  );

  if (
    salesforceContactId === null ||
    updatedAt === null ||
    createdAt === null
  ) {
    return {
      recordType: "contact_snapshot_deferred",
      recordId: salesforceContactId ?? "unknown-contact",
    };
  }

  return salesforceContactSnapshotRecordSchema.parse({
    recordType: "contact_snapshot",
    recordId: salesforceContactId,
    salesforceContactId,
    displayName: getStringField(input.contact, "Name") ?? salesforceContactId,
    primaryEmail: getEmailField(input.contact, "Email"),
    primaryPhone: getPhoneField(input.contact, "Phone"),
    normalizedEmails: uniqueValues([getEmailField(input.contact, "Email")]),
    normalizedPhones: uniqueValues([getPhoneField(input.contact, "Phone")]),
    volunteerIdPlainValues: uniqueValues([
      getStringField(input.contact, "Volunteer_ID_Plain__c"),
    ]),
    createdAt,
    updatedAt,
    memberships: input.memberships.map((membership) => ({
      salesforceId: getStringField(membership, "Id"),
      projectId: getStringField(
        membership,
        input.config.membershipProjectField,
      ),
      projectName: getStringField(
        membership,
        input.config.membershipProjectNameField,
      ),
      expeditionId: getStringField(
        membership,
        input.config.membershipExpeditionField,
      ),
      expeditionName: getStringField(
        membership,
        input.config.membershipExpeditionNameField,
      ),
      role:
        input.config.membershipRoleField === null
          ? null
          : getStringField(membership, input.config.membershipRoleField),
      status: getStringField(membership, input.config.membershipStatusField),
    })),
  });
}

function buildLifecycleRecords(input: {
  readonly membership: SalesforceRow;
  readonly contact: SalesforceRow | null;
  readonly config: ResolvedSalesforceCaptureServiceConfig;
  readonly receivedAt: string;
  readonly mode: "historical" | "live";
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}): SalesforceRecord[] {
  const membershipId = getStringField(input.membership, "Id");
  const salesforceContactId = getStringField(
    input.membership,
    input.config.membershipContactField,
  );

  if (membershipId === null || salesforceContactId === null) {
    return [
      {
        recordType: "lifecycle_milestone_deferred",
        recordId: membershipId ?? "unknown-membership",
      },
    ];
  }

  const normalizedEmails = uniqueValues([
    getEmailField(input.contact ?? {}, "Email"),
  ]);
  const normalizedPhones = uniqueValues([
    getPhoneField(input.contact ?? {}, "Phone"),
  ]);
  const volunteerIdPlainValues = uniqueValues([
    getStringField(input.contact ?? {}, "Volunteer_ID_Plain__c"),
  ]);
  const projectId = getStringField(
    input.membership,
    input.config.membershipProjectField,
  );
  const projectName = getStringField(
    input.membership,
    input.config.membershipProjectNameField,
  );
  const expeditionId = getStringField(
    input.membership,
    input.config.membershipExpeditionField,
  );
  const expeditionName = getStringField(
    input.membership,
    input.config.membershipExpeditionNameField,
  );
  const records: SalesforceRecord[] = [];

  for (const lifecycleSource of lifecycleSources) {
    const occurredAt = toIsoTimestamp(
      getStringField(input.membership, lifecycleSource.rawFieldName),
    );

    if (occurredAt === null) {
      continue;
    }

    if (
      input.mode === "historical" &&
      input.windowStart !== null &&
      input.windowEnd !== null &&
      !isTimestampWithinWindow(occurredAt, {
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
      })
    ) {
      continue;
    }

    records.push(
      salesforceLifecycleRecordSchema.parse({
        recordType: "lifecycle_milestone",
        recordId: `${membershipId}:${lifecycleSource.sourceField}`,
        salesforceContactId,
        milestone: lifecycleSource.milestone,
        sourceField: lifecycleSource.sourceField,
        occurredAt,
        receivedAt: input.receivedAt,
        payloadRef: `salesforce://${encodeURIComponent(input.config.membershipObjectName)}/${encodeURIComponent(membershipId)}#${encodeURIComponent(lifecycleSource.sourceField)}`,
        checksum: sha256Json({
          membershipId,
          lifecycleSource,
          occurredAt,
          contactId: salesforceContactId,
        }),
        normalizedEmails,
        normalizedPhones,
        volunteerIdPlainValues,
        routing: {
          required: true,
          projectId,
          expeditionId,
          projectName,
          expeditionName,
        },
      }),
    );
  }

  return records;
}

function resolveTaskChannel(input: {
  readonly row: SalesforceRow;
  readonly relatedMembership: SalesforceRow | null;
  readonly config: ResolvedSalesforceCaptureServiceConfig;
}): "email" | "sms" | null {
  const rawChannelValue = getStringField(
    input.row,
    input.config.taskChannelField,
  );

  if (rawChannelValue === null) {
    return null;
  }

  const normalizedChannelValue = rawChannelValue.trim().toLowerCase();
  const emailChannelValues = new Set(
    input.config.taskEmailChannelValues.map((value) =>
      value.trim().toLowerCase(),
    ),
  );
  const smsChannelValues = new Set(
    input.config.taskSmsChannelValues.map((value) =>
      value.trim().toLowerCase(),
    ),
  );

  if (emailChannelValues.has(normalizedChannelValue)) {
    return "email";
  }

  if (smsChannelValues.has(normalizedChannelValue)) {
    return "sms";
  }

  const subject = getStringField(input.row, "Subject")?.toLowerCase() ?? null;

  if (
    normalizedChannelValue === "task" &&
    input.relatedMembership !== null &&
    subject?.includes("email:") === true
  ) {
    return "email";
  }

  return null;
}

function buildTaskRecord(input: {
  readonly task: SalesforceRow;
  readonly contact: SalesforceRow | null;
  readonly relatedMembership: SalesforceRow | null;
  readonly config: ResolvedSalesforceCaptureServiceConfig;
  readonly receivedAt: string;
}): SalesforceRecord {
  const taskId = getStringField(input.task, "Id");

  if (taskId === null) {
    return {
      recordType: "task_missing_id",
      recordId: "unknown-task",
    };
  }

  const channel = resolveTaskChannel({
    row: input.task,
    relatedMembership: input.relatedMembership,
    config: input.config,
  });

  if (channel === null) {
    return {
      recordType: "task_unmapped_channel",
      recordId: taskId,
    };
  }

  const occurredAt =
    toIsoTimestamp(
      getStringField(input.task, input.config.taskOccurredAtField),
    ) ?? toIsoTimestamp(getStringField(input.task, "CreatedDate"));

  if (occurredAt === null) {
    return {
      recordType: "task_missing_occurred_at",
      recordId: taskId,
    };
  }

  const salesforceContactId =
    getStringField(input.task, input.config.taskContactField) ??
    getStringField(input.contact ?? {}, "Id");
  const projectId =
    input.relatedMembership === null
      ? null
      : getStringField(
          input.relatedMembership,
          input.config.membershipProjectField,
        );
  const projectName =
    input.relatedMembership === null
      ? null
      : getStringField(
          input.relatedMembership,
          input.config.membershipProjectNameField,
        );
  const expeditionId =
    input.relatedMembership === null
      ? null
      : getStringField(
          input.relatedMembership,
          input.config.membershipExpeditionField,
        );
  const expeditionName =
    input.relatedMembership === null
      ? null
      : getStringField(
          input.relatedMembership,
          input.config.membershipExpeditionNameField,
        );
  const hasMembershipRoutingContext =
    projectId !== null || expeditionId !== null;
  const subject = getStringField(input.task, "Subject");
  const messageKind = classifySalesforceTaskMessageKind({
    channel,
    taskSubtype: getStringField(input.task, "TaskSubtype"),
    ownerId: getStringField(input.task, "OwnerId"),
    ownerName: getStringField(input.task, "Owner.Name"),
    ownerUsername: getStringField(input.task, "Owner.Username"),
    subject,
  }).messageKind;

  return salesforceTaskCommunicationRecordSchema.parse({
    recordType: "task_communication",
    recordId: taskId,
    channel,
    messageKind,
    salesforceContactId,
    occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: `salesforce://Task/${encodeURIComponent(taskId)}`,
    checksum: sha256Json({
      taskId,
      channel,
      messageKind,
      occurredAt,
      contactId: salesforceContactId,
      subject,
      description: getStringField(input.task, "Description"),
    }),
    subject,
    snippet:
      getStringField(input.task, input.config.taskSnippetField) ??
      subject ??
      "",
    normalizedEmails: uniqueValues([
      getEmailField(input.contact ?? {}, "Email"),
    ]),
    normalizedPhones: uniqueValues([
      getPhoneField(input.contact ?? {}, "Phone"),
    ]),
    volunteerIdPlainValues: uniqueValues([
      getStringField(input.contact ?? {}, "Volunteer_ID_Plain__c"),
    ]),
    supportingRecords: [],
    crossProviderCollapseKey:
      input.config.taskCrossProviderKeyField === null
        ? null
        : getStringField(input.task, input.config.taskCrossProviderKeyField),
    routing: {
      required: hasMembershipRoutingContext,
      projectId,
      expeditionId,
      projectName,
      expeditionName,
    },
  });
}

export interface SalesforceCaptureService {
  captureHistoricalBatch(
    payload: SalesforceHistoricalCaptureBatchPayload,
  ): Promise<CapturedBatchResponse<SalesforceRecord>>;
  captureLiveBatch(
    payload: SalesforceLiveCaptureBatchPayload,
  ): Promise<CapturedBatchResponse<SalesforceRecord>>;
  handleHttpRequest(
    request: CaptureServiceHttpRequest,
  ): Promise<CaptureServiceHttpResponse>;
}

export function createSalesforceCaptureService(
  config: SalesforceCaptureServiceConfig,
  input?: {
    readonly apiClient?: SalesforceApiClient;
    readonly now?: () => Date;
  },
): SalesforceCaptureService {
  const parsedConfig: ResolvedSalesforceCaptureServiceConfig =
    salesforceCaptureServiceConfigSchema.parse(config);
  const apiClient =
    input?.apiClient ??
    createSalesforceApiClient(
      parsedConfig,
      input?.now === undefined ? undefined : { now: input.now },
    );
  const now = input?.now ?? (() => new Date());

  async function queryRowsByIds(input: {
    readonly objectName: string;
    readonly fields: readonly string[];
    readonly recordIds: readonly string[];
    readonly extraWhere?: string;
  }): Promise<readonly SalesforceRow[]> {
    if (input.recordIds.length === 0) {
      return [];
    }

    const rows: SalesforceRow[] = [];

    for (const recordIds of chunkValues(input.recordIds, 200)) {
      const whereClauses = [
        `Id IN ${buildInClause(recordIds)}`,
        ...(input.extraWhere === undefined ? [] : [input.extraWhere]),
      ];

      rows.push(
        ...(await apiClient.queryAll(
          `SELECT ${input.fields.join(", ")} FROM ${input.objectName} WHERE ${whereClauses.join(" AND ")}`,
        )),
      );
    }

    return rows;
  }

  async function queryRowsByFieldValues(input: {
    readonly objectName: string;
    readonly fields: readonly string[];
    readonly fieldName: string;
    readonly values: readonly string[];
    readonly extraWhere?: string;
  }): Promise<readonly SalesforceRow[]> {
    if (input.values.length === 0) {
      return [];
    }

    const rows: SalesforceRow[] = [];

    for (const values of chunkValues(input.values, 200)) {
      const whereClauses = [
        `${input.fieldName} IN ${buildInClause(values)}`,
        ...(input.extraWhere === undefined ? [] : [input.extraWhere]),
      ];

      rows.push(
        ...(await apiClient.queryAll(
          `SELECT ${input.fields.join(", ")} FROM ${input.objectName} WHERE ${whereClauses.join(" AND ")}`,
        )),
      );
    }

    return rows;
  }

  async function captureSalesforceBatch(input: {
    readonly mode: "historical" | "live";
    readonly recordIds: readonly string[];
    readonly maxRecords: number;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  }): Promise<CapturedBatchResponse<SalesforceRecord>> {
    const window = parseIsoWindow({
      recordIds: input.recordIds,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    });
    const receivedAt = now().toISOString();
    const checkpointCandidates: string[] = [];

    const membershipFields = buildMembershipFields(parsedConfig);
    const taskFields = buildTaskFields(parsedConfig);
    const contactFields = buildContactFields();

    const [membershipRows, directTaskRows] = await Promise.all([
      input.recordIds.length > 0
        ? queryRowsByIds({
            objectName: parsedConfig.membershipObjectName,
            fields: membershipFields,
            recordIds: input.recordIds,
          })
        : apiClient.queryAll(
            `SELECT ${membershipFields.join(", ")} FROM ${parsedConfig.membershipObjectName} WHERE ${buildMembershipWindowWhere(
              {
                mode: input.mode,
                windowStart: window.windowStart,
                windowEnd: window.windowEnd,
                config: parsedConfig,
              },
            )}`,
          ),
      input.recordIds.length > 0
        ? queryRowsByIds({
            objectName: "Task",
            fields: taskFields,
            recordIds: input.recordIds,
            extraWhere: buildLaunchScopedTaskWhere(
              buildTaskWindowWhere(
                {
                  mode: input.mode,
                  windowStart: window.windowStart,
                  windowEnd: window.windowEnd,
                },
                parsedConfig,
              ),
              parsedConfig,
            ),
          })
        : apiClient.queryAll(
            `SELECT ${taskFields.join(", ")} FROM Task WHERE ${buildLaunchScopedTaskWhere(
              buildTaskWindowWhere(
                {
                  mode: input.mode,
                  windowStart: window.windowStart,
                  windowEnd: window.windowEnd,
                },
                parsedConfig,
              ),
              parsedConfig,
            )}`,
          ),
    ]);

    const membershipContactIds = uniqueValues(
      membershipRows.map((row) =>
        getStringField(row, parsedConfig.membershipContactField),
      ),
    );
    const taskRows =
      input.recordIds.length > 0 && membershipContactIds.length > 0
        ? dedupeRowsById([
            ...directTaskRows,
            ...(await queryRowsByFieldValues({
              objectName: "Task",
              fields: taskFields,
              fieldName: parsedConfig.taskContactField,
              values: membershipContactIds,
              extraWhere: buildLaunchScopedTaskWhere(
                buildTaskWindowWhere(
                  {
                    mode: input.mode,
                    windowStart: window.windowStart,
                    windowEnd: window.windowEnd,
                  },
                  parsedConfig,
                ),
                parsedConfig,
              ),
            })),
          ])
        : [...directTaskRows];

    const touchedContactIds = uniqueValues([
      ...membershipRows.map((row) =>
        getStringField(row, parsedConfig.membershipContactField),
      ),
      ...taskRows.map((row) =>
        getStringField(row, parsedConfig.taskContactField),
      ),
    ]);

    const contactsFromWindow =
      input.recordIds.length > 0
        ? await queryRowsByIds({
            objectName: "Contact",
            fields: contactFields,
            recordIds: input.recordIds,
            extraWhere: buildVolunteerScopedContactWhere(
              "Id != null",
              parsedConfig,
            ),
          })
        : await apiClient.queryAll(
            `SELECT ${contactFields.join(", ")} FROM Contact WHERE ${buildVolunteerScopedContactWhere(
              buildContactWindowWhere(window),
              parsedConfig,
            )}`,
          );
    const contactsById = new Map<string, SalesforceRow>();

    for (const contact of contactsFromWindow) {
      const contactId = getStringField(contact, "Id");
      if (contactId !== null) {
        contactsById.set(contactId, contact);
      }
      const updatedAt = getStringField(contact, "LastModifiedDate");
      if (updatedAt !== null) {
        checkpointCandidates.push(updatedAt);
      }
    }

    const missingTouchedContactIds = touchedContactIds.filter(
      (contactId) => !contactsById.has(contactId),
    );

    if (missingTouchedContactIds.length > 0) {
      const additionalContacts = await queryRowsByIds({
        objectName: "Contact",
        fields: contactFields,
        recordIds: missingTouchedContactIds,
        extraWhere: buildVolunteerScopedContactWhere(
          "Id != null",
          parsedConfig,
        ),
      });

      for (const contact of additionalContacts) {
        const contactId = getStringField(contact, "Id");
        if (contactId !== null) {
          contactsById.set(contactId, contact);
        }
      }
    }

    const allMembershipsForContacts =
      touchedContactIds.length === 0
        ? membershipRows
        : await queryRowsByFieldValues({
            objectName: parsedConfig.membershipObjectName,
            fields: membershipFields,
            fieldName: parsedConfig.membershipContactField,
            values: touchedContactIds,
          });
    const membershipsByContactId = new Map<string, SalesforceRow[]>();
    const membershipsById = new Map<string, SalesforceRow>();

    for (const membership of allMembershipsForContacts) {
      const membershipId = getStringField(membership, "Id");
      const contactId = getStringField(
        membership,
        parsedConfig.membershipContactField,
      );

      if (membershipId !== null) {
        membershipsById.set(membershipId, membership);
      }

      if (contactId === null) {
        continue;
      }

      const memberships = membershipsByContactId.get(contactId) ?? [];
      memberships.push(membership);
      membershipsByContactId.set(contactId, memberships);
    }

    const records: SalesforceRecord[] = [];

    for (const contact of contactsById.values()) {
      records.push(
        buildContactSnapshotRecordWithConfig({
          contact,
          memberships:
            membershipsByContactId.get(getStringField(contact, "Id") ?? "") ??
            [],
          config: parsedConfig,
        }),
      );
    }

    for (const membership of membershipRows) {
      const contactId = getStringField(
        membership,
        parsedConfig.membershipContactField,
      );
      const contact =
        contactId === null ? null : (contactsById.get(contactId) ?? null);

      records.push(
        ...buildLifecycleRecords({
          membership,
          contact,
          config: parsedConfig,
          receivedAt,
          mode: input.mode,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
        }),
      );

      const membershipUpdatedAt = getStringField(
        membership,
        "LastModifiedDate",
      );
      if (membershipUpdatedAt !== null) {
        checkpointCandidates.push(membershipUpdatedAt);
      }
    }

    for (const task of taskRows) {
      const contactId = getStringField(task, parsedConfig.taskContactField);
      const contact =
        contactId === null ? null : (contactsById.get(contactId) ?? null);
      const relatedMembership =
        membershipsById.get(getStringField(task, "WhatId") ?? "") ?? null;

      const taskRecord = buildTaskRecord({
        task,
        contact,
        relatedMembership,
        config: parsedConfig,
        receivedAt,
      });

      if (
        isTaskCommunicationRecord(taskRecord) &&
        !isTimestampWithinWindow(taskRecord.occurredAt, window)
      ) {
        continue;
      }

      records.push(taskRecord);

      const taskUpdatedAt = getStringField(task, "LastModifiedDate");
      if (taskUpdatedAt !== null) {
        checkpointCandidates.push(taskUpdatedAt);
      }
    }

    const sortedRecords = sortSalesforceRecords(records);
    const page = paginateCapturedRecords(sortedRecords, {
      cursor: input.cursor,
      maxRecords: input.maxRecords,
      getMarker: buildSalesforceCursorMarker,
    });

    return salesforceCaptureServiceResponseSchema.parse({
      records: page.records,
      nextCursor: page.nextCursor,
      checkpoint:
        checkpointCandidates
          .map((value) => toIsoTimestamp(value))
          .filter((value): value is string => value !== null)
          .sort((left, right) => left.localeCompare(right))
          .at(-1) ??
        input.checkpoint ??
        input.windowEnd ??
        null,
    });
  }

  return {
    captureHistoricalBatch(payload) {
      const parsedPayload =
        salesforceHistoricalCaptureBatchPayloadSchema.parse(payload);

      return captureSalesforceBatch({
        mode: "historical",
        recordIds: parsedPayload.recordIds,
        maxRecords: parsedPayload.maxRecords,
        cursor: parsedPayload.cursor,
        checkpoint: parsedPayload.checkpoint,
        windowStart: parsedPayload.windowStart,
        windowEnd: parsedPayload.windowEnd,
      });
    },

    captureLiveBatch(payload) {
      const parsedPayload =
        salesforceLiveCaptureBatchPayloadSchema.parse(payload);

      return captureSalesforceBatch({
        mode: "live",
        recordIds: parsedPayload.recordIds,
        maxRecords: parsedPayload.maxRecords,
        cursor: parsedPayload.cursor,
        checkpoint: parsedPayload.checkpoint,
        windowStart: parsedPayload.windowStart,
        windowEnd: parsedPayload.windowEnd,
      });
    },

    async handleHttpRequest(request) {
      if (!hasBearerToken(request, parsedConfig.bearerToken)) {
        return jsonResponse(401, {
          error: "unauthorized",
        });
      }

      if (request.method !== "POST") {
        return jsonResponse(405, {
          error: "method_not_allowed",
        });
      }

      try {
        if (request.path === "/historical") {
          const payload = parseJsonRequestBody(
            request,
            salesforceHistoricalCaptureBatchPayloadSchema,
          );

          return jsonResponse(200, await this.captureHistoricalBatch(payload));
        }

        if (request.path === "/live") {
          const payload = parseJsonRequestBody(
            request,
            salesforceLiveCaptureBatchPayloadSchema,
          );

          return jsonResponse(200, await this.captureLiveBatch(payload));
        }

        return jsonResponse(404, {
          error: "not_found",
        });
      } catch (error) {
        if (
          error instanceof z.ZodError ||
          error instanceof CaptureServiceBadRequestError
        ) {
          return jsonResponse(400, {
            error: "invalid_request",
            message: error.message,
          });
        }

        throw error;
      }
    },
  };
}
