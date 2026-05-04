import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { randomUUID } from "node:crypto"

import {
  createMailchimpCaptureService,
  readHeader,
  type CaptureServiceHttpRequest,
  type MailchimpCaptureServiceConfig,
} from "@as-comms/integrations"
import {
  integrationHealthCheckResponseSchema,
  type IntegrationHealthCheckResponse,
} from "@as-comms/contracts"
import { z } from "zod"

export const mailchimpCaptureRuntimeConfigSchema = z.object({
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().positive().default(3003),
  logLevel: z.string().min(1).default("info"),
  service: z.object({
    bearerToken: z.string().min(1),
    apiKey: z.string().min(1),
    salesforceContactIdMergeField: z
      .string()
      .min(1)
      .default("SFCONTACTID"),
    volunteerIdMergeField: z.string().min(1).default("VOLUNTID"),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
})
export type MailchimpCaptureRuntimeConfig = z.infer<
  typeof mailchimpCaptureRuntimeConfigSchema
>

const MAX_REQUEST_BODY_BYTES = 1_000_000

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.")
    this.name = "RequestBodyTooLargeError"
  }
}

function parseRequiredStringEnv(
  envValue: string | undefined,
  envName: string,
): string {
  if (envValue === undefined || envValue.trim().length === 0) {
    throw new Error(`${envName} is required.`)
  }

  return envValue.trim()
}

function parseOptionalPositiveIntEnv(
  envValue: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (envValue === undefined || envValue.trim().length === 0) {
    return defaultValue
  }

  return z.coerce.number().int().positive().parse(envValue, {
    errorMap: () => ({
      message: `${envName} must be a positive integer.`,
    }),
  })
}

function parseOptionalStringEnv(
  envValue: string | undefined,
  defaultValue: string,
): string {
  const normalizedValue = envValue?.trim()
  return normalizedValue && normalizedValue.length > 0
    ? normalizedValue
    : defaultValue
}

export function readMailchimpCaptureRuntimeConfig(
  env: NodeJS.ProcessEnv,
): MailchimpCaptureRuntimeConfig {
  return mailchimpCaptureRuntimeConfigSchema.parse({
    host: env.HOST ?? "0.0.0.0",
    port: parseOptionalPositiveIntEnv(env.PORT, 3003, "PORT"),
    logLevel: parseOptionalStringEnv(env.LOG_LEVEL, "info"),
    service: {
      // Accept either env name. The worker reads the bearer token under
      // `MAILCHIMP_CAPTURE_TOKEN` (matching the GMAIL_/SALESFORCE_ pattern).
      // `MAILCHIMP_CAPTURE_BEARER_TOKEN` is retained for backward compat
      // with the original Brief 1 shape.
      bearerToken: parseRequiredStringEnv(
        env.MAILCHIMP_CAPTURE_TOKEN ?? env.MAILCHIMP_CAPTURE_BEARER_TOKEN,
        "MAILCHIMP_CAPTURE_TOKEN",
      ),
      apiKey: parseRequiredStringEnv(env.MAILCHIMP_API_KEY, "MAILCHIMP_API_KEY"),
      salesforceContactIdMergeField: "SFCONTACTID",
      volunteerIdMergeField: "VOLUNTID",
      timeoutMs: 30_000,
    },
  })
}

