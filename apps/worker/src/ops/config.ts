import { z } from "zod";

const emailSchema = z.string().email();

export class Stage1WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Stage1WorkerConfigError";
  }
}

const salesforceCaptureModeSchema = z.enum(["delta_polling", "cdc_compatible"]);

export const stage1LaunchScopeGmailConfigSchema = z.object({
  historicalBackfillMode: z.literal("mbox_import").default("mbox_import"),
  liveAccount: emailSchema.refine((value) => value.toLowerCase().startsWith("volunteers@"), {
    message: "Gmail live account must be a volunteers@... address."
  }),
  projectInboxAliases: z.array(emailSchema).min(1),
  livePollIntervalSeconds: z.number().int().positive().max(3600).default(60)
});
export type Stage1LaunchScopeGmailConfig = z.infer<
  typeof stage1LaunchScopeGmailConfigSchema
>;

export const stage1LaunchScopeSalesforceConfigSchema = z.object({
  contactCaptureMode: salesforceCaptureModeSchema,
  membershipCaptureMode: salesforceCaptureModeSchema,
  taskPollIntervalSeconds: z.number().int().positive().max(3600).default(300)
});
export type Stage1LaunchScopeSalesforceConfig = z.infer<
  typeof stage1LaunchScopeSalesforceConfigSchema
>;

export const stage1LaunchScopeConfigSchema = z.object({
  gmail: stage1LaunchScopeGmailConfigSchema,
  salesforce: stage1LaunchScopeSalesforceConfigSchema
});
export type Stage1LaunchScopeConfig = z.infer<typeof stage1LaunchScopeConfigSchema>;

function parseEmailCsvEnv(
  env: NodeJS.ProcessEnv,
  envName: string
): string[] {
  const rawValue = env[envName];

  if (rawValue === undefined || rawValue.trim().length === 0) {
    throw new Stage1WorkerConfigError(
      `${envName} is required and must be a comma-separated list of email addresses.`
    );
  }

  const values = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const parsed = z.array(emailSchema).min(1).safeParse(values);

  if (!parsed.success) {
    throw new Stage1WorkerConfigError(
      `${envName} must be a comma-separated list of valid email addresses.`
    );
  }

  return parsed.data;
}

function parseRequiredStringEnv(
  env: NodeJS.ProcessEnv,
  envName: string
): string {
  const rawValue = env[envName];

  if (rawValue === undefined || rawValue.trim().length === 0) {
    throw new Stage1WorkerConfigError(`${envName} is required.`);
  }

  return rawValue.trim();
}

function parsePositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  envName: string,
  defaultValue: number
): number {
  const rawValue = env[envName];

  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const parsed = z.coerce.number().int().positive().max(3600).safeParse(rawValue);

  if (!parsed.success) {
    throw new Stage1WorkerConfigError(
      `${envName} must be a positive integer no greater than 3600.`
    );
  }

  return parsed.data;
}

function parseSalesforceCaptureModeEnv(
  env: NodeJS.ProcessEnv,
  envName: string
): Stage1LaunchScopeSalesforceConfig["contactCaptureMode"] {
  const rawValue = parseRequiredStringEnv(env, envName);
  const parsed = salesforceCaptureModeSchema.safeParse(rawValue);

  if (!parsed.success) {
    throw new Stage1WorkerConfigError(
      `${envName} must be one of: delta_polling, cdc_compatible.`
    );
  }

  return parsed.data;
}

export function readStage1LaunchScopeConfig(
  env: NodeJS.ProcessEnv
): Stage1LaunchScopeConfig {
  return stage1LaunchScopeConfigSchema.parse({
    gmail: readStage1LaunchScopeGmailConfig(env),
    salesforce: readStage1LaunchScopeSalesforceConfig(env)
  });
}

export function readStage1LaunchScopeGmailConfig(
  env: NodeJS.ProcessEnv
): Stage1LaunchScopeGmailConfig {
  return stage1LaunchScopeGmailConfigSchema.parse({
    historicalBackfillMode: "mbox_import",
    liveAccount: parseRequiredStringEnv(env, "GMAIL_LIVE_ACCOUNT"),
    projectInboxAliases: parseEmailCsvEnv(env, "GMAIL_PROJECT_INBOX_ALIASES"),
    livePollIntervalSeconds: parsePositiveIntegerEnv(
      env,
      "GMAIL_LIVE_POLL_INTERVAL_SECONDS",
      60
    )
  });
}

export function readStage1LaunchScopeSalesforceConfig(
  env: NodeJS.ProcessEnv
): Stage1LaunchScopeSalesforceConfig {
  return stage1LaunchScopeSalesforceConfigSchema.parse({
    contactCaptureMode: parseSalesforceCaptureModeEnv(
      env,
      "SALESFORCE_CONTACT_CAPTURE_MODE"
    ),
    membershipCaptureMode: parseSalesforceCaptureModeEnv(
      env,
      "SALESFORCE_MEMBERSHIP_CAPTURE_MODE"
    ),
    taskPollIntervalSeconds: parsePositiveIntegerEnv(
      env,
      "SALESFORCE_TASK_POLL_INTERVAL_SECONDS",
      300
    )
  });
}

export interface Stage1SafeRuntimeConfigSummary {
  readonly concurrency: number;
  readonly gmail: {
    readonly historicalBackfillMode: Stage1LaunchScopeGmailConfig["historicalBackfillMode"];
    readonly liveAccount: string;
    readonly projectInboxAliases: readonly string[];
    readonly livePollIntervalSeconds: number;
    readonly captureBaseUrl: string;
  };
  readonly salesforce: {
    readonly contactCaptureMode: Stage1LaunchScopeSalesforceConfig["contactCaptureMode"];
    readonly membershipCaptureMode: Stage1LaunchScopeSalesforceConfig["membershipCaptureMode"];
    readonly taskPollIntervalSeconds: number;
    readonly captureBaseUrl: string;
  };
  readonly deferredProviders: {
    readonly simpleTextingConfigured: boolean;
    readonly mailchimpConfigured: boolean;
  };
}
