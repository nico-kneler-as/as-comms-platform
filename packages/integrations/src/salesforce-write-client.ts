import {
  salesforceSubscriptionBoxFieldByValue,
  subscriptionPreferenceChangeSchema,
  type SubscriptionPreferenceChange,
} from "@as-comms/contracts";
import { z } from "zod";

import {
  exchangeSalesforceAccessToken,
  type SalesforceAccessTokenCacheEntry,
} from "./capture-services/salesforce.js";

const EMAIL_SUBSCRIPTION_PREFERENCE_OBJECT = "Email_Subscription_Preference__c";
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_RECORDS_PER_REQUEST = 200;
const salesforceIdPattern = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/u;

const configSchema = z.object({
  loginUrl: z.string().url(),
  clientId: z.string().min(1),
  username: z.string().min(1),
  jwtPrivateKey: z.string().min(1),
  jwtExpirationSeconds: z.number().int().positive().default(180),
  apiVersion: z.string().min(1).default("61.0"),
  timeoutMs: z.number().int().positive().default(15_000),
});
export type SalesforceWriteClientConfig = z.input<typeof configSchema>;
type ResolvedSalesforceWriteClientConfig = z.output<typeof configSchema>;

export interface SalesforceWriteErrorDetails {
  readonly kind: "transient" | "permanent" | "permission";
  readonly code: string;
  readonly message: string;
}

export interface SubscriptionPreferenceUpsertResult {
  readonly email: string;
  readonly outcome: "created" | "updated" | "failed";
  readonly salesforceId: string | null;
  readonly error: SalesforceWriteErrorDetails | null;
}

export class SalesforceWriteError extends Error {
  constructor(
    message: string,
    readonly kind: SalesforceWriteErrorDetails["kind"],
    readonly httpStatus: number | null,
    readonly code: string,
    readonly completedResults: readonly SubscriptionPreferenceUpsertResult[] = [],
  ) {
    super(message);
    this.name = "SalesforceWriteError";
  }
}

export interface SalesforceWriteClient {
  upsertSubscriptionPreferences(
    changes: readonly SubscriptionPreferenceChange[],
  ): Promise<readonly SubscriptionPreferenceUpsertResult[]>;
  setExpeditionMemberStatus(memberId: string, status: string): Promise<void>;
}

interface SalesforceErrorBody {
  readonly errorCode: string;
  readonly message: string;
}

function truncateMessage(value: string): string {
  return value.length > MAX_ERROR_MESSAGE_LENGTH
    ? value.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : value;
}

function errorBody(value: unknown): SalesforceErrorBody {
  const candidate: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "object" || candidate === null) {
    return {
      errorCode: "SALESFORCE_ERROR",
      message: "Salesforce returned an error.",
    };
  }
  const record = candidate as Record<string, unknown>;
  return {
    errorCode:
      typeof record.errorCode === "string" && record.errorCode.length > 0
        ? record.errorCode
        : "SALESFORCE_ERROR",
    message:
      typeof record.message === "string" && record.message.length > 0
        ? truncateMessage(record.message)
        : "Salesforce returned an error.",
  };
}

async function parseErrorBody(
  response: Response,
): Promise<SalesforceErrorBody> {
  try {
    return errorBody(JSON.parse(await response.text()) as unknown);
  } catch {
    return {
      errorCode: "SALESFORCE_ERROR",
      message: "Salesforce returned an invalid error response.",
    };
  }
}

function classifyError(input: {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
}): SalesforceWriteErrorDetails["kind"] {
  const { code, message, status } = input;
  if (
    code === "INSUFFICIENT_ACCESS_OR_READONLY" ||
    code === "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY" ||
    code === "INVALID_FIELD_FOR_INSERT_UPDATE" ||
    (code === "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY" &&
      /access/iu.test(message))
  ) {
    return "permission";
  }
  if (
    code === "UNABLE_TO_LOCK_ROW" ||
    code === "REQUEST_LIMIT_EXCEEDED" ||
    code === "SERVER_UNAVAILABLE" ||
    code.startsWith("TXN_SECURITY_") ||
    (status !== undefined && status >= 500)
  ) {
    return "transient";
  }
  if (status === 401 || status === 403) {
    return "permission";
  }
  return "permanent";
}

function classifyWholeCallError(input: {
  readonly status: number;
  readonly body: SalesforceErrorBody;
}): SalesforceWriteErrorDetails["kind"] {
  if (input.status === 403) return "permission";
  if (
    input.status >= 500 ||
    input.body.errorCode === "REQUEST_LIMIT_EXCEEDED"
  ) {
    return "transient";
  }
  if (
    input.status === 400 &&
    ["INVALID_FIELD", "INVALID_TYPE", "NOT_FOUND"].includes(
      input.body.errorCode,
    )
  ) {
    return "permission";
  }
  return classifyError({
    code: input.body.errorCode,
    message: input.body.message,
    status: input.status,
  });
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return z.string().email().safeParse(value).success;
}

