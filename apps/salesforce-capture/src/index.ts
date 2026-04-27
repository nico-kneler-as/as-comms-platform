import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

import {
  checkSalesforceCaptureServiceHealth,
  createSalesforceCaptureService,
  type CaptureServiceHttpRequest,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";
import {
  integrationHealthCheckResponseSchema,
  type IntegrationHealthCheckResponse,
} from "@as-comms/contracts";
import { z } from "zod";

export const salesforceCaptureRuntimeConfigSchema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().positive().default(3002),
  service: z.object({
    bearerToken: z.string().min(1),
    loginUrl: z.string().url(),
    clientId: z.string().min(1),
    username: z.string().min(1),
    jwtPrivateKey: z.string().min(1),
    jwtExpirationSeconds: z.number().int().positive().default(180),
    apiVersion: z.string().min(1).default("61.0"),
    contactCaptureMode: z.enum(["delta_polling", "cdc_compatible"]),
    membershipCaptureMode: z.enum(["delta_polling", "cdc_compatible"]),
    membershipObjectName: z.string().min(1).default("Expedition_Members__c"),
    membershipContactField: z.string().min(1).default("Contact__c"),
    membershipProjectField: z.string().min(1).default("Project__c"),
    membershipExpeditionField: z.string().min(1).default("Expedition__c"),
    membershipRoleField: z.string().min(1).nullable().default(null),
    membershipStatusField: z.string().min(1).default("Status__c"),
    taskContactField: z.string().min(1).default("WhoId"),
    taskChannelField: z.string().min(1).default("TaskSubtype"),
    taskEmailChannelValues: z
      .array(z.string().min(1))
      .min(1)
      .default(["Email"]),
    taskSmsChannelValues: z
      .array(z.string().min(1))
      .min(1)
      .default(["SMS", "Text"]),
    taskSnippetField: z.string().min(1).default("Description"),
    taskOccurredAtField: z.string().min(1).default("CreatedDate"),
    taskCrossProviderKeyField: z.string().min(1).nullable().default(null),
    timeoutMs: z.number().int().positive().default(15_000),
  }),
});
export type SalesforceCaptureRuntimeConfig = z.infer<
  typeof salesforceCaptureRuntimeConfigSchema
>;

const MAX_REQUEST_BODY_BYTES = 1_000_000;

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

