import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnthropicProviderError,
  classifyAnthropicError,
  createAnthropicClient,
  estimateCostUsd,
  generateDraft,
  type AnthropicClient,
} from "../src/index.js";

const baseInput = {
  model: "claude-sonnet-4-6",
  system: "You are helpful.",
  messages: [
    {
      role: "user" as const,
      content: "Hello",
    },
  ],
  maxTokens: 512,
  temperature: 0.3,
};

function createClient(
  implementation: AnthropicClient["messages"]["create"],
): AnthropicClient {
  return {
    messages: {
      create: implementation,
    },
  };
}

describe("Anthropic provider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps timeout errors into provider_timeout", async () => {
    const error = new Error("Timed out");
    error.name = "TimeoutError";

    await expect(
      generateDraft(
        createClient(() => Promise.reject(error)),
        baseInput,
      ),
    ).rejects.toMatchObject({
      code: "provider_timeout",
    } satisfies Partial<AnthropicProviderError>);
  });

  it("maps 429 responses into provider_rate_limited", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("Rate limited"), {
      status: 429,
    });
    const promise = generateDraft(
      createClient(() => Promise.reject(rateLimitError)),
      baseInput,
    );

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({
      code: "provider_rate_limited",
    } satisfies Partial<AnthropicProviderError>);
  });

  it("maps 500 responses into provider_unavailable", async () => {
    vi.useFakeTimers();
    const serverError = Object.assign(new Error("Server error"), {
      status: 500,
    });
    const promise = generateDraft(
      createClient(() => Promise.reject(serverError)),
      baseInput,
    );

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({
      code: "provider_unavailable",
    } satisfies Partial<AnthropicProviderError>);
  });

  it("maps bad credentials into provider_config_error", async () => {
    const authError = Object.assign(new Error("Unauthorized"), {
      status: 401,
    });
    await expect(
      generateDraft(
        createClient(() => Promise.reject(authError)),
        baseInput,
      ),
    ).rejects.toMatchObject({
      code: "provider_config_error",
    } satisfies Partial<AnthropicProviderError>);
  });

  it("retries on 429 and 5xx responses before succeeding", async () => {
    vi.useFakeTimers();
    const create = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        message: "Rate limited",
      })
      .mockRejectedValueOnce({
        status: 500,
        message: "Server error",
      })
      .mockResolvedValue({
        content: [
          {
            type: "text",
            text: "Final draft",
          },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
        },
        stop_reason: "end_turn",
        model: "claude-sonnet-4-6",
      });

    const promise = generateDraft(
      createClient(create as AnthropicClient["messages"]["create"]),
      baseInput,
    );

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      text: "Final draft",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
      },
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("estimates known model cost and returns zero for unknown models", () => {
    expect(
      estimateCostUsd(
        {
          inputTokens: 1000,
          outputTokens: 200,
        },
        "claude-sonnet-4-6",
      ),
    ).toBeCloseTo(0.006, 6);
    expect(
      estimateCostUsd(
        {
          inputTokens: 1000,
          outputTokens: 200,
        },
        "unknown-model",
      ),
    ).toBe(0);
  });

  it("fails fast when the API key is missing", () => {
    expect(() =>
      createAnthropicClient({
        ANTHROPIC_API_KEY: "   ",
      }),
    ).toThrowError(AnthropicProviderError);
  });

  it("reuses direct classification for provider-shaped errors", () => {
    expect(
      classifyAnthropicError(
        {
          status: 429,
          message: "Slow down",
        },
        "Anthropic draft generation",
      ),
    ).toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
  });
});
