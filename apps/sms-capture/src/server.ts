import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID } from "node:crypto";

import {
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  resolveContactByPhoneFromIdentities,
  smsMetrics,
  type Stage1RepositoryBundle,
} from "@as-comms/domain";
import { normalizePhoneE164 } from "@as-comms/domain/phone";
import { createTwilioProvider, type TwilioProvider } from "@as-comms/integrations";
import { z } from "zod";

export const smsCaptureRuntimeConfigSchema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().positive().default(3003),
  databaseUrl: z.string().min(1),
  service: z.object({
    accountSid: z.string().min(1),
    authToken: z.string().min(1),
    messagingServiceSidOrFromNumber: z.string().min(1),
  }),
});
export type SmsCaptureRuntimeConfig = z.infer<
  typeof smsCaptureRuntimeConfigSchema
>;

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const WEBHOOK_PATHS = new Set([
  "/webhooks/inbound",
  "/webhooks/status",
  "/webhooks/opt-out",
]);

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function parseRequiredStringEnv(
  envValue: string | undefined,
  envName: string,
): string {
  if (envValue === undefined || envValue.trim().length === 0) {
    throw new Error(`${envName} is required.`);
  }

  return envValue.trim();
}

function parseOptionalPositiveIntEnv(
  envValue: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (envValue === undefined || envValue.trim().length === 0) {
    return defaultValue;
  }

  return z.coerce
    .number()
    .int()
    .positive()
    .parse(envValue, {
      errorMap: () => ({
        message: `${envName} must be a positive integer.`,
      }),
    });
}

export function readSmsCaptureRuntimeConfig(
  env: NodeJS.ProcessEnv,
): SmsCaptureRuntimeConfig {
  return smsCaptureRuntimeConfigSchema.parse({
    host: env.HOST ?? "0.0.0.0",
    port: parseOptionalPositiveIntEnv(env.PORT, 3003, "PORT"),
    databaseUrl: parseRequiredStringEnv(env.DATABASE_URL, "DATABASE_URL"),
    service: {
      accountSid: parseRequiredStringEnv(
        env.TWILIO_ACCOUNT_SID,
        "TWILIO_ACCOUNT_SID",
      ),
      authToken: parseRequiredStringEnv(
        env.TWILIO_AUTH_TOKEN,
        "TWILIO_AUTH_TOKEN",
      ),
      messagingServiceSidOrFromNumber: parseRequiredStringEnv(
        env.TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER,
        "TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER",
      ),
    },
  });
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;

    request.on("data", (chunk: Buffer | string) => {
      if (rejected) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true;
        reject(new RequestBodyTooLargeError());
        return;
      }

      chunks.push(buffer);
    });
    request.on("end", () => {
      if (rejected) {
        return;
      }

      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function paramsFromBody(bodyText: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(bodyText)) {
    params[key] = value;
  }

  return params;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
}

function readWebhookUrl(request: IncomingMessage): string {
  const host = request.headers.host ?? "sms-capture.local";
  const protoHeader = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader)
    ? protoHeader[0] ?? "http"
    : protoHeader ?? "http";

  return new URL(request.url ?? "/", `${proto}://${host}`).toString();
}

async function handleWebhookRequest(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly provider: TwilioProvider;
  readonly repositories: Stage1RepositoryBundle;
  readonly db: Stage1Database | null;
  readonly path: string;
}): Promise<void> {
  const bodyText = await readRequestBody(input.request);
  const params = paramsFromBody(bodyText);
  const signatureHeader = input.request.headers["x-twilio-signature"];
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0] ?? ""
    : signatureHeader ?? "";
  const validSignature = input.provider.verifyWebhookSignature({
    url: readWebhookUrl(input.request),
    params,
    signature,
  });

  if (!validSignature) {
    writeJson(input.response, 401, { ok: false, error: "invalid_signature" });
    return;
  }

  if (input.path === "/webhooks/inbound") {
    await handleInboundWebhook({
      params,
      provider: input.provider,
      repositories: input.repositories,
      db: input.db,
    });
    writeJson(input.response, 200, { ok: true });
    return;
  }

  if (input.path === "/webhooks/status") {
    const parsed = z
      .object({
        MessageSid: z.string().min(1),
        MessageStatus: z.string().min(1),
        ErrorCode: z.string().optional(),
        ErrorMessage: z.string().optional(),
      })
      .safeParse(params);

    if (!parsed.success) {
      writeJson(input.response, 200, { ok: true });
      return;
    }

    const message = await input.repositories.smsMessages.findByTwilioSid(
      parsed.data.MessageSid,
    );

    if (message === null) {
      console.info(
        `SMS status callback ignored for unknown sid ${parsed.data.MessageSid}`,
      );
      writeJson(input.response, 200, { ok: true });
      return;
    }

    const nextStatus = (() => {
      switch (parsed.data.MessageStatus) {
        case "queued":
        case "accepted":
        case "sending":
        case "sent":
          return message.sendStatus === "delivered" ? "delivered" : "sent";
        case "delivered":
          return "delivered";
        case "failed":
          return "failed";
        case "undelivered":
          return "undelivered";
        default:
          return message.sendStatus;
      }
    })();

    await input.repositories.smsMessages.updateDelivery({
      messageId: message.id,
      status: nextStatus,
      failedReason: parsed.data.ErrorCode ?? null,
      failedDetail: parsed.data.ErrorMessage ?? null,
      sentAt: message.sentAt,
    });
    writeJson(input.response, 200, { ok: true });
    return;
  }

  if (input.path === "/webhooks/opt-out") {
    await handleOptOutWebhook({
      params,
      repositories: input.repositories,
      db: input.db,
    });
    writeJson(input.response, 200, { ok: true });
    return;
  }

  writeJson(input.response, 200, { ok: true });
}

