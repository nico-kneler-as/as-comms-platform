import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const getAiProviderConfig = vi.hoisted(() => vi.fn());
const invokeModel = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

vi.mock("@/src/server/ai/provider", () => ({
  getAiProviderConfig,
}));

import { polishTextAction } from "../../src/server/composer/polish";

describe("polishTextAction", () => {
  beforeEach(() => {
    requireSession.mockReset();
    requireSession.mockResolvedValue({ id: "user:nico" });
    invokeModel.mockReset();
    getAiProviderConfig.mockReset();
    getAiProviderConfig.mockReturnValue({
      model: "claude-sonnet-4-6",
      dailyCapUsd: 20,
      maxTokens: 1200,
      temperature: 0.3,
      invokeModel,
      estimateCostUsd: vi.fn(),
    });
  });

  it("returns a validation envelope for empty text", async () => {
    const result = await polishTextAction({
      text: "   ",
      channel: "email",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "validation_error",
      fieldErrors: {
        text: "Text is required.",
      },
    });
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it("returns a validation envelope for an invalid channel", async () => {
    const result = await polishTextAction({
      text: "Hello",
      channel: "note",
    } as never);

    expect(result).toMatchObject({
      ok: false,
      code: "validation_error",
      fieldErrors: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `expect.any` returns `any` by design for asymmetric matchers.
        channel: expect.any(String),
      },
    });
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it("sends the exact email system prompt and raw user text", async () => {
    invokeModel.mockResolvedValue({
      text: "Polished email",
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end_turn",
      model: "claude-sonnet-4-6",
    });

    const result = await polishTextAction({
      text: "Raw body text",
      channel: "email",
    });

    expect(invokeModel).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      system:
        "You are a text-polishing assistant. The operator will give you a draft message. Polish it: fix grammar and typos, tighten phrasing, and improve clarity while preserving the meaning, the facts, and the operator's voice. Do NOT add new information. Do NOT remove substantive content. Do NOT append a signature or sign-off. Return only the polished text — no preamble, no commentary, no quotation marks around the output.",
      messages: [
        {
          role: "user",
          content: "Raw body text",
        },
      ],
      maxTokens: 1200,
      temperature: 0.3,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        polishedText: "Polished email",
      },
    });
  });

  it("sends the exact sms system prompt", async () => {
    invokeModel.mockResolvedValue({
      text: "Polished sms",
      usage: { inputTokens: 8, outputTokens: 4 },
      stopReason: "end_turn",
      model: "claude-sonnet-4-6",
    });

    await polishTextAction({
      text: "raw sms",
      channel: "sms",
    });

    expect(invokeModel).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      system:
        "You are a text-polishing assistant for SMS. The operator will give you a draft SMS. Polish it: fix grammar and typos, tighten phrasing, and improve clarity while preserving the meaning and the facts. Keep it concise — target ~140 characters and never exceed 320 (two segments). Plain text only — no markdown, no signature, no salutation if the draft doesn't have one. Return only the polished text — no preamble, no commentary, no quotation marks around the output.",
      messages: [
        {
          role: "user",
          content: "raw sms",
        },
      ],
      maxTokens: 120,
      temperature: 0.3,
    });
  });

  it("returns the trimmed model output on success", async () => {
    invokeModel.mockResolvedValue({
      text: "  Polished output  ",
      usage: { inputTokens: 8, outputTokens: 4 },
      stopReason: "end_turn",
      model: "claude-sonnet-4-6",
    });

    const result = await polishTextAction({
      text: "draft",
      channel: "email",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        polishedText: "Polished output",
      },
    });
  });

  it("returns an error envelope when the provider throws", async () => {
    invokeModel.mockRejectedValue(new Error("provider down"));

    const result = await polishTextAction({
      text: "draft",
      channel: "email",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ai_polish_failed",
      message: "We could not polish this text right now. Please try again.",
    });
  });
});
