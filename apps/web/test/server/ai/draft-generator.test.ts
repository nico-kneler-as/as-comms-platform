import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../../src/server/stage1-runtime.test-support";
import {
  generateAiDraft,
  type GenerateAiDraftDeps,
} from "../../../src/server/ai";
import { resetForNewDay } from "../../../src/server/ai/cost-counter";
import { seedAiContact, seedAiKnowledge, seedAiThread } from "./test-helpers";

function createDeps(
  runtime: Stage1WebTestRuntime,
  overrides?: Partial<GenerateAiDraftDeps>,
): GenerateAiDraftDeps {
  return {
    repositories: runtime.context.repositories,
    invokeModel: vi.fn().mockResolvedValue({
      text: "Hi Maya,\n\nHere is the updated field kit list.\n\nBest,",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
      },
      stopReason: "end_turn",
      model: "claude-sonnet-4-6",
    }),
    estimateCostUsd: () => 0.01,
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 1200,
    dailyCapUsd: 20,
    ...overrides,
  };
}

describe("generateAiDraft", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    resetForNewDay(new Date("2026-04-24T00:00:00.000Z"));
    await seedAiContact(runtime);
    await seedAiThread(runtime);
    await seedAiKnowledge(runtime, {
      id: "ai:global",
      scope: "global",
      scopeKey: null,
      title: "General Training",
      content: "Use a warm, direct, field-ready voice.",
    });
    await seedAiKnowledge(runtime, {
      id: "ai:project:whitebark",
      scope: "project",
      scopeKey: "project:whitebark",
      title: "Whitebark Pines",
      content: "Share logistics details clearly and avoid inventing timelines.",
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
    vi.restoreAllMocks();
  });

  it("returns a draft-mode happy path", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(createDeps(runtime), {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      threadCursor: "event:thread-1-inbound",
      repromptIndex: 0,
      mode: "draft",
    });

    expect(result).toMatchObject({
      requestMode: "draft",
      mode: "generated",
      providerStatus: "ready",
    });
    expect(result.grounding.map((entry) => entry.tier)).toEqual([1, 2, 4, 4]);
  });

  it("returns a fill-mode happy path", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(createDeps(runtime), {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      threadCursor: "event:thread-1-inbound",
      repromptIndex: 0,
      mode: "fill",
      operatorPrompt: "Tell her the revised field kit will ship tomorrow.",
    });

    expect(result.requestMode).toBe("fill");
    expect(result.draft).toContain("updated field kit list");
  });

  it("returns a reprompt-mode happy path", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(createDeps(runtime), {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      threadCursor: "event:thread-1-inbound",
      repromptIndex: 1,
      mode: "reprompt",
      previousDraft: "Thanks for checking in.",
      repromptDirection: "Make it shorter.",
    });

    expect(result.requestMode).toBe("reprompt");
    expect(result.repromptIndex).toBe(1);
  });

  it("returns a fallback when the provider is not configured", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(
      createDeps(runtime, {
        invokeModel: null,
      }),
      {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:thread-1-inbound",
        repromptIndex: 0,
        mode: "draft",
      },
    );

    expect(result).toMatchObject({
      mode: "deterministic_fallback",
      providerStatus: "provider_not_configured",
      warnings: [{ code: "provider_not_configured" }],
    });
  });

  it("returns a fallback when the provider times out", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(
      createDeps(runtime, {
        invokeModel: vi.fn().mockRejectedValue({
          code: "provider_timeout",
          message: "Anthropic timed out.",
        }),
      }),
      {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:thread-1-inbound",
        repromptIndex: 0,
        mode: "draft",
      },
    );

    expect(result).toMatchObject({
      mode: "deterministic_fallback",
      providerStatus: "provider_timeout",
      warnings: [{ code: "provider_timeout" }],
    });
  });

  it("emits grounding_empty when project context is missing", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(createDeps(runtime), {
      contactId: "contact:maya",
      projectId: "project:missing",
      threadCursor: "event:thread-1-inbound",
      repromptIndex: 0,
      mode: "draft",
    });

    expect(result.mode).toBe("generated");
    expect(result.warnings.some((warning) => warning.code === "grounding_empty")).toBe(
      true,
    );
  });

  it("emits budget_warn without blocking the draft", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(
      createDeps(runtime, {
        dailyCapUsd: 0.001,
      }),
      {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:thread-1-inbound",
        repromptIndex: 0,
        mode: "draft",
      },
    );

    expect(result.mode).toBe("generated");
    expect(result.warnings.some((warning) => warning.code === "budget_warn")).toBe(
      true,
    );
  });

  it("falls back when validation fails", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const result = await generateAiDraft(
      createDeps(runtime, {
        invokeModel: vi.fn().mockResolvedValue({
          text: "{NAME}",
          usage: {
            inputTokens: 1000,
            outputTokens: 200,
          },
          stopReason: "end_turn",
          model: "claude-sonnet-4-6",
        }),
      }),
      {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:thread-1-inbound",
        repromptIndex: 0,
        mode: "draft",
      },
    );

    expect(result).toMatchObject({
      mode: "deterministic_fallback",
      providerStatus: "validation_blocked",
      warnings: [{ code: "validation_blocked" }],
    });
  });
});
