import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

describe("aiKnowledge.findProjectIdsWithNotionContent", () => {
  it("returns standalone projects with content, skips empty hosts, and hops connected subs to their host", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone:ready",
        projectName: "Standalone Ready",
        projectAlias: "Standalone Ready",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone:empty",
        projectName: "Standalone Empty",
        projectAlias: "Standalone Empty",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "host:ready",
        projectName: "Host Ready",
        projectAlias: "Host Ready",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "host:empty",
        projectName: "Host Empty",
        projectAlias: "Host Empty",
        source: "salesforce",
        isActive: true,
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

      await context.repositories.aiKnowledge.upsert({
        id: "ai:standalone:ready",
        scope: "project",
        scopeKey: "standalone:ready",
        sourceProvider: "notion",
        sourceId: "notion-standalone-ready",
        sourceUrl: "https://www.notion.so/standalone-ready",
        title: "Standalone Ready",
        content: "Standalone content",
        contentHash: "hash:standalone-ready",
        metadataJson: {},
        sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
        syncedAt: "2026-05-01T00:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      });
      await context.repositories.aiKnowledge.upsert({
        id: "ai:host:ready",
        scope: "project",
        scopeKey: "host:ready",
        sourceProvider: "notion",
        sourceId: "notion-host-ready",
        sourceUrl: "https://www.notion.so/host-ready",
        title: "Host Ready",
        content: "Host content",
        contentHash: "hash:host-ready",
        metadataJson: {},
        sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
        syncedAt: "2026-05-01T00:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      });

      const result =
        await context.repositories.aiKnowledge.findProjectIdsWithNotionContent([
          "standalone:ready",
          "standalone:empty",
          "sub:beech",
          "sub:butternut",
        ]);

      expect(result).toEqual(["standalone:ready", "sub:beech"]);
    } finally {
      await context.dispose();
    }
  });
});
