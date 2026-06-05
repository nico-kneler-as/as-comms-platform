import { createHmac, timingSafeEqual } from "node:crypto";

import {
  postmarkWebhookEventSchema,
  type PostmarkWebhookEvent,
} from "@as-comms/contracts";

const DEFAULT_POSTMARK_BASE_URL = "https://api.postmarkapp.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BATCH_SIZE = 500;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 250;
const POSTMARK_TEST_TOKEN = "POSTMARK_API_TEST";

export interface PostmarkBatchMessage {
  readonly From: string;
  readonly To: string;
  readonly Cc?: string;
  readonly Bcc?: string;
  readonly ReplyTo?: string;
  readonly Subject: string;
  readonly Tag?: string;
  readonly HtmlBody?: string;
  readonly TextBody?: string;
  readonly MessageStream?: string;
  readonly Metadata?: Record<string, string>;
  readonly Headers?: readonly {
    readonly Name: string;
    readonly Value: string;
  }[];
  readonly TrackOpens?: boolean;
  readonly TrackLinks?: "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly";
}

export interface PostmarkBatchSendRequest {
  readonly messages: readonly PostmarkBatchMessage[];
  readonly isTest?: boolean;
}

export interface PostmarkBatchSendResult {
  readonly ErrorCode: number;
  readonly Message: string;
  readonly MessageID: string;
  readonly SubmittedAt: string;
  readonly To: string;
}

export interface PostmarkBatchSendResponse {
  readonly results: readonly PostmarkBatchSendResult[];
}

export interface PostmarkSenderDnsRecord {
  readonly kind: "dkim" | "return_path";
  readonly host: string;
  readonly type: "TXT" | "CNAME";
  readonly value: string;
}

export interface PostmarkSenderStatus {
  readonly status: "unverified" | "pending" | "verified" | "rejected";
  readonly domain: string;
  readonly domainId: number | null;
  readonly returnPathDomain: string | null;
  readonly dnsRecords: readonly PostmarkSenderDnsRecord[];
  readonly raw: Record<string, unknown> | null;
}

export interface PostmarkClient {
  sendBatch(req: PostmarkBatchSendRequest): Promise<PostmarkBatchSendResponse>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  getSenderDomainStatus(domain: string): Promise<PostmarkSenderStatus>;
}

interface PostmarkDomainRecord {
  readonly ID: number;
  readonly Name: string;
}

interface PostmarkDomainListResponse {
  readonly TotalCount: number;
  readonly Domains: readonly PostmarkDomainRecord[];
}

interface PostmarkDomainDetailResponse {
  readonly ID: number;
  readonly Name: string;
  readonly DKIMVerified: boolean;
  readonly DKIMHost: string;
  readonly DKIMTextValue: string;
  readonly DKIMPendingHost: string;
  readonly DKIMPendingTextValue: string;
  readonly DKIMRevokedHost: string;
  readonly DKIMRevokedTextValue: string;
  readonly DKIMUpdateStatus: string;
  readonly ReturnPathDomain: string;
  readonly ReturnPathDomainVerified: boolean;
  readonly ReturnPathDomainCNAMEValue: string;
}

class PostmarkProviderError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(input: {
    readonly message: string;
    readonly status?: number | null;
    readonly retryable?: boolean;
  }) {
    super(input.message);
    this.name = "PostmarkProviderError";
    this.status = input.status ?? null;
    this.retryable = input.retryable ?? false;
  }
}

function maskToken(token: string): string {
  return token.length === 0 ? "pm_***" : `${token.slice(0, 3)}***`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const value = (baseUrl ?? DEFAULT_POSTMARK_BASE_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function createConcurrencyLimiter(maxConcurrent: number): <T>(
  work: () => Promise<T>,
) => Promise<T> {
  let activeCount = 0;
  const queue: (() => void)[] = [];

  function release(): void {
    activeCount = Math.max(0, activeCount - 1);
    const next = queue.shift();
    if (next !== undefined) {
      next();
    }
  }

  return async function runLimited<T>(work: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }

    activeCount += 1;

    try {
      return await work();
    } finally {
      release();
    }
  };
}

function computeWebhookSignature(
  secret: string,
  rawBody: string,
): {
  readonly base64: string;
  readonly hex: string;
} {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return {
    base64: digest.toString("base64"),
    hex: digest.toString("hex"),
  };
}

function normalizeReceivedSignature(signature: string): string[] {
  const trimmed = signature.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const unprefixed = trimmed.replace(/^sha256=/iu, "");
  return trimmed === unprefixed ? [trimmed] : [trimmed, unprefixed];
}

function signaturesMatch(expected: string, received: string): boolean {
  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received, "utf8"),
  );
}

