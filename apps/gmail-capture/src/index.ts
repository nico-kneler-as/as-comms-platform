import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection,
} from "@as-comms/db";
import {
  createCapturedBatchResponseSchema,
  checkGmailCaptureServiceHealth,
  createGmailMailboxApiClient,
  createGmailCaptureService,
  type CaptureServiceHttpRequest,
  type GmailCaptureServiceConfig,
  gmailRecordSchema,
} from "@as-comms/integrations";
import {
  integrationHealthCheckResponseSchema,
  type IntegrationHealthCheckResponse,
} from "@as-comms/contracts";
import { z } from "zod";

import {
  syncGmailMessageAttachments,
  type GmailAttachmentRuntimeConfig,
} from "./attachments.js";

const emailSchema = z.string().email();
const volunteersEmailSchema = emailSchema.refine(
  (value) => value.toLowerCase().startsWith("volunteers@"),
  {
    message: "GMAIL_LIVE_ACCOUNT must be a volunteers@... address.",
  },
);

export const gmailCaptureRuntimeConfigSchema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().positive().default(3001),
  attachments: z.object({
    attachmentVolumePath: z.string().min(1),
    maxAttachmentBytesPerAttachment: z.number().int().positive(),
  }),
  service: z.object({
    bearerToken: z.string().min(1),
    liveAccount: volunteersEmailSchema,
    projectInboxAliases: z.array(emailSchema).min(1),
    oauthClientId: z.string().min(1),
    oauthClientSecret: z.string().min(1),
    oauthRefreshToken: z.string().min(1),
    tokenUri: z.string().url().default("https://oauth2.googleapis.com/token"),
    timeoutMs: z.number().int().positive().default(15_000),
  }),
});
export type GmailCaptureRuntimeConfig = z.infer<
  typeof gmailCaptureRuntimeConfigSchema
>;

