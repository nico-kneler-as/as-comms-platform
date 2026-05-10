import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

// Repository-level coverage for the consolidated AI-knowledge accessors that
// transparently inherit from a host project when the requested project_id is
// a connected sub. Used by the AI Draft pipeline so a thread tagged with
// project=Beech still pulls Beech&Butternut's curated grounding.
//
// Settings code paths must NOT call these accessors — they edit the raw
// stored value via setAiKnowledgeUrl / setAiKnowledgeSources etc.
describe("effective AI knowledge accessors", () => {
  describe("aiKnowledge.findEffectiveProjectNotionContent", () => {
    it("returns the host's own cached Notion content when called against the host", async () => {
      const context = await createTestStage1Context();
      try {
        await context.repositories.projectDimensions.upsert({
          projectId: "host:forests",
          projectName: "Forests",
          projectAlias: "Forests",
          source: "salesforce",
          isActive: true,
        });
        await context.repositories.aiKnowledge.upsert({
          id: "ai:project:host:forests",
          scope: "project",
          scopeKey: "host:forests",
          sourceProvider: "notion",
          sourceId: "notion-host-forests",
          sourceUrl: "https://www.notion.so/forests",
          title: "Forests AI Knowledge",
          content: "Curated grounding for the Forests host project.",
          contentHash: "hash:host-forests",
          metadataJson: {},
          sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
          syncedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        });

        const entry =
          await context.repositories.aiKnowledge.findEffectiveProjectNotionContent(
            "host:forests",
          );

        expect(entry?.title).toBe("Forests AI Knowledge");
        expect(entry?.scopeKey).toBe("host:forests");
      } finally {
        await context.dispose();
      }
    });

    it("falls back to the host's content when called against a connected sub with no own content", async () => {
      const context = await createTestStage1Context();
      try {
        await context.repositories.projectDimensions.upsert({
          projectId: "host:forests",
          projectName: "Forests",
          projectAlias: "Forests",
          source: "salesforce",
          isActive: true,
        });
        await context.repositories.projectDimensions.upsert({
          projectId: "sub:beech",
          projectName: "Saving American Beech",
          projectAlias: null,
          source: "salesforce",
          isActive: true,
          connectedToProjectId: "host:forests",
        });
        await context.repositories.aiKnowledge.upsert({
          id: "ai:project:host:forests",
          scope: "project",
          scopeKey: "host:forests",
          sourceProvider: "notion",
          sourceId: "notion-host-forests",
          sourceUrl: "https://www.notion.so/forests",
          title: "Forests AI Knowledge",
          content: "Curated grounding for the Forests host project.",
          contentHash: "hash:host-forests",
          metadataJson: {},
          sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
          syncedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        });

        const entry =
          await context.repositories.aiKnowledge.findEffectiveProjectNotionContent(
            "sub:beech",
          );

        expect(entry?.title).toBe("Forests AI Knowledge");
        // The cached row's scopeKey is the host's id — confirms the lookup
        // walked the connection rather than returning null because the sub's
        // own scope_key has no row.
        expect(entry?.scopeKey).toBe("host:forests");
      } finally {
        await context.dispose();
      }
    });

    it("returns null when the sub is no longer connected (host deactivated and cascade ran)", async () => {
      const context = await createTestStage1Context();
      try {
        // Sub was previously connected; the host was deactivated and PR #388's
        // cascade set connected_to_project_id to null on the sub. The sub now
        // stands alone (still active) and has no content of its own — the
        // accessor returns null instead of resolving the prior host.
        await context.repositories.projectDimensions.upsert({
          projectId: "host:forests",
          projectName: "Forests",
          projectAlias: "Forests",
          source: "salesforce",
          isActive: false,
        });
        await context.repositories.projectDimensions.upsert({
          projectId: "sub:beech",
          projectName: "Saving American Beech",
          projectAlias: "Beech",
          source: "salesforce",
          isActive: true,
        });
        // Host's own content still cached but the sub is no longer connected.
        await context.repositories.aiKnowledge.upsert({
          id: "ai:project:host:forests",
          scope: "project",
          scopeKey: "host:forests",
          sourceProvider: "notion",
          sourceId: "notion-host-forests",
          sourceUrl: "https://www.notion.so/forests",
          title: "Forests AI Knowledge",
          content: "Curated grounding for the Forests host project.",
          contentHash: "hash:host-forests",
          metadataJson: {},
          sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
          syncedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        });

        const entry =
          await context.repositories.aiKnowledge.findEffectiveProjectNotionContent(
            "sub:beech",
          );

        expect(entry).toBeNull();
      } finally {
        await context.dispose();
      }
    });

    it("returns the project's own content when not connected (standalone)", async () => {
      const context = await createTestStage1Context();
      try {
        await context.repositories.projectDimensions.upsert({
          projectId: "standalone:whitebark",
          projectName: "Whitebark Pines",
          projectAlias: "Whitebark",
          source: "salesforce",
          isActive: true,
        });
        await context.repositories.aiKnowledge.upsert({
          id: "ai:project:whitebark",
          scope: "project",
          scopeKey: "standalone:whitebark",
          sourceProvider: "notion",
          sourceId: "notion-whitebark",
          sourceUrl: "https://www.notion.so/whitebark",
          title: "Whitebark Pines",
          content: "Whitebark grounding.",
          contentHash: "hash:whitebark",
          metadataJson: {},
          sourceLastEditedAt: "2026-05-01T00:00:00.000Z",
          syncedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        });

        const entry =
          await context.repositories.aiKnowledge.findEffectiveProjectNotionContent(
            "standalone:whitebark",
          );

        expect(entry?.scopeKey).toBe("standalone:whitebark");
      } finally {
        await context.dispose();
      }
    });
  });

  describe("projectDimensions.findEffectiveAiKnowledge", () => {
    const baseHostFixture = {
      projectId: "host:forests",
      projectName: "Forests",
      projectAlias: "Forests",
      source: "salesforce" as const,
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/host-forests",
      aiOperatingContext: "Forests host operating context.",
      aiAutoSyncSchedule: "weekly" as const,
      aiOptimizedSynthesizedAt: "2026-05-01T00:00:00.000Z",
      aiOptimizedInputHash: "hash:host-input",
    };

    const sampleSource = {
      id: "00000000-0000-0000-0000-000000000001",
      url: "https://www.notion.so/forests-source",
      kind: "notion" as const,
      label: "Forests source",
      enabled: true,
      last_synced_at: "2026-05-01T00:00:00.000Z",
      last_sync_status: "healthy" as const,
      last_sync_error: null,
      source_id: "src-forests",
      source_content_hash: "src-hash",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
    };

    it("returns the host's own bundle when called against a host project", async () => {
      const context = await createTestStage1Context();
      try {
        await context.repositories.projectDimensions.upsert({
          ...baseHostFixture,
          aiKnowledgeSources: [sampleSource],
        });

        const effective =
          await context.repositories.projectDimensions.findEffectiveAiKnowledge(
            "host:forests",
          );

        expect(effective).not.toBeNull();
        expect(effective?.projectId).toBe("host:forests");
        expect(effective?.resolvedFromProjectId).toBe("host:forests");
        expect(effective?.aiKnowledgeUrl).toBe(
          "https://www.notion.so/host-forests",
        );
        expect(effective?.aiOperatingContext).toBe(
          "Forests host operating context.",
        );
        expect(effective?.aiAutoSyncSchedule).toBe("weekly");
        expect(effective?.aiOptimizedSynthesizedAt).toBe(
          "2026-05-01T00:00:00.000Z",
        );
        expect(effective?.aiOptimizedInputHash).toBe("hash:host-input");
        expect(effective?.aiKnowledgeSources).toHaveLength(1);
        expect(effective?.aiKnowledgeSources[0]?.id).toBe(sampleSource.id);
      } finally {
        await context.dispose();
      }
    });

    it("falls back to the host bundle when called against a connected sub with null fields", async () => {
      const context = await createTestStage1Context();
      try {
        await context.repositories.projectDimensions.upsert({
          ...baseHostFixture,
          aiKnowledgeSources: [sampleSource],
        });
        await context.repositories.projectDimensions.upsert({
          projectId: "sub:beech",
          projectName: "Saving American Beech",
          projectAlias: null,
          source: "salesforce",
          isActive: true,
          connectedToProjectId: "host:forests",
          // Connected subs land here with all AI fields null/empty per
          // PR #388's connect cascade.
        });

        const effective =
          await context.repositories.projectDimensions.findEffectiveAiKnowledge(
            "sub:beech",
          );

        expect(effective).not.toBeNull();
        expect(effective?.projectId).toBe("sub:beech");
        expect(effective?.resolvedFromProjectId).toBe("host:forests");
        expect(effective?.aiKnowledgeUrl).toBe(
          "https://www.notion.so/host-forests",
        );
        expect(effective?.aiKnowledgeSources).toHaveLength(1);
        expect(effective?.aiOperatingContext).toBe(
          "Forests host operating context.",
        );
        expect(effective?.aiAutoSyncSchedule).toBe("weekly");
        expect(effective?.aiOptimizedSynthesizedAt).toBe(
          "2026-05-01T00:00:00.000Z",
        );
        expect(effective?.aiOptimizedInputHash).toBe("hash:host-input");
      } finally {
        await context.dispose();
      }
    });

    it("returns the sub's own (likely null) values when the sub is no longer connected", async () => {
      const context = await createTestStage1Context();
      try {
        // Host deactivated; PR #388's cascade clears connectedToProjectId on
        // the sub. The sub stands alone — no fallback fires.
        await context.repositories.projectDimensions.upsert({
          ...baseHostFixture,
          isActive: false,
          aiKnowledgeSources: [sampleSource],
        });
        await context.repositories.projectDimensions.upsert({
          projectId: "sub:beech",
          projectName: "Saving American Beech",
          projectAlias: "Beech",
          source: "salesforce",
          isActive: true,
        });

        const effective =
          await context.repositories.projectDimensions.findEffectiveAiKnowledge(
            "sub:beech",
          );

        expect(effective).not.toBeNull();
        expect(effective?.projectId).toBe("sub:beech");
        expect(effective?.resolvedFromProjectId).toBe("sub:beech");
        expect(effective?.aiKnowledgeUrl).toBeNull();
        expect(effective?.aiKnowledgeSources).toEqual([]);
        expect(effective?.aiOperatingContext).toBe("");
        expect(effective?.aiAutoSyncSchedule).toBe("never");
        expect(effective?.aiOptimizedSynthesizedAt).toBeNull();
        expect(effective?.aiOptimizedInputHash).toBeNull();
      } finally {
        await context.dispose();
      }
    });

    it("returns null when the requested project_id does not exist", async () => {
      const context = await createTestStage1Context();
      try {
        const effective =
          await context.repositories.projectDimensions.findEffectiveAiKnowledge(
            "missing:project",
          );

        expect(effective).toBeNull();
      } finally {
        await context.dispose();
      }
    });
  });
});
