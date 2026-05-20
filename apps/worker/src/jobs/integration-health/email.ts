import { z } from "zod";

import type { OpsAlertStateRepository } from "@as-comms/domain";
import type {
  IntegrationHealthRecord,
  IntegrationHealthStatus,
} from "@as-comms/contracts";
import type { GmailSendResult } from "@as-comms/integrations";

import { sendOpsAlertMessage } from "../../ops-alert/sender.js";

const DEFAULT_ALERT_RECIPIENT = "nico@adventurescientists.org";
const DEFAULT_ALERT_FROM_ALIAS = "volunteers@adventurescientists.org";
const SETTINGS_INTEGRATIONS_PATH = "/settings/integrations";

const integrationHealthAlertConfigSchema = z.object({
  settingsIntegrationsUrl: z.string().url(),
});

export interface IntegrationHealthAlertInput {
  readonly service: string;
  readonly fromStatus: IntegrationHealthStatus;
  readonly record: IntegrationHealthRecord;
  readonly occurredAt: string;
}

export interface IntegrationHealthAlertSender {
  send(input: IntegrationHealthAlertInput): Promise<GmailSendResult>;
}

function createNoopOpsAlertStateRepository(): OpsAlertStateRepository {
  return {
    getLastSentAt() {
      return Promise.resolve(null);
    },
    recordSent() {
      return Promise.resolve();
    },
  };
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function readIntegrationHealthAlertRecipient(
  env: NodeJS.ProcessEnv,
): string {
  const explicit = env.INTEGRATION_HEALTH_ALERT_RECIPIENT?.trim();

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const opsAlertRecipient = env.OPS_ALERT_RECIPIENT?.trim();
  return opsAlertRecipient && opsAlertRecipient.length > 0
    ? opsAlertRecipient
    : DEFAULT_ALERT_RECIPIENT;
}

export function readIntegrationHealthAlertFromAlias(
  env: NodeJS.ProcessEnv,
): string {
  const explicit = env.INTEGRATION_HEALTH_ALERT_FROM_ALIAS?.trim();

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const opsAlertAlias = env.OPS_ALERT_FROM_ALIAS?.trim();
  return opsAlertAlias && opsAlertAlias.length > 0
    ? opsAlertAlias
    : DEFAULT_ALERT_FROM_ALIAS;
}

function readSettingsIntegrationsUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.INTEGRATION_HEALTH_ALERT_SETTINGS_URL?.trim();

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const baseUrl =
    readOptionalStringEnv(env, "NEXT_PUBLIC_APP_URL") ??
    readOptionalStringEnv(env, "APP_BASE_URL") ??
    readOptionalStringEnv(env, "WEB_BASE_URL") ??
    readOptionalStringEnv(env, "INBOX_REVALIDATE_BASE_URL") ??
    "";

  return new URL(SETTINGS_INTEGRATIONS_PATH, baseUrl).toString();
}

function readIntegrationHealthAlertConfig(env: NodeJS.ProcessEnv) {
  return integrationHealthAlertConfigSchema.parse({
    settingsIntegrationsUrl: readSettingsIntegrationsUrl(env),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function stringifyMetadata(record: IntegrationHealthRecord): string {
  return JSON.stringify(record.metadataJson, null, 2);
}

export function buildIntegrationHealthAlertMessage(
  input: IntegrationHealthAlertInput,
  settingsIntegrationsUrl: string,
) {
  const metadata = stringifyMetadata(input.record);
  const subject = `[AS Comms] ${input.service} integration degraded — ${input.record.status}`;
  const bodyPlaintext = [
    `${input.service} status flipped from ${input.fromStatus} to ${input.record.status} at ${input.occurredAt}.`,
    "",
    "Last error metadata:",
    metadata,
    "",
    `Settings → Integrations: ${settingsIntegrationsUrl}`,
    "",
    "This alert won't repeat for the same service for 1 hour.",
  ].join("\n");
  const bodyHtml = [
    `<p>${escapeHtml(input.service)} status flipped from ${escapeHtml(
      input.fromStatus,
    )} to ${escapeHtml(input.record.status)} at ${escapeHtml(
      input.occurredAt,
    )}.</p>`,
    "<p>Last error metadata:</p>",
    `<pre>${escapeHtml(metadata)}</pre>`,
    `<p><a href="${escapeHtml(
      settingsIntegrationsUrl,
    )}">Settings → Integrations</a></p>`,
    "<p>This alert won't repeat for the same service for 1 hour.</p>",
  ].join("");

  return {
    subject,
    bodyPlaintext,
    bodyHtml,
  };
}

function mapOpsAlertResultToLegacyGmailResult(
  result: Awaited<ReturnType<typeof sendOpsAlertMessage>>,
): GmailSendResult {
  switch (result.kind) {
    case "success":
      return result;
    case "skipped_cooldown":
      return {
        kind: "transient",
        detail: `Integration health alert skipped due to cooldown (${result.lastSentAt}).`,
      };
    default:
      return result;
  }
}

export function createIntegrationHealthAlertSenderWithStateRepository(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
  readonly stateRepository: OpsAlertStateRepository;
}): IntegrationHealthAlertSender {
  const env = input.env ?? process.env;
  const fetchImplementation = input.fetchImplementation ?? fetch;

  return {
    async send(alertInput) {
      let config;

      try {
        config = readIntegrationHealthAlertConfig(env);
      } catch {
        return {
          kind: "auth_error",
          detail: "Integration health alert email is not configured.",
        };
      }

      const message = buildIntegrationHealthAlertMessage(
        alertInput,
        config.settingsIntegrationsUrl,
      );

      const result = await sendOpsAlertMessage(
        {
          env: {
            ...env,
            OPS_ALERT_RECIPIENT: readIntegrationHealthAlertRecipient(env),
            OPS_ALERT_FROM_ALIAS: readIntegrationHealthAlertFromAlias(env),
            OPS_ALERT_DEFAULT_COOLDOWN_MS:
              env.OPS_ALERT_DEFAULT_COOLDOWN_MS?.trim().length
                ? env.OPS_ALERT_DEFAULT_COOLDOWN_MS
                : "3600000",
          },
          fetchImplementation,
          stateRepository: input.stateRepository,
        },
        {
          category: "integration_health",
          dedupKey: alertInput.service,
          rendered: message,
        },
      );

      return mapOpsAlertResultToLegacyGmailResult(result);
    },
  };
}

export function createIntegrationHealthAlertSender(
  env: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
): IntegrationHealthAlertSender {
  return createIntegrationHealthAlertSenderWithStateRepository({
    env,
    fetchImplementation,
    stateRepository: createNoopOpsAlertStateRepository(),
  });
}
