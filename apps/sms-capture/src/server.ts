import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
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
  readonly repositories: Pick<Stage1RepositoryBundle, "smsMessages">;
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

  writeJson(input.response, 200, { ok: true });
}

export function createSmsCaptureServer(input: {
  readonly config: SmsCaptureRuntimeConfig;
  readonly provider?: TwilioProvider;
  readonly repositories?: Pick<Stage1RepositoryBundle, "smsMessages">;
}): Server {
  const provider =
    input.provider ?? createTwilioProvider(input.config.service);
  const repositories =
    input.repositories ??
    createStage1RepositoryBundleFromConnection(
      createDatabaseConnection({
        connectionString: input.config.databaseUrl,
      }),
    );

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