function parseWebhookEvent(rawBody: string): PostmarkWebhookEvent {
  return postmarkWebhookEventSchema.parse(JSON.parse(rawBody) as unknown);
}

function assertBatchSize(messages: readonly PostmarkBatchMessage[]): void {
  if (messages.length === 0) {
    throw new PostmarkProviderError({
      message: "Postmark batch send requires at least one message.",
    });
  }

  if (messages.length > MAX_BATCH_SIZE) {
    throw new PostmarkProviderError({
      message: `Postmark batch send accepts at most ${String(MAX_BATCH_SIZE)} messages per request.`,
    });
  }
}

function sanitizeErrorMessage(
  status: number,
  token: string,
  detail: string | null,
): string {
  const detailPart =
    detail === null || detail.trim().length === 0
      ? ""
      : ` ${detail.trim()}`;
  return `Postmark request failed with status ${String(status)} using token ${maskToken(token)}.${detailPart}`;
}

function readDetailText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  if ("Message" in payload && typeof payload.Message === "string") {
    return payload.Message;
  }

  if ("ErrorCode" in payload && typeof payload.ErrorCode === "number") {
    return `ErrorCode ${String(payload.ErrorCode)}`;
  }

  return null;
}

function normalizeSenderStatus(
  domain: string,
  detail: PostmarkDomainDetailResponse,
): PostmarkSenderStatus {
  const dkimHost = detail.DKIMPendingHost || detail.DKIMHost;
  const dkimValue = detail.DKIMPendingTextValue || detail.DKIMTextValue;
  const dnsRecords: PostmarkSenderDnsRecord[] = [];

  if (dkimHost.length > 0 && dkimValue.length > 0) {
    dnsRecords.push({
      kind: "dkim",
      host: dkimHost,
      type: "TXT",
      value: dkimValue,
    });
  }

  if (
    detail.ReturnPathDomain.length > 0 &&
    detail.ReturnPathDomainCNAMEValue.length > 0
  ) {
    dnsRecords.push({
      kind: "return_path",
      host: detail.ReturnPathDomain,
      type: "CNAME",
      value: detail.ReturnPathDomainCNAMEValue,
    });
  }

  const verified =
    detail.DKIMVerified && detail.ReturnPathDomainVerified;
  const pending =
    !verified &&
    (detail.DKIMUpdateStatus.toLowerCase() === "pending" ||
      detail.DKIMPendingHost.length > 0 ||
      detail.ReturnPathDomain.length > 0);

  return {
    status: verified ? "verified" : pending ? "pending" : "unverified",
    domain,
    domainId: detail.ID,
    returnPathDomain:
      detail.ReturnPathDomain.length === 0 ? null : detail.ReturnPathDomain,
    dnsRecords,
    raw: detail as unknown as Record<string, unknown>,
  };
}