function createHttpRequest(
  request: IncomingMessage,
  bodyText: string,
): CaptureServiceHttpRequest {
  return {
    method: request.method ?? "GET",
    path: new URL(request.url ?? "/", "http://mailchimp-capture.local").pathname,
    headers: request.headers,
    bodyText,
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let rejected = false

    request.on("data", (chunk: Buffer | string) => {
      if (rejected) {
        return
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true
        reject(new RequestBodyTooLargeError())
        return
      }

      chunks.push(buffer)
    })
    request.on("end", () => {
      if (rejected) {
        return
      }

      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    request.on("error", reject)
  })
}

function writeResponse(
  response: ServerResponse,
  input: {
    readonly status: number
    readonly headers: Record<string, string>
    readonly body: string
  },
): void {
  response.writeHead(input.status, input.headers)
  response.end(input.body)
}

function readServiceVersion(env: NodeJS.ProcessEnv): string | null {
  const version =
    env.RAILWAY_GIT_COMMIT_SHA ??
    env.SERVICE_VERSION ??
    env.GIT_COMMIT_SHA ??
    null
  const trimmed = version?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function resolveRequestId(
  headers: CaptureServiceHttpRequest["headers"],
): string {
  const correlationId = readHeader(headers, "x-correlation-id")?.trim()
  return correlationId && correlationId.length > 0 ? correlationId : randomUUID()
}

function getErrorDetails(error: unknown): {
  readonly errorName: string
} {
  return {
    errorName: error instanceof Error ? error.constructor.name : typeof error,
  }
}

function getMailchimpCaptureErrorEvent(path: string): string {
  switch (path) {
    case "/historical":
      return "mailchimp_capture.historical.error"
    case "/transition":
      return "mailchimp_capture.transition.error"
    case "/health":
      return "mailchimp_capture.health.error"
    default:
      return "mailchimp_capture.request.error"
  }
}

function logMailchimpCaptureRequestError(input: {
  readonly error: unknown
  readonly method: string
  readonly path: string
  readonly requestId: string
}): {
  readonly requestId: string
} {
  const { errorName } = getErrorDetails(input.error)

  console.error(
    JSON.stringify({
      event: getMailchimpCaptureErrorEvent(input.path),
      requestId: input.requestId,
      errorName,
      requestMethod: input.method,
      requestPath: input.path,
      occurredAt: new Date().toISOString(),
    }),
  )

  return {
    requestId: input.requestId,
  }
}

interface CaptureHttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

async function handleMailchimpCaptureHttpRequestInternal(input: {
  readonly service: ReturnType<typeof createMailchimpCaptureService>
  readonly request: CaptureServiceHttpRequest
}): Promise<CaptureHttpResponse> {
  let path = "/"

  try {
    path = new URL(input.request.path, "http://mailchimp-capture.local").pathname

    if (input.request.method === "GET" && path === "/health") {
      return {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(
          await input.service.checkHealth({
            timeoutMs: 5_000,
            version: readServiceVersion(process.env),
          }),
        ),
      }
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
      }
    }

    return await input.service.handleHttpRequest({
      ...input.request,
      path,
    })
  } catch (error) {
    const requestId = resolveRequestId(input.request.headers)
    const { requestId: loggedRequestId } = logMailchimpCaptureRequestError({
      error,
      method: input.request.method,
      path,
      requestId,
    })

    return {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        ok: false,
        error: "internal_error",
        requestId: loggedRequestId,
      }),
    }
  }
}

export async function handleMailchimpCaptureHttpRequest(
  config: MailchimpCaptureRuntimeConfig,
  request: CaptureServiceHttpRequest,
): Promise<CaptureHttpResponse> {
  const service = createMailchimpCaptureService(
    config.service satisfies MailchimpCaptureServiceConfig,
  )

  return handleMailchimpCaptureHttpRequestInternal({
    service,
    request,
  })
}

export async function handleMailchimpHealthRequest(
  config: MailchimpCaptureRuntimeConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch
    readonly now?: () => Date
    readonly version?: string | null
  },
): Promise<IntegrationHealthCheckResponse> {
  const service = createMailchimpCaptureService(
    config.service satisfies MailchimpCaptureServiceConfig,
    {
      ...(input?.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: input.fetchImplementation }),
      ...(input?.now === undefined ? {} : { now: input.now }),
    },
  )
  const health = await service.checkHealth({
    timeoutMs: 5_000,
    version: input?.version ?? readServiceVersion(process.env),
  })

  return integrationHealthCheckResponseSchema.parse(health)
}

export async function startMailchimpCaptureServer(
  config: MailchimpCaptureRuntimeConfig,
): Promise<Server> {
  const service = createMailchimpCaptureService(
    config.service satisfies MailchimpCaptureServiceConfig,
  )

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const bodyText = await readRequestBody(request)
      const serviceResponse = await handleMailchimpCaptureHttpRequestInternal({
        service,
        request: createHttpRequest(request, bodyText),
      })
      writeResponse(response, serviceResponse)
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
        })
        return
      }

      const requestPath = new URL(
        request.url ?? "/",
        "http://mailchimp-capture.local",
      ).pathname
      const { requestId } = logMailchimpCaptureRequestError({
        error,
        method: request.method ?? "GET",
        path: requestPath,
        requestId: resolveRequestId(request.headers),
      })

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
      })
    }
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, config.host, () => {
      server.off("error", reject)
      resolve(server)
    })
  })
}

async function main(): Promise<void> {
  const config = readMailchimpCaptureRuntimeConfig(process.env)
  await startMailchimpCaptureServer(config)
  console.info(
    `Mailchimp capture service is listening on http://${config.host}:${String(config.port)}`,
  )
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString()

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error("Mailchimp capture service failed to start.")
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
