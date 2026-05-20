import { z } from "zod";

import type { OpsAlertStateRepository } from "@as-comms/domain";
import {
  sendGmailMessage,
  type GmailSendResult,
} from "@as-comms/integrations";

const DEFAULT_ALERT_RECIPIENT = "nico@adventurescientists.org";
const DEFAULT_ALERT_FROM_ALIAS = "volunteers@adventurescientists.org";
const DEFAULT_COOLDOWN_MS = 3_600_000;

const opsAlertConfigSchema = z.object({
  liveAccount: z.string().email(),
  oauthClientId: z.string().min(1),
  oauthClientSecret: z.string().min(1),
  oauthRefreshToken: z.string().min(1),
  tokenUri: z.string().url().default("https://oauth2.googleapis.com/token"),
  timeoutMs: z.number().int().positive().default(15_000),
  recipient: z.string().email().default(DEFAULT_ALERT_RECIPIENT),
  fromAlias: z.string().email().default(DEFAULT_ALERT_FROM_ALIAS),
  cooldownMs: z.number().int().positive().default(DEFAULT_COOLDOWN_MS),
});

export interface OpsAlertInput {
  readonly category: string;
  readonly dedupKey: string;
  readonly severity: "s1" | "s2";
  readonly summary: string;
  readonly categoryLabel: string;
  readonly detail: readonly { readonly label: string; readonly value: string }[];
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly firstObservedAt: string;
  readonly occurredAt: string;
}

export interface RenderedOpsAlertInput {
  readonly category: string;
  readonly dedupKey: string;
  readonly rendered: {
    readonly subject: string;
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  };
}

export type OpsAlertSendInput = OpsAlertInput | RenderedOpsAlertInput;

export type OpsAlertSendResult =
  | { readonly kind: "sent"; readonly gmailMessageId: string }
  | { readonly kind: "skipped_cooldown"; readonly lastSentAt: string }
  | { readonly kind: "auth_error"; readonly detail: string }
  | { readonly kind: "transport_error"; readonly detail: string };

type RawOpsAlertSendResult =
  | GmailSendResult
  | { readonly kind: "skipped_cooldown"; readonly lastSentAt: string };

export interface OpsAlertSender {
  send(input: OpsAlertSendInput): Promise<OpsAlertSendResult>;
}

function readOptionalEmailEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readOptionalPositiveIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = readOptionalStringEnv(env, name);

  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCategoryEnvSuffix(category: string): string {
  return category
    .trim()
    .replace(/[^a-zA-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toUpperCase();
}

function resolveRecipient(env: NodeJS.ProcessEnv, category: string): string {
  if (category === "integration_health") {
    return readOptionalEmailEnv(
      env,
      "INTEGRATION_HEALTH_ALERT_RECIPIENT",
      readOptionalEmailEnv(
        env,
        "OPS_ALERT_RECIPIENT",
        DEFAULT_ALERT_RECIPIENT,
      ),
    );
  }

  return readOptionalEmailEnv(
    env,
    "OPS_ALERT_RECIPIENT",
    DEFAULT_ALERT_RECIPIENT,
  );
}

function resolveFromAlias(env: NodeJS.ProcessEnv, category: string): string {
  if (category === "integration_health") {
    return readOptionalEmailEnv(
      env,
      "INTEGRATION_HEALTH_ALERT_FROM_ALIAS",
      readOptionalEmailEnv(
        env,
        "OPS_ALERT_FROM_ALIAS",
        DEFAULT_ALERT_FROM_ALIAS,
      ),
    );
  }

  return readOptionalEmailEnv(
    env,
    "OPS_ALERT_FROM_ALIAS",
    DEFAULT_ALERT_FROM_ALIAS,
  );
}

function resolveCooldownMs(env: NodeJS.ProcessEnv, category: string): number {
  const categoryEnvName = `OPS_ALERT_COOLDOWN_MS__${normalizeCategoryEnvSuffix(
    category,
  )}`;

  return readOptionalPositiveIntEnv(
    env,
    categoryEnvName,
    readOptionalPositiveIntEnv(
      env,
      "OPS_ALERT_DEFAULT_COOLDOWN_MS",
      DEFAULT_COOLDOWN_MS,
    ),
  );
}

function readOpsAlertConfig(env: NodeJS.ProcessEnv, category: string) {
  return opsAlertConfigSchema.parse({
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
    recipient: resolveRecipient(env, category),
    fromAlias: resolveFromAlias(env, category),
    cooldownMs: resolveCooldownMs(env, category),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function formatDurationHuman(cooldownMs: number): string {
  if (cooldownMs % 3_600_000 === 0) {
    const hours = cooldownMs / 3_600_000;
    return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
  }

  if (cooldownMs % 60_000 === 0) {
    const minutes = cooldownMs / 60_000;
    return `${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  }

  if (cooldownMs % 1_000 === 0) {
    const seconds = cooldownMs / 1_000;
    return `${String(seconds)} second${seconds === 1 ? "" : "s"}`;
  }

  return `${String(cooldownMs)} ms`;
}

function buildSectionLines(
  items: readonly { readonly label: string; readonly value: string }[],
): readonly string[] {
  if (items.length === 0) {
    return ["  None"];
  }

  return items.map((item) => `  ${item.label}: ${item.value}`);
}

function buildLinkSectionLines(
  links: readonly { readonly label: string; readonly url: string }[],
): readonly string[] {
  if (links.length === 0) {
    return ["  None"];
  }

  return links.map((link) => `  ${link.label}: ${link.url}`);
}

function buildDefinitionListHtml(
  items: readonly { readonly label: string; readonly value: string }[],
): string {
  if (items.length === 0) {
    return "<p>None</p>";
  }

  return `<dl>${items
    .map(
      (item) =>
        `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`,
    )
    .join("")}</dl>`;
}

function buildLinkDefinitionListHtml(
  links: readonly { readonly label: string; readonly url: string }[],
): string {
  if (links.length === 0) {
    return "<p>None</p>";
  }

  return `<dl>${links
    .map(
      (link) =>
        `<dt>${escapeHtml(link.label)}</dt><dd><a href="${escapeHtml(
          link.url,
        )}">${escapeHtml(link.url)}</a></dd>`,
    )
    .join("")}</dl>`;
}

function truncateSubject(summary: string, prefix: string): string {
  const maxLength = 120;

  if (prefix.length >= maxLength) {
    return prefix.slice(0, maxLength - 1) + "…";
  }

  const availableSummaryLength = maxLength - prefix.length;

  if (summary.length <= availableSummaryLength) {
    return `${prefix}${summary}`;
  }

  return `${prefix}${summary.slice(0, availableSummaryLength - 1)}…`;
}

function buildGenericMessage(input: OpsAlertInput, cooldownMs: number) {
  const cooldownHuman = formatDurationHuman(cooldownMs);
  const subject = truncateSubject(
    input.summary,
    `[AS Comms] ${input.categoryLabel}: `,
  );
  const bodyPlaintext = [
    "Summary",
    `  ${input.summary}`,
    "",
    "First observed at",
    `  ${input.firstObservedAt}`,
    "",
    "Identifiers",
    ...buildSectionLines(input.detail),
    "",
    "Detail",
    ...buildSectionLines(input.detail),
    "",
    "Action links",
    ...buildLinkSectionLines(input.links),
    "",
    `This alert will not repeat for the same dedup key for ${cooldownHuman} (category: ${input.category}).`,
  ].join("\n");
  const bodyHtml = [
    "<h2>Summary</h2>",
    `<p>${escapeHtml(input.summary)}</p>`,
    "<h2>First observed at</h2>",
    `<p>${escapeHtml(input.firstObservedAt)}</p>`,
    "<h2>Identifiers</h2>",
    buildDefinitionListHtml(input.detail),
    "<h2>Detail</h2>",
    buildDefinitionListHtml(input.detail),
    "<h2>Action links</h2>",
    buildLinkDefinitionListHtml(input.links),
    `<p>This alert will not repeat for the same dedup key for ${escapeHtml(
      cooldownHuman,
    )} (category: ${escapeHtml(input.category)}).</p>`,
  ].join("");

  return {
    subject,
    bodyPlaintext,
    bodyHtml,
  };
}

function buildTransportErrorDetail(result: Exclude<GmailSendResult, { kind: "success" }>): string {
  switch (result.kind) {
    case "send_as_not_authorized":
      return result.alias;
    case "attachment_too_large":
      return `Attachment payload too large (${String(result.totalBytes)} bytes).`;
    case "rate_limited":
      return result.retryAfterSeconds === null
        ? "Gmail send rate limited."
        : `Gmail send rate limited (${String(result.retryAfterSeconds)}s).`;
    default:
      return result.detail;
  }
}

function buildStructuredLogPayload(input: {
  readonly event: string;
  readonly category: string;
  readonly dedupKey: string;
  readonly detail: string;
}): string {
  return JSON.stringify(input);
}

export async function sendOpsAlertMessage(
  deps: {
    readonly env?: NodeJS.ProcessEnv;
    readonly fetchImplementation?: typeof fetch;
    readonly stateRepository: OpsAlertStateRepository;
    readonly now?: () => Date;
  },
  input: OpsAlertSendInput,
): Promise<RawOpsAlertSendResult> {
  const env = deps.env ?? process.env;
  const fetchImplementation = deps.fetchImplementation ?? fetch;
  const now = deps.now ?? (() => new Date());

  let config;

  try {
    config = readOpsAlertConfig(env, input.category);
  } catch {
    const detail = "Ops alert email is not configured.";
    console.warn(
      buildStructuredLogPayload({
        event: "ops_alert.auth_error",
        category: input.category,
        dedupKey: input.dedupKey,
        detail,
      }),
    );
    return {
      kind: "auth_error",
      detail,
    };
  }

  const currentTime = now();
  const lastSent =
    await deps.stateRepository.getLastSentAt(input.category, input.dedupKey);

  if (lastSent !== null) {
    const lastSentAt = Date.parse(lastSent.lastSentAt);

    if (
      Number.isFinite(lastSentAt) &&
      currentTime.getTime() - lastSentAt < config.cooldownMs
    ) {
      return {
        kind: "skipped_cooldown",
        lastSentAt: lastSent.lastSentAt,
      };
    }
  }

  const message =
    "rendered" in input
      ? input.rendered
      : buildGenericMessage(input, config.cooldownMs);
  const sendResult = await sendGmailMessage(
    {
      fromAlias: config.fromAlias,
      to: config.recipient,
      subject: message.subject,
      bodyPlaintext: message.bodyPlaintext,
      bodyHtml: message.bodyHtml,
      attachments: [],
    },
    {
      liveAccount: config.liveAccount,
      oauthClient: {
        clientId: config.oauthClientId,
        clientSecret: config.oauthClientSecret,
        tokenUri: config.tokenUri,
      },
      oauthRefreshToken: config.oauthRefreshToken,
      fetchImplementation,
      timeoutMs: config.timeoutMs,
    },
  );

  if (sendResult.kind !== "success") {
    console.error(
      buildStructuredLogPayload({
        event:
          sendResult.kind === "auth_error"
            ? "ops_alert.auth_error"
            : "ops_alert.transport_error",
        category: input.category,
        dedupKey: input.dedupKey,
        detail: buildTransportErrorDetail(sendResult),
      }),
    );
    return sendResult;
  }

  await deps.stateRepository.recordSent({
    category: input.category,
    dedupKey: input.dedupKey,
    sentAt: currentTime.toISOString(),
    status: "sent",
  });

  return sendResult;
}

export function createOpsAlertSender(deps: {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
  readonly stateRepository: OpsAlertStateRepository;
  readonly now?: () => Date;
}): OpsAlertSender {
  return {
    async send(input) {
      const result = await sendOpsAlertMessage(deps, input);

      switch (result.kind) {
        case "success":
          return {
            kind: "sent",
            gmailMessageId: result.gmailMessageId,
          };
        case "skipped_cooldown":
          return result;
        case "auth_error":
          return {
            kind: "auth_error",
            detail: result.detail,
          };
        default:
          return {
            kind: "transport_error",
            detail: buildTransportErrorDetail(result),
          };
      }
    },
  };
}