function toRecord(
  change: SubscriptionPreferenceChange,
  email: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    attributes: { type: EMAIL_SUBSCRIPTION_PREFERENCE_OBJECT },
    Email__c: email,
  };
  if (hasOwn(change, "contactId")) record.Contact__c = change.contactId;
  if (hasOwn(change, "generalNewsletter")) {
    record.Adventure_Scientists_General_Newsletter__c =
      change.generalNewsletter;
  }
  if (hasOwn(change, "projectBoxes") && change.projectBoxes !== undefined) {
    for (const [box, enabled] of Object.entries(change.projectBoxes)) {
      if (enabled !== undefined) {
        record[
          salesforceSubscriptionBoxFieldByValue[
            box as keyof typeof salesforceSubscriptionBoxFieldByValue
          ]
        ] = enabled;
      }
    }
  }
  if (hasOwn(change, "oregonShoresNewsletter")) {
    record.Oregon_Shores_Newsletter__c = change.oregonShoresNewsletter;
  }
  if (hasOwn(change, "unsubscribedFromAll")) {
    record.Unsubscribed_from_all__c = change.unsubscribedFromAll;
  }
  if (hasOwn(change, "unsubscribedAt"))
    record.Unsubscribed_at__c = change.unsubscribedAt;
  if (hasOwn(change, "emailBounced"))
    record.Email_Bounced__c = change.emailBounced;
  if (hasOwn(change, "creationSource")) {
    record.Record_Creation_Source__c = change.creationSource;
  }
  return record;
}

function failedResult(
  email: string,
  code: string,
  message: string,
): SubscriptionPreferenceUpsertResult {
  return {
    email,
    outcome: "failed",
    salesforceId: null,
    error: { kind: "permanent", code, message: truncateMessage(message) },
  };
}

