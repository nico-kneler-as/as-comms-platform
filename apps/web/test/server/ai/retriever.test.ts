import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../../src/server/stage1-runtime.test-support";
import { retrieveGrounding } from "../../../src/server/ai/retriever";
import { seedAiContact, seedAiKnowledge, seedAiThread } from "./test-helpers";

describe("retrieveGrounding", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    await seedAiContact(runtime);
    await seedAiThread(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("retrieves the tier-1 global entry", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedAiKnowledge(runtime, {
      id: "ai:global",
      scope: "global",
      scopeKey: null,
      title: "General Training",
      content: "Use a warm, direct, field-ready voice.",
    });

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      threadCursor: null,
    });

    expect(bundle.generalTraining?.title).toBe("General Training");
    expect(bundle.grounding.some((entry) => entry.tier === 1)).toBe(true);
  });

  it("retrieves the tier-2 project entry by scope key", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedAiKnowledge(runtime, {
      id: "ai:project:whitebark",
      scope: "project",
      scopeKey: "project:whitebark",
      title: "Whitebark Pines",
      content: "The Whitebark team replies with concise logistics details.",
    });

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      threadCursor: null,
    });

    expect(bundle.projectContext?.title).toBe("Whitebark Pines");
    expect(bundle.grounding.some((entry) => entry.tier === 2)).toBe(true);
  });

  it("returns a null-safe bundle when the project entry is missing", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:missing",
      threadCursor: null,
    });

    expect(bundle.projectContext).toBeNull();
    expect(bundle.targetInbound?.body).toContain("current field kit list");
  });

  it("handles an empty database without throwing", async () => {
    const emptyRuntime = await createStage1WebTestRuntime();

    try {
      const bundle = await retrieveGrounding(emptyRuntime.context.repositories, {
        contactId: "contact:missing",
        projectId: "project:missing",
        threadCursor: null,
      });

      expect(bundle).toMatchObject({
        contact: null,
        generalTraining: null,
        projectContext: null,
        targetInbound: null,
        recentEvents: [],
        grounding: [],
      });
    } finally {
      await emptyRuntime.dispose();
    }
  });
});