export function createPostmarkClient(opts: {
  readonly serverToken: string;
  readonly webhookSigningSecret: string;
  readonly accountToken?: string | null;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}): PostmarkClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const runLimited = createConcurrencyLimiter(8);
  const accountToken = opts.accountToken?.trim() ?? null;

  async function executeJsonRequest<T>(input: {
    readonly path: string;
    readonly method?: "GET" | "POST";
    readonly token: string;
    readonly tokenHeader: "X-Postmark-Server-Token" | "X-Postmark-Account-Token";
    readonly body?: unknown;
    readonly extraHeaders?: Record<string, string>;
    readonly retry5xx?: boolean;
  }): Promise<T> {
    const body =
      input.body === undefined ? undefined : JSON.stringify(input.body);

    let attempt = 0;
    for (;;) {
      attempt += 1;

      let response: Response;
      try {
        response = await runLimited(() =>
          fetchImpl(`${baseUrl}${input.path}`, {
            method: input.method ?? "GET",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              [input.tokenHeader]: input.token,
              ...(input.extraHeaders ?? {}),
            },
            ...(body === undefined ? {} : { body }),
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error && error.name === "TimeoutError"
            ? "Postmark request timed out."
            : "Postmark request failed before receiving a response.";
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new PostmarkProviderError({
          message: `${message} Token ${maskToken(input.token)}.`,
          retryable: true,
        });
      }

      const responseText = await response.text();
      const parsed =
        responseText.trim().length === 0
          ? null
          : (JSON.parse(responseText) as unknown);

      if (response.ok) {
        return parsed as T;
      }

      const detail = readDetailText(parsed);
      if (response.status >= 500 && input.retry5xx === true && attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }

      throw new PostmarkProviderError({
        message: sanitizeErrorMessage(response.status, input.token, detail),
        status: response.status,
        retryable: response.status >= 500,
      });
    }
  }

  return {
    async sendBatch(req) {
      assertBatchSize(req.messages);

      // Postmark `/email/batch` expects a bare JSON array of messages;
      // only `/email/batchWithTemplates` takes a `{ Messages: [...] }`
      // wrapper. Sending the wrapped shape here yields a 422 with the
      // surprising `Message: "Invalid JSON"` text.
      const messages = req.messages.map((message) => ({ ...message }));
      const token = req.isTest ? POSTMARK_TEST_TOKEN : opts.serverToken;
      const results = await executeJsonRequest<readonly PostmarkBatchSendResult[]>(
        req.isTest
          ? {
              path: "/email/batch",
              method: "POST",
              token,
              tokenHeader: "X-Postmark-Server-Token",
              body: messages,
              extraHeaders: { "X-AS-Test": "true" },
              retry5xx: true,
            }
          : {
              path: "/email/batch",
              method: "POST",
              token,
              tokenHeader: "X-Postmark-Server-Token",
              body: messages,
              retry5xx: true,
            },
      );

      return {
        results,
      };
    },

    verifyWebhookSignature(rawBody, signature) {
      const secret = opts.webhookSigningSecret.trim();
      if (secret.length === 0) {
        return false;
      }

      const receivedSignatures = normalizeReceivedSignature(signature);
      if (receivedSignatures.length === 0) {
        return false;
      }

      const expected = computeWebhookSignature(secret, rawBody);
      return receivedSignatures.some(
        (received) =>
          signaturesMatch(expected.base64, received) ||
          signaturesMatch(expected.hex, received),
      );
    },

    async getSenderDomainStatus(domain) {
      if (accountToken === null) {
        throw new PostmarkProviderError({
          message:
            "Postmark sender status lookup requires an account token. Token pm_*** unavailable.",
        });
      }

      const trimmedDomain = domain.trim().toLowerCase();
      const domains = await executeJsonRequest<PostmarkDomainListResponse>({
        path: "/domains?count=500&offset=0",
        token: accountToken,
        tokenHeader: "X-Postmark-Account-Token",
      });
      const match =
        domains.Domains.find(
          (record) => record.Name.trim().toLowerCase() === trimmedDomain,
        ) ?? null;

      if (match === null) {
        return {
          status: "unverified",
          domain: trimmedDomain,
          domainId: null,
          returnPathDomain: null,
          dnsRecords: [],
          raw: null,
        };
      }

      const detail = await executeJsonRequest<PostmarkDomainDetailResponse>({
        path: `/domains/${String(match.ID)}`,
        token: accountToken,
        tokenHeader: "X-Postmark-Account-Token",
      });

      return normalizeSenderStatus(trimmedDomain, detail);
    },
  };
}

export {
  parseWebhookEvent,
  postmarkWebhookEventSchema,
  type PostmarkWebhookEvent,
};
