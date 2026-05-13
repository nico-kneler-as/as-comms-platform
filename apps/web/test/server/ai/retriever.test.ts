import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../../src/server/stage1-runtime.test-support";
import { retrieveGrounding } from "../../../src/server/ai/retriever";
import {
  seedAiContact,
  seedAiKnowledge,
  seedAiThread,
  seedProjectKnowledge,
} from "./test-helpers";

describe("retrieveGrounding", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  let seededInboundId: string | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    await seedAiContact(runtime);
    const { latestInboundId } = await seedAiThread(runtime);
    seededInboundId = latestInboundId;
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
      intent: "reply",
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
      intent: "reply",
      threadCursor: null,
    });

    expect(bundle.projectContext?.title).toBe("Whitebark Pines");
    expect(bundle.grounding.some((entry) => entry.tier === 2)).toBe(true);
  });

  it("retrieves approved tier-3 project knowledge when replying to a specific inbound", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedProjectKnowledge(runtime, {
      questionSummary: "Current field kit list",
      issueType: "Trip planning",
    });
    await seedProjectKnowledge(runtime, {
      id: "knowledge:whitebark:hidden",
      questionSummary: "Hidden field kit answer",
      approvedForAi: false,
    });

    // Tier-3 retrieval is keyword-matched against the target inbound, only
    // applies when the operator is actually replying (threadCursor set).
    // Net-new compose (threadCursor=null) intentionally skips tier-3.
    if (seededInboundId === null) {
      throw new Error("Expected seededInboundId.");
    }

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      intent: "reply",
      threadCursor: seededInboundId,
    });

    expect(bundle.tier3Entries.map((entry) => entry.id)).toEqual([
      "knowledge:whitebark:field-kit",
    ]);
    expect(bundle.grounding.some((entry) => entry.tier === 3)).toBe(true);
  });

  it("returns a null-safe bundle when the project entry is missing", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:missing",
      intent: "reply",
      threadCursor: null,
    });

    expect(bundle.projectContext).toBeNull();
    expect(bundle.targetInbound).not.toBeNull();
  });

  it("leaves targetInbound null on new intent even when threadCursor is set", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    if (seededInboundId === null) {
      throw new Error("Expected seededInboundId.");
    }

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      intent: "new",
      threadCursor: seededInboundId,
    });

    expect(bundle.targetInbound).toBeNull();
    expect(bundle.recentEvents.length).toBeGreaterThan(0);
  });

  it("falls back to the most recent inbound on reply intent when threadCursor is null", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      intent: "reply",
      threadCursor: null,
    });

    expect(bundle.targetInbound?.canonicalEventId).toBe(seededInboundId);
  });

  it("leaves targetInbound null on reply intent when no inbound exists", async () => {
    const emptyRuntime = await createStage1WebTestRuntime();

    try {
      await seedAiContact(emptyRuntime);

      const bundle = await retrieveGrounding(emptyRuntime.context.repositories, {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        intent: "reply",
        threadCursor: null,
      });

      expect(bundle.targetInbound).toBeNull();
    } finally {
      await emptyRuntime.dispose();
    }
  });

  it("falls back to the host's tier-2 entry when the project is a connected sub", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    // Mark whitebark as a connected sub of host:forests. The Settings UI
    // (PR #388) clears the sub's own ai_knowledge_url, so the AI Draft
    // pipeline should resolve grounding via the host.
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "host:forests",
      projectName: "Forests",
      projectAlias: "Forests",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark",
      projectName: "Whitebark Pines",
      projectAlias: "Whitebark",
      source: "salesforce",
      isActive: true,
      connectedToProjectId: "host:forests",
    });
    await seedAiKnowledge(runtime, {
      id: "ai:project:host:forests",
      scope: "project",
      scopeKey: "host:forests",
      title: "Forests AI Knowledge",
      content: "Curated host-level grounding for the connected sub.",
    });

    const bundle = await retrieveGrounding(runtime.context.repositories, {
      contactId: "contact:maya",
      projectId: "project:whitebark",
      intent: "reply",
      threadCursor: null,
    });

    // Even though we asked for project:whitebark, the bundle resolves
    // through the host's curated entry — the sub itself has none.
    expect(bundle.projectContext?.title).toBe("Forests AI Knowledge");
    expect(bundle.grounding.some((entry) => entry.tier === 2)).toBe(true);
  });

  it("handles an empty database without throwing", async () => {
    const emptyRuntime = await createStage1WebTestRuntime();

    try {
      const bundle = await retrieveGrounding(emptyRuntime.context.repositories, {
        contactId: "contact:missing",
        projectId: "project:missing",
        intent: "reply",
        threadCursor: null,
      });

      expect(bundle).toMatchObject({
        contact: null,
        generalTraining: null,
        projectContext: null,
        tier3Entries: [],
        intent: "reply",
        targetInbound: null,
        recentEvents: [],
        grounding: [],
      });
    } finally {
      await emptyRuntime.dispose();
    }
  });
});
