import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

describe("aiKnowledge.findProjectIdsWithAiKnowledgeConfigured", () => {
  it("returns the configured subset across standalone and connected projects", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone:ready",
        projectName: "Standalone Ready",
        projectAlias: "Standalone Ready",
        source: "salesforce",
        isActive: true,
        aiKnowledgeSyncedAt: "2026-05-01T00:00:00.000Z",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone:empty",
        projectName: "Standalone Empty",
        projectAlias: "Standalone Empty",
        source: "salesforce",
        isActive: true,
        aiKnowledgeSyncedAt: null,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "host:ready",
        projectName: "Host Ready",
        projectAlias: "Host Ready",
        source: "salesforce",
        isActive: true,
        aiKnowledgeSyncedAt: "2026-05-01T00:00:00.000Z",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "host:empty",
        projectName: "Host Empty",
        projectAlias: "Host Empty",
        source: "salesforce",
        isActive: true,
        aiKnowledgeSyncedAt: null,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Saving American Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:ready",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:empty",
      });

      const result =
        await context.repositories.aiKnowledge.findProjectIdsWithAiKnowledgeConfigured(
          [
            "standalone:ready",
            "standalone:empty",
            "sub:beech",
            "sub:butternut",
          ],
        );

      expect(result).toEqual(["standalone:ready", "sub:beech"]);
    } finally {
      await context.dispose();
    }
  });
});
