import type { SalesforceCaptureServiceConfig } from "@as-comms/integrations";
import { createSalesforceApiClient } from "@as-comms/integrations";

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required.`);
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

export async function runInspectSfExpeditionMemberStatusesCommand(
  _args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const config = readSalesforceCaptureConfig(env);
  const statusField = config.membershipStatusField;
  const objectName = config.membershipObjectName;
  if (!statusField || !objectName) {
    throw new Error(
      "Salesforce membership status field is not configured; set SF_MEMBERSHIP_STATUS_FIELD and SF_MEMBERSHIP_OBJECT_NAME before running this op.",
    );
  }
  const client = createSalesforceApiClient(config);
  const soql = `SELECT ${statusField} FROM ${objectName} WHERE ${statusField} != null ORDER BY ${statusField}`;
  const rows = (await client.queryAll(soql)) as readonly Record<string, unknown>[];
  const distinctStatuses = Array.from(
    new Set(
      rows
        .map((row) => row[statusField])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

  for (const status of distinctStatuses) {
    console.log(status);
  }

  console.log(
    JSON.stringify({
      distinctStatuses,
      totalRows: rows.length,
    }),
  );
}