const MAX_REQUEST_BODY_BYTES = 1_000_000;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function parseEmailCsvEnv(
  envValue: string | undefined,
  envName: string,
): string[] {
  if (envValue === undefined || envValue.trim().length === 0) {
    throw new Error(`${envName} is required.`);
  }

  const values = envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return z.array(emailSchema).min(1).parse(values);
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

export function readGmailCaptureRuntimeConfig(
  env: NodeJS.ProcessEnv,
): GmailCaptureRuntimeConfig {
  return gmailCaptureRuntimeConfigSchema.parse({
    host: env.HOST ?? "0.0.0.0",
    port: parseOptionalPositiveIntEnv(env.PORT, 3001, "PORT"),
    attachments: {
      attachmentVolumePath: parseRequiredStringEnv(
        env.ATTACHMENT_VOLUME_PATH ??
          (env.NODE_ENV === "production"
            ? "/data/attachments"
            : "./tmp/attachments"),
        "ATTACHMENT_VOLUME_PATH",
      ),
      maxAttachmentBytesPerAttachment: parseOptionalPositiveIntEnv(
        env.MAX_ATTACHMENT_BYTES_PER_ATTACHMENT,
        52_428_800,
        "MAX_ATTACHMENT_BYTES_PER_ATTACHMENT",
      ),
    },
    service: {
      bearerToken: parseRequiredStringEnv(
        env.GMAIL_CAPTURE_TOKEN,
        "GMAIL_CAPTURE_TOKEN",
      ),
      liveAccount: parseRequiredStringEnv(
        env.GMAIL_LIVE_ACCOUNT,
        "GMAIL_LIVE_ACCOUNT",
      ),
      projectInboxAliases: parseEmailCsvEnv(
        env.GMAIL_PROJECT_INBOX_ALIASES,
        "GMAIL_PROJECT_INBOX_ALIASES",
      ),
      oauthClientId: parseRequiredStringEnv(
        env.GMAIL_GOOGLE_OAUTH_CLIENT_ID,
        "GMAIL_GOOGLE_OAUTH_CLIENT_ID",
      ),
      oauthClientSecret: parseRequiredStringEnv(
        env.GMAIL_GOOGLE_OAUTH_CLIENT_SECRET,
        "GMAIL_GOOGLE_OAUTH_CLIENT_SECRET",
      ),
      oauthRefreshToken: parseRequiredStringEnv(
        env.GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN,
        "GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN",
      ),
      tokenUri: env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
      timeoutMs: parseOptionalPositiveIntEnv(
        env.GMAIL_CAPTURE_TIMEOUT_MS,
        15_000,
        "GMAIL_CAPTURE_TIMEOUT_MS",
      ),
    },
  });
}

function createHttpRequest(
  request: IncomingMessage,
  bodyText: string,
): CaptureServiceHttpRequest {
  return {
    method: request.method ?? "GET",
    path: new URL(request.url ?? "/", "http://gmail-capture.local").pathname,
    headers: request.headers,
    bodyText,
  };
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

function writeResponse(
  response: ServerResponse,
  input: {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
): void {
  response.writeHead(input.status, input.headers);
  response.end(input.body);
}

function readServiceVersion(env: NodeJS.ProcessEnv): string | null {
  const version =
    env.RAILWAY_GIT_COMMIT_SHA ??
    env.SERVICE_VERSION ??
    env.GIT_COMMIT_SHA ??
    null;
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function handleGmailHealthRequest(
  config: GmailCaptureRuntimeConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
    readonly version?: string | null;
  },
): Promise<IntegrationHealthCheckResponse> {
  const health = await checkGmailCaptureServiceHealth(config.service, {
    timeoutMs: 5_000,
    version: input?.version ?? readServiceVersion(process.env),
    ...(input?.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: input.fetchImplementation }),
    ...(input?.now === undefined ? {} : { now: input.now }),
  });

  return integrationHealthCheckResponseSchema.parse(health);
}

export async function startGmailCaptureServer(
  config: GmailCaptureRuntimeConfig,
  input?: {
    readonly connection?: DatabaseConnection;
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
  },
): Promise<Server> {
  const apiClient = createGmailMailboxApiClient(
    config.service satisfies GmailCaptureServiceConfig,
    {
      ...(input?.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: input.fetchImplementation }),
      ...(input?.now === undefined ? {} : { now: input.now }),
    },
  );
  const service = createGmailCaptureService(
    config.service satisfies GmailCaptureServiceConfig,
    {
      apiClient,
      ...(input?.now === undefined ? {} : { now: input.now }),
    },
  );
  const connection =
    input?.connection ??
    createDatabaseConnection({
      connectionString: parseRequiredStringEnv(
        process.env.DATABASE_URL,
        "DATABASE_URL",
      ),
    });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const gmailCapturedBatchSchema =
    createCapturedBatchResponseSchema(gmailRecordSchema);

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const path = new URL(request.url ?? "/", "http://gmail-capture.local")
        .pathname;

      if (request.method === "GET" && path === "/health") {
        const health = await handleGmailHealthRequest(config);
        writeResponse(response, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(health),
        });
        return;
      }

      const bodyText = await readRequestBody(request);
      const serviceResponse = await service.handleHttpRequest(
        createHttpRequest(request, bodyText),
      );

      if (
        serviceResponse.status === 200 &&
        request.method === "POST" &&
        (path === "/historical" || path === "/live")
      ) {
        const capturedBatch = gmailCapturedBatchSchema.parse(
          JSON.parse(serviceResponse.body),
        );

        await syncGmailMessageAttachments({
          records: capturedBatch.records,
          repositories,
          serviceConfig: config.service,
          runtimeConfig: config.attachments satisfies GmailAttachmentRuntimeConfig,
          ...(input?.fetchImplementation === undefined
            ? {}
            : { fetchImplementation: input.fetchImplementation }),
          ...(input?.now === undefined ? {} : { now: input.now }),
        });
      }

      writeResponse(response, serviceResponse);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        writeResponse(response, {
          status: 413,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            ok: false,
            error: "payload_too_large",
          }),
        });
        return;
      }

      console.error("Gmail capture request failed.");
      console.error(error instanceof Error ? error.message : String(error));
      writeResponse(response, {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          error: "internal_error",
        }),
      });
    }
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  if (input?.connection === undefined) {
    server.once("close", () => {
      void connection.sql.end({ timeout: 5 });
    });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  const config = readGmailCaptureRuntimeConfig(process.env);
  await startGmailCaptureServer(config);
  console.info(
    `Gmail capture service is listening on http://${config.host}:${String(config.port)}`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error("Gmail capture service failed to start.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
