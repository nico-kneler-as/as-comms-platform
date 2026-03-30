import { z, type ZodTypeAny } from "zod";

const nullableStringSchema = z.string().min(1).nullable();

export const capturePortHttpConfigSchema = z.object({
  baseUrl: z.string().url(),
  bearerToken: z.string().min(1),
  timeoutMs: z.number().int().positive().default(15_000)
});
export type CapturePortHttpConfig = z.infer<typeof capturePortHttpConfigSchema>;

export type FetchImplementation = typeof fetch;

export class ProviderCaptureError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = new.target.name;
    this.retryable = retryable;
  }
}

export class ProviderCaptureConfigError extends ProviderCaptureError {
  constructor(message: string) {
    super(message, false);
  }
}

export class ProviderCaptureHttpError extends ProviderCaptureError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message, status >= 500 || status === 408 || status === 425 || status === 429);
    this.status = status;
  }
}

export class ProviderCaptureResponseError extends ProviderCaptureError {
  constructor(message: string) {
    super(message, false);
  }
}

export interface CapturedBatchResponse<TRecord> {
  readonly records: readonly TRecord[];
  readonly nextCursor: string | null;
  readonly checkpoint: string | null;
}

export function createCapturedBatchResponseSchema<TRecordSchema extends ZodTypeAny>(
  recordSchema: TRecordSchema
) : z.ZodType<CapturedBatchResponse<z.output<TRecordSchema>>, z.ZodTypeDef, unknown> {
  return z.object({
    records: z.array(recordSchema),
    nextCursor: nullableStringSchema.default(null),
    checkpoint: nullableStringSchema.default(null)
  });
}

function buildRequestUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//u, ""), `${baseUrl.replace(/\/+$/u, "")}/`)
    .toString();
}

export async function requestCaptureBatch<TResponse>(input: {
  readonly config: CapturePortHttpConfig;
  readonly path: string;
  readonly payload: unknown;
  readonly payloadSchema: ZodTypeAny;
  readonly responseSchema: z.ZodType<TResponse, z.ZodTypeDef, unknown>;
  readonly fetchImplementation: FetchImplementation | undefined;
}): Promise<TResponse> {
  const config = capturePortHttpConfigSchema.parse(input.config);
  const payload: unknown = input.payloadSchema.parse(input.payload);
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new ProviderCaptureConfigError(
      "Global fetch is unavailable; provide a fetch implementation for provider capture."
    );
  }

  const response = await fetchImplementation(buildRequestUrl(config.baseUrl, input.path), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.bearerToken}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  if (!response.ok) {
    throw new ProviderCaptureHttpError(
      response.status,
      `Provider capture request failed with status ${String(response.status)} for ${input.path}.`
    );
  }

  let json: unknown;

  try {
    json = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new ProviderCaptureResponseError(
      error instanceof Error
        ? error.message
        : "Provider capture response was not valid JSON."
    );
  }

  try {
    return input.responseSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ProviderCaptureResponseError(error.message);
    }

    throw error;
  }
}