export function createSmsCaptureServer(input: {
  readonly config: SmsCaptureRuntimeConfig;
  readonly provider?: TwilioProvider;
  readonly db?: Stage1Database;
  readonly repositories?: Stage1RepositoryBundle;
}): Server {
  const provider =
    input.provider ?? createTwilioProvider(input.config.service);
  const db =
    input.db ??
    (input.repositories === undefined
      ? createDatabaseConnection({
          connectionString: input.config.databaseUrl,
        }).db
      : null);
  const repositories =
    input.repositories ?? createStage1RepositoryBundle(requireDatabase(db));

  return createServer((request, response) => {
    void (async () => {
      try {
        const path = new URL(request.url ?? "/", "http://sms-capture.local")
          .pathname;

        if (request.method !== "POST" || !WEBHOOK_PATHS.has(path)) {
          writeJson(response, 404, { ok: false, error: "not_found" });
          return;
        }

        await handleWebhookRequest({
          request,
          response,
          provider,
          repositories,
          db,
          path,
        });
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          writeJson(response, 413, { ok: false, error: "payload_too_large" });
          return;
        }

        console.error("SMS capture request failed.");
        console.error(error instanceof Error ? error.message : String(error));
        writeJson(response, 500, { ok: false, error: "internal_error" });
      }
    })();
  });
}

