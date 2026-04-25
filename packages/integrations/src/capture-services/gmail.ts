import {
  createCapturedBatchResponseSchema,
  type CapturedBatchResponse
} from "../capture/shared.js";
import {
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchPayloadSchema,
  integrationHealthCheckResponseSchema,
  type GmailHistoricalCaptureBatchPayload,
  type GmailLiveCaptureBatchPayload,
  type IntegrationHealthCheckResponse
} from "@as-comms/contracts";
import {
  type GmailMessageRecord,
  gmailRecordSchema,
  type GmailRecord
} from "../providers/gmail.js";
import {
  buildGmailMessageRecord,
  type GmailProviderCloseMessageInput
} from "../providers/gmail-record-builder.js";
import {
  extractGmailBodyPreviewFromPayloadResult,
  type GmailApiMessagePart
} from "../providers/gmail-body.js";
import {
  type GmailAccessTokenCacheEntry,
  GmailOAuthExchangeError,
  exchangeGmailAccessToken
} from "../providers/gmail-oauth.js";
import { z } from "zod";

import type {
  CaptureServiceHttpRequest,
  CaptureServiceHttpResponse,
  CursorMarker
} from "./shared.js";
import {
  CaptureServiceBadRequestError,
  hasBearerToken,
  isTimestampWithinWindow,
  jsonResponse,
  paginateCapturedRecords,
  parseIsoWindow,
  parseJsonRequestBody,
  sha256Json,
  uniqueValues
} from "./shared.js";

const gmailCaptureServiceResponseSchema = createCapturedBatchResponseSchema(
  gmailRecordSchema
);

const emailSchema = z.string().email();

const gmailCaptureServiceConfigSchema = z.object({
  bearerToken: z.string().min(1),
  liveAccount: emailSchema,
  projectInboxAliases: z.array(emailSchema).min(1),
  oauthClientId: z.string().min(1),
  oauthClientSecret: z.string().min(1),
  oauthRefreshToken: z.string().min(1),
  tokenUri: z
    .string()
    .url()
    .default("https://oauth2.googleapis.com/token"),
  timeoutMs: z.number().int().positive().default(15_000)
});
export type GmailCaptureServiceConfig = z.input<
  typeof gmailCaptureServiceConfigSchema
>;
type ResolvedGmailCaptureServiceConfig = z.output<
  typeof gmailCaptureServiceConfigSchema
>;

type GmailApiMessagePartSchema = z.ZodType<GmailApiMessagePart>;

const gmailApiMessagePartSchema: GmailApiMessagePartSchema = z.lazy(
  (): GmailApiMessagePartSchema =>
  z.object({
    mimeType: z.string().min(1).nullable().optional(),
    filename: z.string().nullable().optional(),
    headers: z
      .array(
        z.object({
          name: z.string().min(1),
          value: z.string()
        })
      )
      .nullable()
      .optional(),
    body: z
      .object({
        attachmentId: z.string().min(1).nullable().optional(),
        data: z.string().min(1).nullable().optional(),
        size: z.number().int().nonnegative().nullable().optional()
      })
      .nullable()
      .optional(),
    parts: z.array(gmailApiMessagePartSchema).nullable().optional()
  })
);

export const gmailMessageFullResponseSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1).optional(),
  labelIds: z.array(z.string().min(1)).default([]),
  snippet: z.string().default(""),
  internalDate: z.string().min(1),
  payload: gmailApiMessagePartSchema
});
export interface GmailMessageMetadata {
  readonly id: string;
  readonly threadId: string | null;
  readonly labelIds: readonly string[];
  readonly snippet: string;
  readonly internalDate: string;
  readonly payload: GmailApiMessagePart;
}

const liveGmailChecksumHeaderNames = new Set([
  "Date",
  "From",
  "To",
  "Cc",
  "Bcc",
  "Message-ID",
  "Delivered-To",
  "Reply-To"
]);

export interface GmailMailboxApiClient {
  listMessageIds(input: {
    readonly mailbox: string;
    readonly query: string | null;
  }): Promise<readonly string[]>;
  getMessage(input: {
    readonly mailbox: string;
    readonly messageId: string;
  }): Promise<GmailMessageMetadata | null>;
}

function selectLiveGmailChecksumHeaders(
  headers: Readonly<Record<string, string>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) =>
      liveGmailChecksumHeaderNames.has(name)
    )
  );
}

function buildHeaderRecord(
  headers: readonly { readonly name: string; readonly value: string }[]
): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header.name, header.value]));
}

