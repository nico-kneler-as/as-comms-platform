import { createSign } from "node:crypto";

import {
  createCapturedBatchResponseSchema,
  type CapturedBatchResponse
} from "../capture/shared.js";
import {
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchPayloadSchema,
  type GmailHistoricalCaptureBatchPayload,
  type GmailLiveCaptureBatchPayload
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
  serviceAccountClientEmail: emailSchema,
  serviceAccountPrivateKey: z.string().min(1),
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

interface GmailMessageMetadata {
  readonly id: string;
  readonly threadId: string | null;
  readonly snippet: string;
  readonly internalDate: string;
  readonly headers: Record<string, string>;
}

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

interface GmailAccessTokenCacheEntry {
  readonly accessToken: string;
  readonly expiresAtEpochSeconds: number;
}

const gmailTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().default(3600)
});

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

const gmailMessageMetadataResponseSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1).optional(),
  snippet: z.string().default(""),
  internalDate: z.string().min(1),
  payload: z.object({
    headers: z
      .array(
        z.object({
          name: z.string().min(1),
          value: z.string()
        })
      )
      .default([])
  })
});

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/gu, "\n");
}

function createServiceAccountJwt(input: {
  readonly serviceAccountClientEmail: string;
  readonly serviceAccountPrivateKey: string;
  readonly subject: string;
  readonly tokenUri: string;
  readonly nowEpochSeconds: number;
}): string {
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const payload = {
    iss: input.serviceAccountClientEmail,
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    aud: input.tokenUri,
    exp: input.nowEpochSeconds + 3600,
    iat: input.nowEpochSeconds,
    sub: input.subject
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = createSign("RSA-SHA256");

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(normalizePrivateKey(input.serviceAccountPrivateKey));

  return `${signingInput}.${signature.toString("base64url")}`;
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
    const nowEpochSeconds = Math.floor(now().getTime() / 1000);
    const cachedToken = accessTokenByMailbox.get(mailbox);

    if (
      cachedToken !== undefined &&
      cachedToken.expiresAtEpochSeconds - 30 > nowEpochSeconds
    ) {
      return cachedToken.accessToken;
    }

    const assertion = createServiceAccountJwt({
      serviceAccountClientEmail: parsedConfig.serviceAccountClientEmail,
      serviceAccountPrivateKey: parsedConfig.serviceAccountPrivateKey,
      subject: mailbox,
      tokenUri: parsedConfig.tokenUri,
      nowEpochSeconds
    });
    const response = await fetchImplementation(parsedConfig.tokenUri, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      }).toString(),
      signal: AbortSignal.timeout(parsedConfig.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(
        `Gmail token exchange failed with status ${String(response.status)}.`
      );
    }

    const tokenJson = gmailTokenResponseSchema.parse(
      JSON.parse(await response.text()) as unknown
    );
    accessTokenByMailbox.set(mailbox, {
      accessToken: tokenJson.access_token,
      expiresAtEpochSeconds: nowEpochSeconds + tokenJson.expires_in
    });

    return tokenJson.access_token;
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

      url.searchParams.set("format", "metadata");
      for (const headerName of [
        "Date",
        "From",
        "To",
        "Cc",
        "Bcc",
        "Message-ID",
        "Delivered-To",
        "Reply-To"
      ]) {
        url.searchParams.append("metadataHeaders", headerName);
      }

      try {
        const response = await gmailFetchJson({
          mailbox,
          url: url.toString(),
          schema: gmailMessageMetadataResponseSchema
        });

        return {
          id: response.id,
          threadId: response.threadId ?? null,
          snippet: response.snippet,
          internalDate: response.internalDate,
          headers: Object.fromEntries(
            response.payload.headers.map((header) => [header.name, header.value])
          )
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

  return `after:${String(afterEpochSeconds)} before:${String(beforeEpochSeconds)} -in:chats`;
}

function mapLiveGmailMessageToRecord(input: {
  readonly message: GmailMessageMetadata;
  readonly capturedMailbox: string;
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
  readonly receivedAt: string;
}): GmailRecord {
  const builderInput: GmailProviderCloseMessageInput = {
    recordId: input.message.id,
    threadId: input.message.threadId,
    snippet: input.message.snippet,
    internalDate: input.message.internalDate,
    headers: input.message.headers,
    payloadRef: `gmail://${encodeURIComponent(input.capturedMailbox)}/messages/${encodeURIComponent(input.message.id)}`,
    checksum: sha256Json({
      id: input.message.id,
      threadId: input.message.threadId,
      internalDate: input.message.internalDate,
      snippet: input.message.snippet,
      headers: input.message.headers
    }),
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

        const mappedRecord = mapLiveGmailMessageToRecord({
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
