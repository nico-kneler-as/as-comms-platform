import { z } from "zod";

const DEFAULT_ALERT_RECIPIENT = "nico@adventurescientists.org";
const DEFAULT_ALERT_FROM_ALIAS = "volunteers@adventurescientists.org";
const SETTINGS_LOGS_PATH = "/settings/logs";
const SETTINGS_INTEGRATIONS_PATH = "/settings/integrations";

const opsDigestLinkConfigSchema = z.object({
  settingsLogsUrl: z.string().url(),
  settingsIntegrationsUrl: z.string().url(),
});

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function readOpsDigestRecipient(env: NodeJS.ProcessEnv): string {
  const explicit = env.OPS_DIGEST_RECIPIENT?.trim();

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const opsAlertRecipient = env.OPS_ALERT_RECIPIENT?.trim();
  return opsAlertRecipient && opsAlertRecipient.length > 0
    ? opsAlertRecipient
    : DEFAULT_ALERT_RECIPIENT;
}

export function readOpsDigestFromAlias(env: NodeJS.ProcessEnv): string {
  const explicit = env.OPS_DIGEST_FROM_ALIAS?.trim();

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const opsAlertAlias = env.OPS_ALERT_FROM_ALIAS?.trim();
  return opsAlertAlias && opsAlertAlias.length > 0
    ? opsAlertAlias
    : DEFAULT_ALERT_FROM_ALIAS;
}

function readBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    readOptionalStringEnv(env, "NEXT_PUBLIC_APP_URL") ??
    readOptionalStringEnv(env, "APP_BASE_URL") ??
    readOptionalStringEnv(env, "WEB_BASE_URL") ??
    readOptionalStringEnv(env, "INBOX_REVALIDATE_BASE_URL") ??
    ""
  );
}

export function readOpsDigestLinks(env: NodeJS.ProcessEnv) {
  const baseUrl = readBaseUrl(env);

  return opsDigestLinkConfigSchema.parse({
    settingsLogsUrl: new URL(SETTINGS_LOGS_PATH, baseUrl).toString(),
    settingsIntegrationsUrl: new URL(
      SETTINGS_INTEGRATIONS_PATH,
      baseUrl,
    ).toString(),
  });
}
