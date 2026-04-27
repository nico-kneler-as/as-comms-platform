import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  type GmailAccessTokenCacheEntry,
  type GmailOAuthClient,
  GmailOAuthExchangeError,
  exchangeGmailAccessToken
} from "./gmail-oauth.js";

const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

const emailSchema = z.string().email();

const gmailAttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  contentBase64: z.string().min(1)
});

const gmailSendParamsSchema = z.object({
  fromAlias: emailSchema,
  to: emailSchema,
  cc: z.array(emailSchema).optional(),
  bcc: z.array(emailSchema).optional(),
  subject: z.string(),
  bodyPlaintext: z.string(),
  bodyHtml: z.string(),
  attachments: z.array(gmailAttachmentSchema),
  threadId: z.string().min(1).optional(),
  inReplyToRfc822MessageId: z.string().min(1).optional(),
  referencesRfc822MessageIds: z.array(z.string().min(1)).optional()
});

const gmailSendConfigSchema = z.object({
  liveAccount: emailSchema,
  oauthClient: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    tokenUri: z.string().url().default("https://oauth2.googleapis.com/token")
  }),
  oauthRefreshToken: z.string().min(1),
  fetchImplementation: z.custom<typeof fetch>(
    (value) => typeof value === "function",
    {
      message: "fetchImplementation must be a function."
    }
  ),
  timeoutMs: z.number().int().positive().default(15_000),
  now: z.function().returns(z.date()).optional(),
  accessTokenCache: z
    .custom<Map<string, GmailAccessTokenCacheEntry>>(
      (value) => value instanceof Map
    )
    .optional()
});

const gmailSendApiSuccessSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1).optional()
});

const gmailApiErrorSchema = z
  .object({
    error: z.object({
      code: z.number().int().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
      errors: z
        .array(
          z.object({
            message: z.string().optional(),
            domain: z.string().optional(),
            reason: z.string().optional()
          })
        )
        .optional()
    })
  })
  .partial();

export interface GmailSendParams {
  readonly fromAlias: string;
  readonly to: string;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly attachments: readonly GmailAttachment[];
  readonly threadId?: string;
  readonly inReplyToRfc822MessageId?: string;
  readonly referencesRfc822MessageIds?: readonly string[];
}

export interface GmailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly contentBase64: string;
}

export interface GmailSendConfig {
  readonly liveAccount: string;
  readonly oauthClient: GmailOAuthClient;
  readonly oauthRefreshToken: string;
  readonly fetchImplementation: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly accessTokenCache?: Map<string, GmailAccessTokenCacheEntry>;
}

export interface GmailSendSuccess {
  readonly kind: "success";
  readonly gmailMessageId: string;
  readonly gmailThreadId: string;
  readonly rfc822MessageId: string;
}

export type GmailSendError =
  | { readonly kind: "auth_error"; readonly detail: string }
  | { readonly kind: "scope_error"; readonly detail: string }
  | { readonly kind: "send_as_not_authorized"; readonly alias: string }
  | { readonly kind: "invalid_recipient"; readonly detail: string }
  | { readonly kind: "attachment_too_large"; readonly totalBytes: number }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "transient"; readonly detail: string }
  | { readonly kind: "permanent"; readonly detail: string };

export type GmailSendResult = GmailSendSuccess | GmailSendError;

interface BuiltGmailMimeMessage {
  readonly raw: string;
  readonly rfc822MessageId: string;
}

function normalizeHeaderWhitespace(value: string): string {
  return value.replace(/\r?\n+/gu, " ").trim();
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").replace(/\n/gu, "\r\n");
}

function needsEncodedWord(value: string): boolean {
  return /[^\x20-\x7E]/u.test(value);
}

function encodeHeaderWordUtf8(value: string): string {
  const normalizedValue = normalizeHeaderWhitespace(value);

  if (normalizedValue.length === 0) {
    return "";
  }

  if (!needsEncodedWord(normalizedValue)) {
    return normalizedValue;
  }

  return `=?UTF-8?B?${Buffer.from(normalizedValue, "utf8").toString("base64")}?=`;
}

function foldBase64(value: string): string {
  return value.replace(/.{1,76}/gu, "$&\r\n").replace(/\r\n$/u, "");
}

