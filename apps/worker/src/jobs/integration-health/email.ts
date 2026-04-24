import { z } from "zod";

import {
  sendGmailMessage,
  type GmailSendResult
} from "@as-comms/integrations";
import type {
  IntegrationHealthRecord,
  IntegrationHealthStatus
} from "@as-comms/contracts";

const DEFAULT_ALERT_RECIPIENT = "nico@adventurescientists.org";
const DEFAULT_ALERT_FROM_ALIAS = "volunteers@adventurescientists.org";
const SETTINGS_INTEGRATIONS_PATH = "/settings/integrations";

const integrationHealthAlertConfigSchema = z.object({
  liveAccount: z.string().email(),
  oauthClientId: z.string().min(1),
  oauthClientSecret: z.string().min(1),
  oauthRefreshToken: z.string().min(1),
  tokenUri: z.string().url().default("https://oauth2.googleapis.com/token"),
  timeoutMs: z.number().int().positive().default(15_000),
  recipient: z.string().email().default(DEFAULT_ALERT_RECIPIENT),
  fromAlias: z.string().email().default(DEFAULT_ALERT_FROM_ALIAS),
  settingsIntegrationsUrl: z.string().url()
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

function readOptionalEmailEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string
): string {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  name: string
): string | null {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
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
    liveAccount: env.GMAIL_LIVE_ACCOUNT,
    oauthClientId: env.GMAIL_GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GMAIL_GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRefreshToken: env.GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN,
    tokenUri:
      env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
    timeoutMs:
      env.GMAIL_SEND_TIMEOUT_MS === undefined
        ? 15_000
        : Number.parseInt(env.GMAIL_SEND_TIMEOUT_MS, 10),
    recipient: readOptionalEmailEnv(
      env,
      "INTEGRATION_HEALTH_ALERT_RECIPIENT",
      DEFAULT_ALERT_RECIPIENT
    ),
    fromAlias: readOptionalEmailEnv(
      env,
      "INTEGRATION_HEALTH_ALERT_FROM_ALIAS",
      DEFAULT_ALERT_FROM_ALIAS
    ),
    settingsIntegrationsUrl: readSettingsIntegrationsUrl(env)
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
  settingsIntegrationsUrl: string
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
    "This alert won't repeat for the same service for 1 hour."
  ].join("\n");
  const bodyHtml = [
    `<p>${escapeHtml(input.service)} status flipped from ${escapeHtml(
      input.fromStatus
    )} to ${escapeHtml(input.record.status)} at ${escapeHtml(
      input.occurredAt
    )}.</p>`,
    "<p>Last error metadata:</p>",
    `<pre>${escapeHtml(metadata)}</pre>`,
    `<p><a href="${escapeHtml(
      settingsIntegrationsUrl
    )}">Settings → Integrations</a></p>`,
    "<p>This alert won't repeat for the same service for 1 hour.</p>"
  ].join("");

  return {
    subject,
    bodyPlaintext,
    bodyHtml
  };
}

export function createIntegrationHealthAlertSender(
  env: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch
): IntegrationHealthAlertSender {
  return {
    async send(input) {
      let config;

      try {
        config = readIntegrationHealthAlertConfig(env);
      } catch {
        return {
          kind: "auth_error",
          detail: "Integration health alert email is not configured."
        };
      }

      const message = buildIntegrationHealthAlertMessage(
        input,
        config.settingsIntegrationsUrl
      );

      return sendGmailMessage(
        {
          fromAlias: config.fromAlias,
          to: config.recipient,
          subject: message.subject,
          bodyPlaintext: message.bodyPlaintext,
          bodyHtml: message.bodyHtml,
          attachments: []
        },
        {
          liveAccount: config.liveAccount,
          oauthClient: {
            clientId: config.oauthClientId,
            clientSecret: config.oauthClientSecret,
            tokenUri: config.tokenUri
          },
          oauthRefreshToken: config.oauthRefreshToken,
          fetchImplementation,
          timeoutMs: config.timeoutMs
        }
      );
    }
  };
}