function buildLiveGmailChecksum(message: GmailMessageMetadata): string {
  return sha256Json({
    id: message.id,
    threadId: message.threadId,
    internalDate: message.internalDate,
    snippet: message.snippet,
    headers: selectLiveGmailChecksumHeaders(
      buildHeaderRecord(message.payload.headers ?? [])
    )
  });
}

const gmailListResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().min(1)
      })
    )
    .default([]),
  nextPageToken: z.string().min(1).optional()
});

export async function checkGmailCaptureServiceHealth(
  config: GmailCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
    readonly timeoutMs?: number;
    readonly version?: string | null;
  }
): Promise<IntegrationHealthCheckResponse> {
  const parsedConfig = gmailCaptureServiceConfigSchema.parse(config);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  const now = input?.now ?? (() => new Date());
  const accessTokenByMailbox = new Map<string, GmailAccessTokenCacheEntry>();
  const timeoutMs = Math.min(parsedConfig.timeoutMs, input?.timeoutMs ?? 5_000);
  const checkedAt = now().toISOString();

  if (typeof fetchImplementation !== "function") {
    return integrationHealthCheckResponseSchema.parse({
      service: "gmail",
      status: "needs_attention",
      checkedAt,
      detail: "Global fetch is unavailable.",
      version: input?.version ?? null
    });
  }

  try {
    await exchangeGmailAccessToken({
      config: {
        oauthClient: {
          clientId: parsedConfig.oauthClientId,
          clientSecret: parsedConfig.oauthClientSecret,
          tokenUri: parsedConfig.tokenUri
        },
        oauthRefreshToken: parsedConfig.oauthRefreshToken,
        timeoutMs
      },
      cacheKey: parsedConfig.liveAccount,
      fetchImplementation,
      now,
      accessTokenCache: accessTokenByMailbox
    });

    return integrationHealthCheckResponseSchema.parse({
      service: "gmail",
      status: "healthy",
      checkedAt,
      detail: null,
      version: input?.version ?? null
    });
  } catch (error) {
    if (error instanceof GmailOAuthExchangeError) {
      const status =
        error.reason === "disconnected" ? "disconnected" : "needs_attention";

      return integrationHealthCheckResponseSchema.parse({
        service: "gmail",
        status,
        checkedAt,
        detail: error.message,
        version: input?.version ?? null
      });
    }

    return integrationHealthCheckResponseSchema.parse({
      service: "gmail",
      status: "needs_attention",
      checkedAt,
      detail: "Unexpected health check failure.",
      version: input?.version ?? null
    });
  }
}

export function createGmailMailboxApiClient(
  config: GmailCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
  }
): GmailMailboxApiClient {
  const parsedConfig: ResolvedGmailCaptureServiceConfig =
    gmailCaptureServiceConfigSchema.parse(config);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  const now = input?.now ?? (() => new Date());
  const accessTokenByMailbox = new Map<string, GmailAccessTokenCacheEntry>();

  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable for Gmail capture.");
  }

  async function getAccessToken(mailbox: string): Promise<string> {
    const token = await exchangeGmailAccessToken({
      config: {
        oauthClient: {
          clientId: parsedConfig.oauthClientId,
          clientSecret: parsedConfig.oauthClientSecret,
          tokenUri: parsedConfig.tokenUri
        },
        oauthRefreshToken: parsedConfig.oauthRefreshToken,
        timeoutMs: parsedConfig.timeoutMs
      },
      cacheKey: mailbox,
      fetchImplementation,
      now,
      accessTokenCache: accessTokenByMailbox
    });

    return token.accessToken;
  }

  async function gmailFetchJson<TSchema extends z.ZodType<unknown>>(input: {
    readonly mailbox: string;
    readonly url: string;
    readonly schema: TSchema;
  }): Promise<z.output<TSchema>> {
    const accessToken = await getAccessToken(input.mailbox);
    const response = await fetchImplementation(input.url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      },
      signal: AbortSignal.timeout(parsedConfig.timeoutMs)
    });

    if (response.status === 404) {
      throw new Error("not_found");
    }

    if (!response.ok) {
      throw new Error(
        `Gmail API request failed with status ${String(response.status)}.`
      );
    }

    const responsePayload: unknown = JSON.parse(await response.text());

    return input.schema.parse(responsePayload);
  }

  return {
    async listMessageIds({ mailbox, query }) {
      const messageIds = new Set<string>();
      let nextPageToken: string | undefined;

      do {
        const url = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages`
        );
        url.searchParams.set("maxResults", "500");
        url.searchParams.set("includeSpamTrash", "false");
        if (query !== null) {
          url.searchParams.set("q", query);
        }
        if (nextPageToken !== undefined) {
          url.searchParams.set("pageToken", nextPageToken);
        }

        const response = await gmailFetchJson({
          mailbox,
          url: url.toString(),
          schema: gmailListResponseSchema
        });

        for (const message of response.messages) {
          messageIds.add(message.id);
        }

        nextPageToken = response.nextPageToken;
      } while (nextPageToken !== undefined);

      return Array.from(messageIds.values()).sort((left, right) =>
        left.localeCompare(right)
      );
    },

    async getMessage({ mailbox, messageId }) {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`
      );

      url.searchParams.set("format", "full");

      try {
        const response = await gmailFetchJson({
          mailbox,
          url: url.toString(),
          schema: gmailMessageFullResponseSchema
        });

        return {
          id: response.id,
          threadId: response.threadId ?? null,
          labelIds: response.labelIds,
          snippet: response.snippet,
          internalDate: response.internalDate,
          payload: response.payload
        };
      } catch (error) {
        if (error instanceof Error && error.message === "not_found") {
          return null;
        }

        throw error;
      }
    }
  };
}