function escapeQuotedHeaderValue(value: string): string {
  return value.replace(/(["\\])/gu, "\\$1");
}

function buildMessageId(fromAlias: string, now: Date): string {
  const domain = fromAlias.split("@")[1] ?? "local.invalid";
  return `<${String(now.getTime())}.${randomUUID()}@${domain}>`;
}

function buildBoundary(): string {
  return `ascomms_${randomUUID()}`;
}

function countAttachmentBytes(attachments: readonly GmailAttachment[]): number {
  let totalBytes = 0;

  for (const attachment of attachments) {
    totalBytes += Buffer.from(attachment.contentBase64, "base64").length;
  }

  return totalBytes;
}

function buildTextPart(bodyPlaintext: string): string {
  return [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(bodyPlaintext)
  ].join("\r\n");
}

function buildHtmlPart(bodyHtml: string): string {
  return [
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(bodyHtml)
  ].join("\r\n");
}

function buildAlternativePart(input: {
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly boundary: string;
}): string {
  return [
    `--${input.boundary}`,
    buildTextPart(input.bodyPlaintext),
    `--${input.boundary}`,
    buildHtmlPart(input.bodyHtml),
    `--${input.boundary}--`,
    ""
  ].join("\r\n");
}

function buildAttachmentPart(attachment: GmailAttachment): string {
  return [
    `Content-Type: ${normalizeHeaderWhitespace(attachment.contentType)}; name="${escapeQuotedHeaderValue(attachment.filename)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${escapeQuotedHeaderValue(attachment.filename)}"`,
    "",
    foldBase64(
      Buffer.from(attachment.contentBase64, "base64").toString("base64")
    )
  ].join("\r\n");
}

function formatAddressHeader(addresses: readonly string[]): string {
  return addresses.map((address) => `<${address}>`).join(", ");
}

function buildMimeMessage(
  params: z.output<typeof gmailSendParamsSchema>,
  now: Date
): BuiltGmailMimeMessage {
  const rfc822MessageId = buildMessageId(params.fromAlias, now);
  const headers = [
    `Date: ${now.toUTCString()}`,
    `From: "Adventure Scientists" <${params.fromAlias}>`,
    `To: <${params.to}>`,
    `Subject: ${encodeHeaderWordUtf8(params.subject)}`,
    `Message-ID: ${rfc822MessageId}`,
    "MIME-Version: 1.0"
  ];

  if (params.cc !== undefined && params.cc.length > 0) {
    headers.push(`Cc: ${formatAddressHeader(params.cc)}`);
  }

  if (params.bcc !== undefined && params.bcc.length > 0) {
    headers.push(`Bcc: ${formatAddressHeader(params.bcc)}`);
  }

  if (params.inReplyToRfc822MessageId !== undefined) {
    headers.push(
      `In-Reply-To: ${normalizeHeaderWhitespace(params.inReplyToRfc822MessageId)}`
    );
  }

  if (
    params.referencesRfc822MessageIds !== undefined &&
    params.referencesRfc822MessageIds.length > 0
  ) {
    headers.push(
      `References: ${params.referencesRfc822MessageIds
        .map((messageId) => normalizeHeaderWhitespace(messageId))
        .join(" ")}`
    );
  }

  const alternativeBoundary = buildBoundary();
  const alternativePart = buildAlternativePart({
    bodyPlaintext: params.bodyPlaintext,
    bodyHtml: params.bodyHtml,
    boundary: alternativeBoundary
  });

  if (params.attachments.length === 0) {
    const message = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      alternativePart
    ].join("\r\n");

    return {
      raw: Buffer.from(message, "utf8").toString("base64url"),
      rfc822MessageId
    };
  }

  const boundary = buildBoundary();
  const parts = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    alternativePart,
    ...params.attachments.flatMap((attachment) => [
      `--${boundary}`,
      buildAttachmentPart(attachment)
    ]),
    `--${boundary}--`,
    ""
  ];
  const message = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    parts.join("\r\n")
  ].join("\r\n");

  return {
    raw: Buffer.from(message, "utf8").toString("base64url"),
    rfc822MessageId
  };
}

function parseRetryAfterSeconds(retryAfterHeader: string | null): number | null {
  if (retryAfterHeader === null) {
    return null;
  }

  const numericValue = Number.parseInt(retryAfterHeader, 10);

  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  const retryAt = Date.parse(retryAfterHeader);

  if (Number.isNaN(retryAt)) {
    return null;
  }

  const retryAfterSeconds = Math.ceil((retryAt - Date.now()) / 1000);
  return retryAfterSeconds > 0 ? retryAfterSeconds : 0;
}

function readGmailErrorText(input: z.infer<typeof gmailApiErrorSchema>): string {
  const topLevelMessage = input.error?.message?.trim();

  if (topLevelMessage !== undefined && topLevelMessage.length > 0) {
    return topLevelMessage;
  }

  const nestedMessage = input.error?.errors
    ?.map((entry) => entry.message?.trim() ?? "")
    .find((value) => value.length > 0);

  return nestedMessage && nestedMessage.length > 0
    ? nestedMessage
    : "Gmail API request failed.";
}

function isScopeError(input: z.infer<typeof gmailApiErrorSchema>): boolean {
  const messages = [
    input.error?.message ?? "",
    ...(input.error?.errors?.map((entry) => entry.message ?? "") ?? []),
    ...(input.error?.errors?.map((entry) => entry.reason ?? "") ?? [])
  ].join(" ");

  return (
    /insufficientpermissions/iu.test(messages) ||
    /insufficient authentication scopes/iu.test(messages)
  );
}

