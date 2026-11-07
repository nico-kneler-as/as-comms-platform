import process from "node:process";

import {
  salesforceSubscriptionBoxFieldByValue,
  salesforceSubscriptionBoxValues,
} from "@as-comms/contracts";
import {
  createSalesforceWriteClient,
  exchangeSalesforceJwtBearerAccessToken,
  type SalesforceWriteClientConfig,
} from "@as-comms/integrations";

import { parseCliFlags, readOptionalStringFlag } from "./helpers.js";

type Severity = "PASS" | "FAIL" | "WARN";
interface CheckResult {
  readonly severity: Severity;
  readonly label: string;
}
interface DescribeField {
  readonly name: string;
  readonly createable?: boolean;
  readonly updateable?: boolean;
  readonly externalId?: boolean;
  readonly caseSensitive?: boolean;
  readonly picklistValues?: readonly {
    readonly value?: string;
    readonly active?: boolean;
  }[];
}
interface DescribeResponse {
  readonly createable?: boolean;
  readonly updateable?: boolean;
  readonly deletable?: boolean;
  readonly fields?: readonly DescribeField[];
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(`${key} is required.`);
  return value;
}

function optionalPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${key} must be a positive integer.`);
  return value;
}

export function readSalesforceWriteConfig(
  env: NodeJS.ProcessEnv,
): SalesforceWriteClientConfig {
  return {
    loginUrl: requiredEnv(env, "SALESFORCE_LOGIN_URL"),
    clientId: requiredEnv(env, "SALESFORCE_CLIENT_ID"),
    username: requiredEnv(env, "SALESFORCE_USERNAME"),
    jwtPrivateKey: requiredEnv(env, "SALESFORCE_JWT_PRIVATE_KEY"),
    jwtExpirationSeconds: optionalPositiveInt(
      env,
      "SALESFORCE_JWT_EXPIRATION_SECONDS",
      180,
    ),
    apiVersion:
      (env.SALESFORCE_API_VERSION?.trim().length ?? 0) > 0
        ? (env.SALESFORCE_API_VERSION ?? "").trim()
        : "61.0",
  };
}

function result(severity: Severity, label: string): CheckResult {
  return { severity, label };
}

function fieldByName(
  describe: DescribeResponse,
  name: string,
): DescribeField | undefined {
  return describe.fields?.find((field) => field.name === name);
}

function fieldChecks(describe: DescribeResponse, name: string): CheckResult[] {
  const field = fieldByName(describe, name);
  if (field === undefined)
    return [result("FAIL", `ESP field ${name} is missing`)];
  return [
    result(
      field.createable === true ? "PASS" : "FAIL",
      `ESP field ${name} createable`,
    ),
    result(
      field.updateable === true ? "PASS" : "FAIL",
      `ESP field ${name} updateable`,
    ),
  ];
}

export function evaluateSubscriptionPermissions(input: {
  readonly esp: DescribeResponse;
  readonly members: DescribeResponse;
  readonly projects: DescribeResponse;
}): readonly CheckResult[] {
  const checks: CheckResult[] = [
    result(
      input.esp.createable === true ? "PASS" : "FAIL",
      "ESP object createable",
    ),
    result(
      input.esp.updateable === true ? "PASS" : "FAIL",
      "ESP object updateable",
    ),
    result(
      input.esp.deletable === false ? "PASS" : "WARN",
      "ESP object deletable (integration user can delete)",
    ),
  ];
  for (const name of [
    "Email__c",
    "Contact__c",
    "Record_Creation_Source__c",
    "Adventure_Scientists_General_Newsletter__c",
    ...Object.values(salesforceSubscriptionBoxFieldByValue),
    "Oregon_Shores_Newsletter__c",
    "Unsubscribed_from_all__c",
    "Unsubscribed_at__c",
    "Email_Bounced__c",
  ])
    checks.push(...fieldChecks(input.esp, name));
  const email = fieldByName(input.esp, "Email__c");
  checks.push(
    result(email?.externalId === true ? "PASS" : "FAIL", "Email__c externalId"),
  );
  checks.push(
    result(
      email?.caseSensitive === true ? "WARN" : "PASS",
      `Email__c caseSensitive=${String(email?.caseSensitive)}${email?.caseSensitive === true ? " (upsert matching is case-sensitive; client lowercases)" : ""}`,
    ),
  );
  checks.push(
    result(
      input.members.updateable === true ? "PASS" : "FAIL",
      "Expedition_Members__c object updateable",
    ),
  );
  const status = fieldByName(input.members, "Status__c");
  checks.push(
    result(
      status?.updateable === true ? "PASS" : "FAIL",
      "Expedition_Members__c.Status__c updateable",
    ),
  );
  checks.push(
    result(
      input.members.deletable === false ? "PASS" : "WARN",
      "Expedition_Members__c deletable (integration user can delete)",
    ),
  );
  const box = fieldByName(input.projects, "Subscription_Box__c");
  checks.push(
    result(
      box === undefined ? "FAIL" : "PASS",
      "Project__c.Subscription_Box__c readable",
    ),
  );
  checks.push(
    result(
      box?.updateable === false ? "PASS" : "WARN",
      "Project__c.Subscription_Box__c updateable (more than needed)",
    ),
  );
  const actual = new Set(
    (box?.picklistValues ?? [])
      .filter((value) => value.active !== false)
      .flatMap((value) => (value.value === undefined ? [] : [value.value])),
  );
  const expected = new Set<string>(salesforceSubscriptionBoxValues);
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  checks.push(
    result(
      missing.length === 0 && extra.length === 0 ? "PASS" : "FAIL",
      `Project__c.Subscription_Box__c picklist values${missing.length + extra.length === 0 ? "" : ` (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`}`,
    ),
  );
  return checks;
}

export async function runCheckSfSubscriptionPermissions(input: {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
  readonly logger?: Pick<Console, "log" | "error">;
}): Promise<number> {
  const flags = parseCliFlags(input.args);
  const writeProbe = flags["write-probe"] === true;
  const probeEmail = readOptionalStringFlag(flags, "email");
  if (writeProbe && !probeEmail?.includes("+")) {
    throw new Error("--write-probe requires --email with a + address.");
  }
  if (!writeProbe && probeEmail !== null) {
    throw new Error("--email is only valid with --write-probe.");
  }
  const logger = input.logger ?? console;
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function")
    throw new Error("Global fetch is unavailable.");
  const config = readSalesforceWriteConfig(input.env);
  const session = await exchangeSalesforceJwtBearerAccessToken(config, {
    fetchImplementation,
  });
  const describe = async (objectName: string): Promise<DescribeResponse> => {
    const response = await fetchImplementation(
      new URL(
        `/services/data/v${config.apiVersion ?? "61.0"}/sobjects/${objectName}/describe`,
        session.instanceUrl,
      ),
      {
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          accept: "application/json",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `Describe ${objectName} failed with status ${String(response.status)}.`,
      );
    return JSON.parse(await response.text()) as DescribeResponse;
  };
  const [esp, members, projects] = await Promise.all([
    describe("Email_Subscription_Preference__c"),
    describe("Expedition_Members__c"),
    describe("Project__c"),
  ]);
  logger.log(`Salesforce username: ${config.username}`);
  const checks = evaluateSubscriptionPermissions({ esp, members, projects });
  for (const check of checks) logger.log(`${check.severity} ${check.label}`);
  if (writeProbe && probeEmail !== null) {
    const [probe] = await createSalesforceWriteClient(config, {
      fetchImplementation,
    }).upsertSubscriptionPreferences([
      { email: probeEmail, creationSource: "Houston permission probe" },
    ]);
    logger.log(
      `WRITE PROBE ${probe?.outcome ?? "failed"} ${probe?.error?.code ?? ""}`.trim(),
    );
  }
  return checks.some((check) => check.severity === "FAIL") ? 1 : 0;
}

async function main(): Promise<void> {
  process.exitCode = await runCheckSfSubscriptionPermissions({
    args: process.argv.slice(2),
    env: process.env,
  });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