function isGmailMessageRecord(record: GmailRecord): record is GmailMessageRecord {
  return record.recordType === "message";
}

function buildGmailListQuery(input: {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}): string | null {
  if (input.windowStart === null || input.windowEnd === null) {
    return null;
  }

  const afterEpochSeconds = Math.floor(new Date(input.windowStart).getTime() / 1000);
  const beforeEpochSeconds = Math.floor(new Date(input.windowEnd).getTime() / 1000);

  return `after:${String(afterEpochSeconds)} before:${String(beforeEpochSeconds)} -in:chats -in:drafts -label:DRAFT`;
}

export async function mapLiveGmailMessageToRecord(input: {
  readonly message: GmailMessageMetadata;
  readonly capturedMailbox: string;
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
  readonly receivedAt: string;
}): Promise<GmailRecord> {
  const headers = buildHeaderRecord(input.message.payload.headers ?? []);
  const builderInput: GmailProviderCloseMessageInput = {
    recordId: input.message.id,
    threadId: input.message.threadId,
    labelIds: input.message.labelIds,
    snippet: input.message.snippet,
    snippetClean: input.message.snippet,
    ...(await extractGmailBodyPreviewFromPayloadResult(input.message.payload)),
    internalDate: input.message.internalDate,
    headers,
    payloadRef: `gmail://${encodeURIComponent(input.capturedMailbox)}/messages/${encodeURIComponent(input.message.id)}`,
    checksum: buildLiveGmailChecksum(input.message),
    capturedMailbox: input.capturedMailbox,
    receivedAt: input.receivedAt,
    internalAddresses: uniqueValues([
      input.liveAccount,
      ...input.projectInboxAliases
    ]),
    projectInboxAliases: input.projectInboxAliases
  };

  return gmailRecordSchema.parse(buildGmailMessageRecord(builderInput));
}

function buildGmailCursorMarker(record: GmailRecord): CursorMarker {
  if (isGmailMessageRecord(record)) {
    return {
      occurredAt: record.occurredAt,
      recordType: record.recordType,
      recordId: record.recordId
    };
  }

  return {
    occurredAt: "1970-01-01T00:00:00.000Z",
    recordType: record.recordType,
    recordId: record.recordId
  };
}

function sortGmailRecords(records: readonly GmailRecord[]): GmailRecord[] {
  return [...records].sort((left, right) => {
    const leftMarker = buildGmailCursorMarker(left);
    const rightMarker = buildGmailCursorMarker(right);

    if (leftMarker.occurredAt !== rightMarker.occurredAt) {
      return leftMarker.occurredAt.localeCompare(rightMarker.occurredAt);
    }

    if (leftMarker.recordType !== rightMarker.recordType) {
      return leftMarker.recordType.localeCompare(rightMarker.recordType);
    }

    return leftMarker.recordId.localeCompare(rightMarker.recordId);
  });
}

export interface GmailCaptureService {
  captureHistoricalBatch(
    payload: GmailHistoricalCaptureBatchPayload
  ): Promise<CapturedBatchResponse<GmailRecord>>;
  captureLiveBatch(
    payload: GmailLiveCaptureBatchPayload
  ): Promise<CapturedBatchResponse<GmailRecord>>;
  handleHttpRequest(
    request: CaptureServiceHttpRequest
  ): Promise<CaptureServiceHttpResponse>;
}