export function startSmsCaptureServer(
  config: SmsCaptureRuntimeConfig,
): Promise<Server> {
  const server = createSmsCaptureServer({ config });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isInboundProjectionLatest(input: {
  readonly existingLastActivityAt: string | null;
  readonly occurredAtIso: string;
}): boolean {
  return (
    input.existingLastActivityAt === null ||
    input.occurredAtIso >= input.existingLastActivityAt
  );
}

async function withRepositories<T>(input: {
  readonly db: Stage1Database | null;
  readonly repositories: Stage1RepositoryBundle;
  readonly transactional: boolean;
  readonly run: (repositories: Stage1RepositoryBundle) => Promise<T>;
}): Promise<T> {
  if (!input.transactional || input.db === null) {
    return input.run(input.repositories);
  }

  return input.db.transaction(async (tx) =>
    input.run(createStage1RepositoryBundle(tx)),
  );
}

function requireDatabase(db: Stage1Database | null): Stage1Database {
  if (db === null) {
    throw new Error("Database handle is required for repository creation.");
  }

  return db;
}

async function handleInboundWebhook(input: {
  readonly params: Record<string, string>;
  readonly provider: TwilioProvider;
  readonly repositories: Stage1RepositoryBundle;
  readonly db: Stage1Database | null;
}): Promise<void> {
  const parsed = input.provider.parseInbound(input.params);
  const fromE164 = normalizePhoneE164(parsed.fromE164);
  const toE164 = normalizePhoneE164(parsed.toE164);

  try {
    await withRepositories({
      db: input.db,
      repositories: input.repositories,
      transactional: true,
      run: async (repositories) => {
        const existingMessage = await repositories.smsMessages.findByTwilioSid(
          parsed.messageSid,
        );

        if (existingMessage !== null) {
          return;
        }

        const sender = await repositories.smsSenders.findByPhone(toE164);

        if (sender === null) {
          console.warn(
            `Inbound SMS ignored for unknown sender number ${toE164}`,
          );
          return;
        }

        const now = new Date();
        const occurredAtIso = now.toISOString();
        const normalization = createStage1NormalizationService(
          createStage1PersistenceService(repositories),
        );
        const resolution = await resolveContactByPhoneFromIdentities({
          phoneE164: fromE164,
          readContactIdentities: {
            listByNormalizedValue: (identity) =>
              repositories.contactIdentities.listByNormalizedValue(identity),
          },
          readContacts: {
            findById: (id) => repositories.contacts.findById(id),
            listByIds: (ids) => repositories.contacts.listByIds(ids),
            findByPrimaryPhone: (phoneE164) =>
              repositories.contacts.findByPrimaryPhone(phoneE164),
          },
          readInboxProjection: {
            findByContactId: (contactId) =>
              repositories.inboxProjection.findByContactId(contactId),
          },
          readConsentRecords: {
            findLatestByPhone: (phoneE164) =>
              repositories.consentRecords.findLatestByPhone(phoneE164),
          },
          writeContacts: {
            upsert: (record) => repositories.contacts.upsert(record),
          },
          writeContactIdentities: {
            upsert: (record) => repositories.contactIdentities.upsert(record),
          },
          clock: {
            now: () => now,
          },
          idGenerator: () => randomUUID(),
        });
        const sourceEvidenceId = randomUUID();
        const canonicalEventId = randomUUID();
        const inboundMessageId = randomUUID();
        const metrics = smsMetrics(parsed.body);
        const payloadRef = `twilio:webhooks/inbound:${parsed.messageSid}`;
        const checksum = sha256Json({
          body: parsed.body,
          fromE164,
          mediaUrls: parsed.mediaUrls,
          messageSid: parsed.messageSid,
          numMediaUrls: parsed.numMediaUrls,
          toE164,
        });

        await repositories.sourceEvidence.append({
          id: sourceEvidenceId,
          provider: "twilio",
          providerRecordType: "message",
          providerRecordId: parsed.messageSid,
          receivedAt: occurredAtIso,
          occurredAt: occurredAtIso,
          payloadRef,
          idempotencyKey: `twilio:message:${parsed.messageSid}`,
          checksum,
        });
        await repositories.canonicalEvents.upsert({
          id: canonicalEventId,
          contactId: resolution.contact.id,
          eventType: "communication.sms.inbound",
          channel: "sms",
          occurredAt: occurredAtIso,
          contentFingerprint: null,
          sourceEvidenceId,
          idempotencyKey: `twilio:message:${parsed.messageSid}:communication.sms.inbound`,
          provenance: {
            primaryProvider: "twilio",
            primarySourceEvidenceId: sourceEvidenceId,
            supportingSourceEvidenceIds: [],
            winnerReason: "single_source",
            sourceRecordType: "message",
            sourceRecordId: parsed.messageSid,
            messageKind: "one_to_one",
            campaignRef: null,
            threadRef: {
              crossProviderCollapseKey: fromE164,
              providerThreadId: fromE164,
            },
            direction: "inbound",
            notes: null,
            inboxProjectionExclusionReason: null,
          },
          reviewState:
            resolution.ambiguousCandidateContactIds.length > 1
              ? "needs_identity_review"
              : "clear",
        });
        await repositories.smsMessages.insert({
          id: inboundMessageId,
          twilioMessageSid: parsed.messageSid,
          direction: "inbound",
          contactId: resolution.contact.id,
          phoneE164: fromE164,
          senderId: sender.id,
          broadcastRunId: null,
          body: parsed.body,
          segments: metrics.segments,
          encoding: metrics.encoding,
          mediaUrls: parsed.mediaUrls.length > 0 ? parsed.mediaUrls : null,
          sendStatus: "received",
          failedReason: null,
          failedDetail: null,
          sentAt: null,
          receivedAt: now,
          actorId: null,
          createdAt: now,
          updatedAt: now,
        });

        const existingInboxProjection =
          await repositories.inboxProjection.findByContactId(resolution.contact.id);
        const isLatest = isInboundProjectionLatest({
          existingLastActivityAt:
            existingInboxProjection?.lastActivityAt ?? null,
          occurredAtIso,
        });
        const nextLastOutboundAt =
          existingInboxProjection?.lastOutboundAt ?? null;

        await repositories.inboxProjection.upsert({
          contactId: resolution.contact.id,
          bucket: "New",
          needsFollowUp: existingInboxProjection?.needsFollowUp ?? false,
          hasUnresolved:
            resolution.ambiguousCandidateContactIds.length > 1
              ? true
              : (existingInboxProjection?.hasUnresolved ?? false),
          lastInboundAt: isLatest
            ? occurredAtIso
            : existingInboxProjection?.lastInboundAt ?? occurredAtIso,
          lastOutboundAt: nextLastOutboundAt,
          lastActivityAt: isLatest
            ? occurredAtIso
            : existingInboxProjection?.lastActivityAt ?? occurredAtIso,
          snippet: isLatest
            ? parsed.body
            : existingInboxProjection?.snippet ?? parsed.body,
          archivedAt: existingInboxProjection?.archivedAt ?? null,
          lastCanonicalEventId: isLatest
            ? canonicalEventId
            : existingInboxProjection?.lastCanonicalEventId ?? canonicalEventId,
          lastEventType: isLatest
            ? "communication.sms.inbound"
            : existingInboxProjection?.lastEventType ??
              "communication.sms.inbound",
        });

        const latestConsent = await repositories.consentRecords.findLatestByPhone(
          fromE164,
        );

        if (latestConsent?.status !== "opted_in") {
          await repositories.consentRecords.insert({
            id: randomUUID(),
            contactId: resolution.contact.id,
            phoneE164: fromE164,
            status: "opted_in",
            source: "inbound_thread",
            sourceDetail: null,
            consentedAt: now,
            revokedAt: null,
            recordedByUserId: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
          });
        }

        if (resolution.ambiguousCandidateContactIds.length > 1) {
          try {
            await normalization.saveIdentityAmbiguityCase({
              sourceEvidenceId,
              candidateContactIds: [
                ...resolution.ambiguousCandidateContactIds,
              ],
              reasonCode: "identity_multi_candidate",
              status: "open",
              openedAt: occurredAtIso,
              resolvedAt: null,
              normalizedIdentityValues: [fromE164],
              anchoredContactId: resolution.contact.id,
              explanation: `Inbound SMS from ${fromE164} matched ${resolution.ambiguousCandidateContactIds.length.toString()} contacts; anchored to ${resolution.contact.id} pending operator review.`,
            });
          } catch (error) {
            console.error(
              `Failed to persist inbound SMS identity ambiguity case for ${parsed.messageSid}.`,
            );
            throw error;
          }
        }
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const duplicate = await input.repositories.smsMessages.findByTwilioSid(
      parsed.messageSid,
    );

    if (duplicate === null) {
      throw error;
    }
  }
}

async function handleOptOutWebhook(input: {
  readonly params: Record<string, string>;
  readonly repositories: Stage1RepositoryBundle;
  readonly db: Stage1Database | null;
}): Promise<void> {
  const parsed = z
    .object({
      From: z.string().min(1),
      OptOutType: z.string().min(1),
    })
    .safeParse(input.params);

  if (!parsed.success) {
    return;
  }

  const optOutType = parsed.data.OptOutType.toUpperCase();
  const fromE164 = normalizePhoneE164(parsed.data.From);

  await withRepositories({
    db: input.db,
    repositories: input.repositories,
    transactional: true,
    run: async (repositories) => {
      if (optOutType === "HELP") {
        console.info(`SMS HELP webhook acknowledged for ${parsed.data.From}`);
        return;
      }

      if (optOutType !== "STOP" && optOutType !== "START" && optOutType !== "UNSTOP") {
        console.info(
          `SMS opt-out webhook ignored unsupported OptOutType ${optOutType}`,
        );
        return;
      }

      const now = new Date();
      const resolution = await resolveContactByPhoneFromIdentities({
        phoneE164: fromE164,
        readContactIdentities: {
          listByNormalizedValue: (identity) =>
            repositories.contactIdentities.listByNormalizedValue(identity),
        },
        readContacts: {
          findById: (id) => repositories.contacts.findById(id),
          listByIds: (ids) => repositories.contacts.listByIds(ids),
          findByPrimaryPhone: (phoneE164) =>
            repositories.contacts.findByPrimaryPhone(phoneE164),
        },
        readInboxProjection: {
          findByContactId: (contactId) =>
            repositories.inboxProjection.findByContactId(contactId),
        },
        readConsentRecords: {
          findLatestByPhone: (phoneE164) =>
            repositories.consentRecords.findLatestByPhone(phoneE164),
        },
        writeContacts: {
          upsert: (record) => repositories.contacts.upsert(record),
        },
        writeContactIdentities: {
          upsert: (record) => repositories.contactIdentities.upsert(record),
        },
        clock: {
          now: () => now,
        },
        idGenerator: () => randomUUID(),
      });

      await repositories.consentRecords.insert({
        id: randomUUID(),
        contactId: resolution.contact.id,
        phoneE164: fromE164,
        status:
          optOutType === "STOP"
            ? "revoked"
            : "opted_in",
        source: "sms_reply_yes",
        sourceDetail: optOutType,
        consentedAt:
          optOutType === "STOP"
            ? null
            : now,
        revokedAt:
          optOutType === "STOP"
            ? now
            : null,
        recordedByUserId: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      });
    },
  });
}
