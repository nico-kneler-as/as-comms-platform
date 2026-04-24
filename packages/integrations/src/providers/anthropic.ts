import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_ANTHROPIC_TIMEOUT_MS = 25_000;
const RETRY_BACKOFF_MS = [500, 2_000] as const;

export interface AnthropicGenerateDraftInput {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface AnthropicGenerateDraftUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface GenerateDraftResult {
  readonly text: string;
  readonly usage: AnthropicGenerateDraftUsage;
  readonly stopReason: string | null;
  readonly model: string;
}

export interface AnthropicClient {
  readonly messages: {
    create(
      input: {
        readonly model: string;
        readonly system: string;
        readonly messages: readonly {
          readonly role: "user" | "assistant";
          readonly content: string;
        }[];
        readonly max_tokens: number;
        readonly temperature: number;
      },
      options?: {
        readonly signal?: AbortSignal;
      },
    ): Promise<{
      readonly content: readonly { readonly type: string; readonly text?: string }[];
      readonly usage?: {
        readonly input_tokens?: number;
        readonly output_tokens?: number;
      };
      readonly stop_reason?: string | null;
      readonly model?: string;
    }>;
  };
}

export class AnthropicProviderError extends Error {
  readonly code:
    | "provider_timeout"
    | "provider_rate_limited"
    | "provider_unavailable"
    | "provider_config_error";
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(input: {
    readonly code: AnthropicProviderError["code"];
    readonly message: string;
    readonly retryable: boolean;
    readonly status?: number | null;
  }) {
    super(input.message);
    this.name = "AnthropicProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function classifyAnthropicError(
  error: unknown,
  context: string,
): AnthropicProviderError {
  if (error instanceof AnthropicProviderError) {
    return error;
  }

  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new AnthropicProviderError({
      code: "provider_timeout",
      message: `${context} timed out.`,
      retryable: true,
    });
  }

  if (!isRecord(error)) {
    return new AnthropicProviderError({
      code: "provider_unavailable",
      message: `${context} failed with an unexpected provider error.`,
      retryable: false,
    });
  }

  const status = readOptionalNumber(error.status);
  const message =
    readOptionalString(error.message) ??
    `${context} failed with an unknown provider error.`;

  if (status === 401 || status === 403) {
    return new AnthropicProviderError({
      code: "provider_config_error",
      message,
      retryable: false,
      status,
    });
  }

  if (status === 429) {
    return new AnthropicProviderError({
      code: "provider_rate_limited",
      message,
      retryable: true,
      status,
    });
  }

  if (status !== null && status >= 500) {
    return new AnthropicProviderError({
      code: "provider_unavailable",
      message,
      retryable: true,
      status,
    });
  }

  return new AnthropicProviderError({
    code: "provider_unavailable",
    message,
    retryable: false,
    status,
  });
}

export function createAnthropicClient(env: {
  readonly ANTHROPIC_API_KEY: string;
}): AnthropicClient {
  const apiKey = env.ANTHROPIC_API_KEY.trim();

  if (apiKey.length === 0) {
    throw new AnthropicProviderError({
      code: "provider_config_error",
      message: "Anthropic API key is missing.",
      retryable: false,
    });
  }

  const anthropicModule = require("@anthropic-ai/sdk") as {
    readonly default?: new (input: { readonly apiKey: string }) => AnthropicClient;
  };
  const AnthropicSdk = anthropicModule.default;

  if (AnthropicSdk === undefined) {
    throw new AnthropicProviderError({
      code: "provider_config_error",
      message: "Anthropic SDK is unavailable.",
      retryable: false,
    });
  }

  return new AnthropicSdk({ apiKey });
}

export async function generateDraft(
  client: AnthropicClient,
  input: AnthropicGenerateDraftInput,
): Promise<GenerateDraftResult> {
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await client.messages.create(
        {
          model: input.model,
          system: input.system,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
        },
        {
          signal: AbortSignal.timeout(DEFAULT_ANTHROPIC_TIMEOUT_MS),
        },
      );

      const text = response.content
        .filter(
          (
            block,
          ): block is {
            readonly type: string;
            readonly text: string;
          } => typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("")
        .trim();

      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        stopReason: response.stop_reason ?? null,
        model: response.model ?? input.model,
      };
    } catch (error) {
      const classifiedError = classifyAnthropicError(
        error,
        "Anthropic draft generation",
      );

      if (
        attempt < RETRY_BACKOFF_MS.length &&
        (classifiedError.code === "provider_rate_limited" ||
          (classifiedError.code === "provider_unavailable" &&
            classifiedError.retryable))
      ) {
        await sleep(RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS.at(-1) ?? 0);
        continue;
      }

      throw classifiedError;
    }
  }

  throw new AnthropicProviderError({
    code: "provider_unavailable",
    message: "Anthropic draft generation exhausted all retries.",
    retryable: false,
  });
}

const MODEL_RATE_CARD_USD_PER_MTOK: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
  },
  "claude-sonnet-4-0": {
    input: 3,
    output: 15,
  },
  "claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
  },
};

export function estimateCostUsd(
  usage: AnthropicGenerateDraftUsage,
  model: string,
): number {
  const rate = MODEL_RATE_CARD_USD_PER_MTOK[model];

  if (rate === undefined) {
    console.error(`Unknown Anthropic model for cost estimation: ${model}`);
    return 0;
  }

  return (
    (usage.inputTokens / 1_000_000) * rate.input +
    (usage.outputTokens / 1_000_000) * rate.output
  );
}