export function createSalesforceWriteClient(
  config: SalesforceWriteClientConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
  },
): SalesforceWriteClient {
  const parsedConfig: ResolvedSalesforceWriteClientConfig =
    configSchema.parse(config);
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  const now = input?.now ?? (() => new Date());
  let accessTokenCache: SalesforceAccessTokenCacheEntry | null = null;

  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable for Salesforce writes.");
  }

  async function token(
    forceRefresh = false,
  ): Promise<SalesforceAccessTokenCacheEntry> {
    accessTokenCache = await exchangeSalesforceAccessToken({
      config: parsedConfig,
      fetchImplementation,
      now,
      accessTokenCache: forceRefresh ? null : accessTokenCache,
      timeoutMs: parsedConfig.timeoutMs,
    });
    return accessTokenCache;
  }

  async function patch(path: string, body: unknown): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let currentToken: SalesforceAccessTokenCacheEntry;
      try {
        currentToken = await token(attempt === 1);
      } catch {
        throw new SalesforceWriteError(
          "Salesforce token exchange failed.",
          "transient",
          null,
          "TOKEN_EXCHANGE_FAILED",
        );
      }
      let response: Response;
      try {
        response = await fetchImplementation(
          new URL(path, currentToken.instanceUrl),
          {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${currentToken.accessToken}`,
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(parsedConfig.timeoutMs),
          },
        );
      } catch {
        throw new SalesforceWriteError(
          "Salesforce write request failed.",
          "transient",
          null,
          "NETWORK_ERROR",
        );
      }
      if (response.status !== 401 || attempt === 1) return response;
      accessTokenCache = null;
    }
    throw new SalesforceWriteError(
      "Salesforce authentication failed.",
      "permission",
      401,
      "UNAUTHORIZED",
    );
  }

  async function requireSuccess(
    path: string,
    body: unknown,
    expectedStatus: number,
  ): Promise<void> {
    const response = await patch(path, body);
    if (response.status === expectedStatus) return;
    const parsed = await parseErrorBody(response);
    throw new SalesforceWriteError(
      parsed.message,
      classifyWholeCallError({ status: response.status, body: parsed }),
      response.status,
      parsed.errorCode,
    );
  }

  return {
    async upsertSubscriptionPreferences(changes) {
      const parsedChanges = changes.map((change) =>
        subscriptionPreferenceChangeSchema.parse(change),
      );
      const normalizedEmails = parsedChanges.map((change) =>
        normalizeEmail(change.email),
      );
      const seenEmails = new Set<string>();
      for (const [index, email] of normalizedEmails.entries()) {
        if (seenEmails.has(email)) {
          // Index only: callers log this message, and it must not carry PII.
          throw new Error(
            `Duplicate normalized subscription preference email at index ${String(index)}.`,
          );
        }
        seenEmails.add(email);
      }

      const results: SubscriptionPreferenceUpsertResult[] =
        normalizedEmails.map((email) =>
          isEmail(email)
            ? { email, outcome: "failed", salesforceId: null, error: null }
            : failedResult(
                email,
                "INVALID_EMAIL_INPUT",
                "Email input is invalid after normalization.",
              ),
        );
      const valid = parsedChanges.flatMap((change, index) => {
        const email = normalizedEmails[index];
        return email !== undefined && isEmail(email)
          ? [{ change, email, index }]
          : [];
      });
      const completedResults: SubscriptionPreferenceUpsertResult[] = [];

      for (
        let start = 0;
        start < valid.length;
        start += MAX_RECORDS_PER_REQUEST
      ) {
        const chunk = valid.slice(start, start + MAX_RECORDS_PER_REQUEST);
        let response: Response;
        try {
          response = await patch(
            `/services/data/v${parsedConfig.apiVersion}/composite/sobjects/${EMAIL_SUBSCRIPTION_PREFERENCE_OBJECT}/Email__c`,
            {
              allOrNone: false,
              records: chunk.map((entry) =>
                toRecord(entry.change, entry.email),
              ),
            },
          );
        } catch (error) {
          if (error instanceof SalesforceWriteError) {
            throw new SalesforceWriteError(
              error.message,
              error.kind,
              error.httpStatus,
              error.code,
              completedResults,
            );
          }
          throw error;
        }
        if (!response.ok) {
          const parsed = await parseErrorBody(response);
          throw new SalesforceWriteError(
            parsed.message,
            classifyWholeCallError({ status: response.status, body: parsed }),
            response.status,
            parsed.errorCode,
            completedResults,
          );
        }
        let payload: unknown;
        try {
          payload = JSON.parse(await response.text());
        } catch {
          throw new SalesforceWriteError(
            "Salesforce returned an invalid write response.",
            "transient",
            response.status,
            "INVALID_RESPONSE",
            completedResults,
          );
        }
        if (!Array.isArray(payload) || payload.length !== chunk.length) {
          throw new SalesforceWriteError(
            "Salesforce returned an incomplete write response.",
            "transient",
            response.status,
            "INVALID_RESPONSE",
            completedResults,
          );
        }
        for (const [offset, responseRecord] of payload.entries()) {
          const entry = chunk[offset];
          if (entry === undefined) continue;
          if (typeof responseRecord !== "object" || responseRecord === null) {
            // A malformed per-record result is retryable, never a silent
            // "failed" without a reason.
            results[entry.index] = {
              email: entry.email,
              outcome: "failed",
              salesforceId: null,
              error: {
                kind: "transient",
                code: "INVALID_RESPONSE",
                message: "Salesforce returned a malformed record result.",
              },
            };
            continue;
          }
          const record = responseRecord as Record<string, unknown>;
          if (record.success === true) {
            results[entry.index] = {
              email: entry.email,
              outcome: record.created === true ? "created" : "updated",
              salesforceId: typeof record.id === "string" ? record.id : null,
              error: null,
            };
          } else {
            const parsed = errorBody(record.errors);
            results[entry.index] = {
              email: entry.email,
              outcome: "failed",
              salesforceId: null,
              error: {
                kind: classifyError({
                  code: parsed.errorCode,
                  message: parsed.message,
                }),
                code: parsed.errorCode,
                message: parsed.message,
              },
            };
          }
        }
        for (const entry of chunk) {
          const completedResult = results[entry.index];
          if (completedResult === undefined) {
            throw new SalesforceWriteError(
              "Salesforce returned an incomplete write response.",
              "transient",
              response.status,
              "INVALID_RESPONSE",
              completedResults,
            );
          }
          completedResults.push(completedResult);
        }
      }
      return results;
    },

    async setExpeditionMemberStatus(memberId, status) {
      const trimmedStatus = status.trim();
      if (!salesforceIdPattern.test(memberId)) {
        throw new Error(
          "memberId must be a 15- or 18-character Salesforce ID.",
        );
      }
      if (trimmedStatus.length === 0) {
        throw new Error("status must not be empty.");
      }
      await requireSuccess(
        `/services/data/v${parsedConfig.apiVersion}/sobjects/Expedition_Members__c/${memberId}`,
        { Status__c: trimmedStatus },
        204,
      );
    },
  };
}