function parseCsvEnv(
  envValue: string | undefined,
  defaultValues: readonly string[],
): string[] {
  if (envValue === undefined || envValue.trim().length === 0) {
    return [...defaultValues];
  }

  return envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseOptionalStringEnv(
  envValue: string | undefined,
  defaultValue: string,
): string {
  const normalizedValue = envValue?.trim();
  return normalizedValue && normalizedValue.length > 0
    ? normalizedValue
    : defaultValue;
}

function parseOptionalNullableStringEnv(
  envValue: string | undefined,
): string | null {
  const normalizedValue = envValue?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

export function readSalesforceCaptureRuntimeConfig(
  env: NodeJS.ProcessEnv,
): SalesforceCaptureRuntimeConfig {
  return salesforceCaptureRuntimeConfigSchema.parse({
    host: env.HOST ?? "0.0.0.0",
    port: parseOptionalPositiveIntEnv(env.PORT, 3002, "PORT"),
    service: {
      bearerToken: parseRequiredStringEnv(
        env.SALESFORCE_CAPTURE_TOKEN,
        "SALESFORCE_CAPTURE_TOKEN",
      ),
      loginUrl: parseRequiredStringEnv(
        env.SALESFORCE_LOGIN_URL,
        "SALESFORCE_LOGIN_URL",
      ),
      clientId: parseRequiredStringEnv(
        env.SALESFORCE_CLIENT_ID,
        "SALESFORCE_CLIENT_ID",
      ),
      username: parseRequiredStringEnv(
        env.SALESFORCE_USERNAME,
        "SALESFORCE_USERNAME",
      ),
      jwtPrivateKey: parseRequiredStringEnv(
        env.SALESFORCE_JWT_PRIVATE_KEY,
        "SALESFORCE_JWT_PRIVATE_KEY",
      ),
      jwtExpirationSeconds: parseOptionalPositiveIntEnv(
        env.SALESFORCE_JWT_EXPIRATION_SECONDS,
        180,
        "SALESFORCE_JWT_EXPIRATION_SECONDS",
      ),
      apiVersion: parseOptionalStringEnv(env.SALESFORCE_API_VERSION, "61.0"),
      contactCaptureMode: parseRequiredStringEnv(
        env.SALESFORCE_CONTACT_CAPTURE_MODE,
        "SALESFORCE_CONTACT_CAPTURE_MODE",
      ),
      membershipCaptureMode: parseRequiredStringEnv(
        env.SALESFORCE_MEMBERSHIP_CAPTURE_MODE,
        "SALESFORCE_MEMBERSHIP_CAPTURE_MODE",
      ),
      membershipObjectName: parseOptionalStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_OBJECT,
        "Expedition_Members__c",
      ),
      membershipContactField: parseOptionalStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_CONTACT_FIELD,
        "Contact__c",
      ),
      membershipProjectField: parseOptionalStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_PROJECT_FIELD,
        "Project__c",
      ),
      membershipExpeditionField: parseOptionalStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_FIELD,
        "Expedition__c",
      ),
      membershipRoleField: parseOptionalNullableStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_ROLE_FIELD,
      ),
      membershipStatusField: parseOptionalStringEnv(
        env.SALESFORCE_EXPEDITION_MEMBER_STATUS_FIELD,
        "Status__c",
      ),
      taskContactField: parseOptionalStringEnv(
        env.SALESFORCE_TASK_CONTACT_FIELD,
        "WhoId",
      ),
      taskChannelField: parseOptionalStringEnv(
        env.SALESFORCE_TASK_CHANNEL_FIELD,
        "TaskSubtype",
      ),
      taskEmailChannelValues: parseCsvEnv(
        env.SALESFORCE_TASK_EMAIL_CHANNEL_VALUES,
        ["Email"],
      ),
      taskSmsChannelValues: parseCsvEnv(
        env.SALESFORCE_TASK_SMS_CHANNEL_VALUES,
        ["SMS", "Text"],
      ),
      taskSnippetField: parseOptionalStringEnv(
        env.SALESFORCE_TASK_SNIPPET_FIELD,
        "Description",
      ),
      taskOccurredAtField: parseOptionalStringEnv(
        env.SALESFORCE_TASK_OCCURRED_AT_FIELD,
        "CreatedDate",
      ),
      taskCrossProviderKeyField: parseOptionalNullableStringEnv(
        env.SALESFORCE_TASK_CROSS_PROVIDER_KEY_FIELD,
      ),
      timeoutMs: parseOptionalPositiveIntEnv(
        env.SALESFORCE_CAPTURE_TIMEOUT_MS,
        15_000,
        "SALESFORCE_CAPTURE_TIMEOUT_MS",
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
    path: new URL(request.url ?? "/", "http://salesforce-capture.local")
      .pathname,
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

function getErrorDetails(error: unknown): {
  readonly errorName: string;
} {
  return {
    errorName: error instanceof Error ? error.constructor.name : typeof error,
  };
}

function getSalesforceCaptureErrorEvent(path: string): string {
  switch (path) {
    case "/live":
      return "salesforce_capture.live.error";
    case "/historical":
      return "salesforce_capture.historical.error";
    case "/health":
      return "salesforce_capture.health.error";
    default:
      return "salesforce_capture.request.error";
  }
}

function logSalesforceCaptureRequestError(input: {
  readonly error: unknown;
  readonly method: string;
  readonly path: string;
}): {
  readonly requestId: string;
} {
  const { errorName } = getErrorDetails(input.error);
  const requestId = randomUUID();

  console.error(
    JSON.stringify({
      event: getSalesforceCaptureErrorEvent(input.path),
      requestId,
      errorName,
      requestMethod: input.method,
      requestPath: input.path,
      occurredAt: new Date().toISOString(),
    }),
  );

  return {
    requestId,
  };
}

interface CaptureHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function handleSalesforceCaptureHttpRequestInternal(input: {
  readonly config: SalesforceCaptureRuntimeConfig;
  readonly service: ReturnType<typeof createSalesforceCaptureService>;
  readonly request: CaptureServiceHttpRequest;
}): Promise<CaptureHttpResponse> {
  let path = "/";

  try {
    path = new URL(input.request.path, "http://salesforce-capture.local")
      .pathname;

    if (input.request.method === "GET" && path === "/health") {
      return {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(
          await handleSalesforceHealthRequest(input.config),
        ),
      };
    }

    if (
      Buffer.byteLength(input.request.bodyText, "utf8") >
      MAX_REQUEST_BODY_BYTES
    ) {
      return {
        status: 413,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          ok: false,
          error: "payload_too_large",
        }),
      };
    }

    return await input.service.handleHttpRequest({
      ...input.request,
      path,
    });
  } catch (error) {
    const { requestId } = logSalesforceCaptureRequestError({
      error,
      method: input.request.method,
      path,
    });

    return {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        ok: false,
        error: "internal_error",
        requestId,
      }),
    };
  }
}

export async function handleSalesforceCaptureHttpRequest(
  config: SalesforceCaptureRuntimeConfig,
  request: CaptureServiceHttpRequest,
): Promise<CaptureHttpResponse> {
  const service = createSalesforceCaptureService(
    config.service satisfies SalesforceCaptureServiceConfig,
  );

  return handleSalesforceCaptureHttpRequestInternal({
    config,
    service,
    request,
  });
}

export async function handleSalesforceHealthRequest(
  config: SalesforceCaptureRuntimeConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
    readonly version?: string | null;
  },
): Promise<IntegrationHealthCheckResponse> {
  const health = await checkSalesforceCaptureServiceHealth(config.service, {
    timeoutMs: 5_000,
    version: input?.version ?? readServiceVersion(process.env),
    ...(input?.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: input.fetchImplementation }),
    ...(input?.now === undefined ? {} : { now: input.now }),
  });

  return integrationHealthCheckResponseSchema.parse(health);
}

export async function startSalesforceCaptureServer(
  config: SalesforceCaptureRuntimeConfig,
): Promise<Server> {
  const service = createSalesforceCaptureService(
    config.service satisfies SalesforceCaptureServiceConfig,
  );

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const bodyText = await readRequestBody(request);
      const serviceResponse = await handleSalesforceCaptureHttpRequestInternal({
        config,
        service,
        request: createHttpRequest(request, bodyText),
      });
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

      const { requestId } = logSalesforceCaptureRequestError({
        error,
        method: request.method ?? "GET",
        path: new URL(
          request.url ?? "/",
          "http://salesforce-capture.local",
        ).pathname,
      });

      writeResponse(response, {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          ok: false,
          error: "internal_error",
          requestId,
        }),
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
  const config = readSalesforceCaptureRuntimeConfig(process.env);
  await startSalesforceCaptureServer(config);
  console.info(
    `Salesforce capture service is listening on http://${config.host}:${String(config.port)}`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error("Salesforce capture service failed to start.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