export function createGmailCaptureService(
  config: GmailCaptureServiceConfig,
  input?: {
    readonly apiClient?: GmailMailboxApiClient;
    readonly now?: () => Date;
  }
): GmailCaptureService {
  const parsedConfig = gmailCaptureServiceConfigSchema.parse(config);
  const now = input?.now ?? (() => new Date());
  const apiClient =
    input?.apiClient ?? createGmailMailboxApiClient(parsedConfig, { now });

  async function collectHistoricalOrLiveRecords(input: {
    readonly recordIds: readonly string[];
    readonly maxRecords: number;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  }): Promise<CapturedBatchResponse<GmailRecord>> {
    const window = parseIsoWindow({
      recordIds: input.recordIds,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd
    });
    const receivedAt = now().toISOString();
    const mailboxSet = [parsedConfig.liveAccount];
    const records: GmailRecord[] = [];
    const latestOccurredAt: string[] = [];

    for (const mailbox of mailboxSet) {
      const messageIds =
        input.recordIds.length > 0
          ? input.recordIds
          : await apiClient.listMessageIds({
              mailbox,
              query: buildGmailListQuery(window)
            });

      for (const messageId of messageIds) {
        const message = await apiClient.getMessage({
          mailbox,
          messageId
        });

        if (message === null) {
          continue;
        }

        const mappedRecord = await mapLiveGmailMessageToRecord({
          message,
          capturedMailbox: mailbox,
          liveAccount: parsedConfig.liveAccount,
          projectInboxAliases: parsedConfig.projectInboxAliases,
          receivedAt
        });

        if (
          isGmailMessageRecord(mappedRecord) &&
          !isTimestampWithinWindow(mappedRecord.occurredAt, window)
        ) {
          continue;
        }

        if (isGmailMessageRecord(mappedRecord)) {
          latestOccurredAt.push(mappedRecord.occurredAt);
        }

        records.push(mappedRecord);
      }
    }

    const sortedRecords = sortGmailRecords(records);
    const page = paginateCapturedRecords(sortedRecords, {
      cursor: input.cursor,
      maxRecords: input.maxRecords,
      getMarker: buildGmailCursorMarker
    });

    return gmailCaptureServiceResponseSchema.parse({
      records: page.records,
      nextCursor: page.nextCursor,
      checkpoint:
        latestOccurredAt.sort((left, right) => left.localeCompare(right)).at(-1) ??
        input.checkpoint ??
        input.windowEnd ??
        null
    });
  }

  return {
    captureHistoricalBatch(payload) {
      gmailHistoricalCaptureBatchPayloadSchema.parse(payload);
      throw new CaptureServiceBadRequestError(
        "Launch-scope Gmail historical backfill now uses the worker .mbox import path, not the Gmail capture service."
      );
    },

    captureLiveBatch(payload) {
      const parsedPayload = gmailLiveCaptureBatchPayloadSchema.parse(payload);

      return collectHistoricalOrLiveRecords({
        recordIds: parsedPayload.recordIds,
        maxRecords: parsedPayload.maxRecords,
        cursor: parsedPayload.cursor,
        checkpoint: parsedPayload.checkpoint,
        windowStart: parsedPayload.windowStart,
        windowEnd: parsedPayload.windowEnd
      });
    },

    async handleHttpRequest(request) {
      if (!hasBearerToken(request, parsedConfig.bearerToken)) {
        return jsonResponse(401, {
          error: "unauthorized"
        });
      }

      if (request.method !== "POST") {
        return jsonResponse(405, {
          error: "method_not_allowed"
        });
      }

      try {
        if (request.path === "/historical") {
          const payload = parseJsonRequestBody(
            request,
            gmailHistoricalCaptureBatchPayloadSchema
          );

          return jsonResponse(200, await this.captureHistoricalBatch(payload));
        }

        if (request.path === "/live") {
          const payload = parseJsonRequestBody(
            request,
            gmailLiveCaptureBatchPayloadSchema
          );

          return jsonResponse(200, await this.captureLiveBatch(payload));
        }

        return jsonResponse(404, {
          error: "not_found"
        });
      } catch (error) {
        if (
          error instanceof z.ZodError ||
          error instanceof CaptureServiceBadRequestError
        ) {
          return jsonResponse(400, {
            error: "invalid_request",
            message: error.message
          });
        }

        return jsonResponse(500, {
          error: "internal_error"
        });
      }
    }
  };
}