function isSendAsError(input: z.infer<typeof gmailApiErrorSchema>): boolean {
  const haystack = [
    input.error?.message ?? "",
    ...(input.error?.errors?.map((entry) => entry.message ?? "") ?? []),
    ...(input.error?.errors?.map((entry) => entry.reason ?? "") ?? [])
  ].join(" ");

  return /(invalid from|from address|send as|delegation denied)/iu.test(haystack);
}

function isInvalidRecipientError(input: z.infer<typeof gmailApiErrorSchema>): boolean {
  const haystack = [
    input.error?.message ?? "",
    ...(input.error?.errors?.map((entry) => entry.message ?? "") ?? []),
    ...(input.error?.errors?.map((entry) => entry.reason ?? "") ?? [])
  ].join(" ");

  return /(invalid to header|recipient address rejected|invalid recipient|invalid argument)/iu.test(
    haystack
  );
}

async function mapSendError(input: {
  readonly response: Response;
  readonly fromAlias: string;
}): Promise<GmailSendError> {
  const responseText = await input.response.text();
  let parsedError: z.infer<typeof gmailApiErrorSchema> | null = null;

  try {
    parsedError = gmailApiErrorSchema.parse(JSON.parse(responseText) as unknown);
  } catch {
    parsedError = null;
  }

  const detail =
    parsedError === null
      ? `Gmail API request failed with status ${String(input.response.status)}.`
      : readGmailErrorText(parsedError);

  if (input.response.status === 401) {
    return {
      kind: "auth_error",
      detail
    };
  }

  if (input.response.status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSeconds: parseRetryAfterSeconds(
        input.response.headers.get("retry-after")
      )
    };
  }

  if (input.response.status >= 500) {
    return {
      kind: "transient",
      detail
    };
  }

  if (parsedError !== null && isSendAsError(parsedError)) {
    return {
      kind: "send_as_not_authorized",
      alias: input.fromAlias
    };
  }

  if (parsedError !== null && isInvalidRecipientError(parsedError)) {
    return {
      kind: "invalid_recipient",
      detail
    };
  }

  if (parsedError !== null && isScopeError(parsedError)) {
    return {
      kind: "scope_error",
      detail
    };
  }

  return {
    kind: "permanent",
    detail
  };
}

export async function sendGmailMessage(
  params: GmailSendParams,
  config: GmailSendConfig
): Promise<GmailSendResult> {
  let parsedParams: z.output<typeof gmailSendParamsSchema>;

  try {
    parsedParams = gmailSendParamsSchema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        kind: "invalid_recipient",
        detail: error.issues.map((issue) => issue.message).join("; ")
      };
    }

    throw error;
  }

  const parsedConfig = gmailSendConfigSchema.parse(config);
  const totalAttachmentBytes = countAttachmentBytes(parsedParams.attachments);

  if (totalAttachmentBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    return {
      kind: "attachment_too_large",
      totalBytes: totalAttachmentBytes
    };
  }

  const now = parsedConfig.now ?? (() => new Date());
  const builtMessage = buildMimeMessage(parsedParams, now());
  const accessTokenCache =
    config.accessTokenCache ?? new Map<string, GmailAccessTokenCacheEntry>();

  let accessToken: string;

  try {
    const token = await exchangeGmailAccessToken({
      config: {
        oauthClient: parsedConfig.oauthClient,
        oauthRefreshToken: parsedConfig.oauthRefreshToken,
        timeoutMs: parsedConfig.timeoutMs
      },
      cacheKey: parsedConfig.liveAccount,
      fetchImplementation: parsedConfig.fetchImplementation,
      now,
      accessTokenCache
    });
    accessToken = token.accessToken;
  } catch (error) {
    if (error instanceof GmailOAuthExchangeError) {
      return {
        kind: "auth_error",
        detail: error.message
      };
    }

    return {
      kind: "transient",
      detail: "OAuth token exchange failed unexpectedly."
    };
  }

  let response: Response;

  try {
    response = await parsedConfig.fetchImplementation(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          raw: builtMessage.raw,
          ...(parsedParams.threadId === undefined
            ? {}
            : { threadId: parsedParams.threadId })
        }),
        signal: AbortSignal.timeout(parsedConfig.timeoutMs)
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        kind: "transient",
        detail: "Gmail send request timed out."
      };
    }

    return {
      kind: "transient",
      detail: "Gmail send request failed."
    };
  }

  if (!response.ok) {
    return mapSendError({
      response,
      fromAlias: parsedParams.fromAlias
    });
  }

  const responsePayload = gmailSendApiSuccessSchema.parse(
    JSON.parse(await response.text()) as unknown
  );

  return {
    kind: "success",
    gmailMessageId: responsePayload.id,
    gmailThreadId: responsePayload.threadId ?? parsedParams.threadId ?? responsePayload.id,
    rfc822MessageId: builtMessage.rfc822MessageId
  };
}
