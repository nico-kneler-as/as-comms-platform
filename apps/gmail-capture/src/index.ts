import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  createGmailCaptureService,
  type CaptureServiceHttpRequest,
  type GmailCaptureServiceConfig
} from "@as-comms/integrations";
import { z } from "zod";

const emailSchema = z.string().email();

export const gmailCaptureRuntimeConfigSchema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().positive().default(3001),
  service: z.object({
    bearerToken: z.string().min(1),
    historicalMailboxes: z.array(emailSchema).min(1),
    liveAccount: emailSchema,
    projectInboxAliases: z.array(emailSchema).min(1),
    serviceAccountClientEmail: emailSchema,
    serviceAccountPrivateKey: z.string().min(1),
    tokenUri: z.string().url().default("https://oauth2.googleapis.com/token"),
    timeoutMs: z.number().int().positive().default(15_000)
  })
});
export type GmailCaptureRuntimeConfig = z.infer<
  typeof gmailCaptureRuntimeConfigSchema
>;

function parseEmailCsvEnv(envValue: string | undefined, envName: string): string[] {
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
  envName: string
): string {
  if (envValue === undefined || envValue.trim().length === 0) {
    throw new Error(`${envName} is required.`);
  }

  return envValue.trim();
}

function parseOptionalPositiveIntEnv(
  envValue: string | undefined,
  defaultValue: number,
  envName: string
): number {
  if (envValue === undefined || envValue.trim().length === 0) {
    return defaultValue;
  }

  return z.coerce.number().int().positive().parse(envValue, {
    errorMap: () => ({
      message: `${envName} must be a positive integer.`
    })
  });
}

export function readGmailCaptureRuntimeConfig(
  env: NodeJS.ProcessEnv
): GmailCaptureRuntimeConfig {
  return gmailCaptureRuntimeConfigSchema.parse({
    host: env.HOST ?? "0.0.0.0",
    port: parseOptionalPositiveIntEnv(env.PORT, 3001, "PORT"),
    service: {
      bearerToken: parseRequiredStringEnv(env.GMAIL_CAPTURE_TOKEN, "GMAIL_CAPTURE_TOKEN"),
      historicalMailboxes: parseEmailCsvEnv(
        env.GMAIL_HISTORICAL_MAILBOXES,
        "GMAIL_HISTORICAL_MAILBOXES"
      ),
      liveAccount: parseRequiredStringEnv(
        env.GMAIL_LIVE_ACCOUNT,
        "GMAIL_LIVE_ACCOUNT"
      ),
      projectInboxAliases: parseEmailCsvEnv(
        env.GMAIL_PROJECT_INBOX_ALIASES,
        "GMAIL_PROJECT_INBOX_ALIASES"
      ),
      serviceAccountClientEmail: parseRequiredStringEnv(
        env.GMAIL_GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
        "GMAIL_GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL"
      ),
      serviceAccountPrivateKey: parseRequiredStringEnv(
        env.GMAIL_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        "GMAIL_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
      ),
      tokenUri:
        env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
          ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
          : "https://oauth2.googleapis.com/token",
      timeoutMs: parseOptionalPositiveIntEnv(
        env.GMAIL_CAPTURE_TIMEOUT_MS,
        15_000,
        "GMAIL_CAPTURE_TIMEOUT_MS"
      )
    }
  });
}

function createHttpRequest(
  request: IncomingMessage,
  bodyText: string
): CaptureServiceHttpRequest {
  return {
    method: request.method ?? "GET",
    path: new URL(request.url ?? "/", "http://gmail-capture.local").pathname,
    headers: request.headers,
    bodyText
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
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
  }
): void {
  response.writeHead(input.status, input.headers);
  response.end(input.body);
}

export async function startGmailCaptureServer(
  config: GmailCaptureRuntimeConfig
): Promise<Server> {
  const service = createGmailCaptureService(
    config.service satisfies GmailCaptureServiceConfig
  );

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      const path = new URL(
        request.url ?? "/",
        "http://gmail-capture.local"
      ).pathname;

      if (request.method === "GET" && path === "/health") {
        writeResponse(response, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({
            service: "gmail-capture",
            status: "ok"
          })
        });
        return;
      }

      const bodyText = await readRequestBody(request);
      const serviceResponse = await service.handleHttpRequest(
        createHttpRequest(request, bodyText)
      );
      writeResponse(response, serviceResponse);
    } catch (error) {
      console.error("Gmail capture request failed.");
      console.error(error instanceof Error ? error.message : String(error));
      writeResponse(response, {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          error: "internal_error"
        })
      });
    }
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

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
    `Gmail capture service is listening on http://${config.host}:${String(config.port)}`
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
