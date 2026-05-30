import { describe, expect, it, vi } from "vitest";

import { and, eq } from "drizzle-orm";

import { aiKnowledgeEntries, projectDimensions } from "@as-comms/db";
import type { AiKnowledgeSource } from "@as-comms/contracts";

import { runSynthesizeProjectKnowledge } from "../src/jobs/synthesize-project-knowledge/index.js";
import { createTestWorkerContext } from "./helpers.js";

function buildSource(input: {
  readonly id: string;
  readonly kind: AiKnowledgeSource["kind"];
  readonly url: string;
  readonly label?: string | null;
  readonly sourceId?: string | null;
}): AiKnowledgeSource {
  return {
    id: input.id,
    url: input.url,
    kind: input.kind,
    label: input.label ?? null,
    enabled: true,
    last_synced_at: null,
    last_sync_status: null,
    last_sync_error: null,
    source_id: input.sourceId ?? null,
    source_content_hash: null,
    created_at: "2026-05-09T12:00:00.000Z",
    updated_at: "2026-05-09T12:00:00.000Z",
  };
}

describe("runSynthesizeProjectKnowledge", () => {
  it("persists synthesis metadata, source fetch state, and the new Notion URL", async () => {
    const context = await createTestWorkerContext();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project:synth",
        projectName: "Synth Project",
        projectAlias: "Synth",
        source: "salesforce",
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [
          buildSource({
            id: "11111111-1111-4111-8111-111111111111",
            kind: "inline_text",
            url: "https://example.test/inline-1",
          }),
          buildSource({
            id: "22222222-2222-4222-8222-222222222222",
            kind: "notion",
            url: "https://www.notion.so/project-source",
            sourceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
          buildSource({
            id: "33333333-3333-4333-8333-333333333333",
            kind: "web_page",
            url: "https://example.test/project",
            sourceId: "hash:web",
          }),
        ],
      });

      const result = await runSynthesizeProjectKnowledge(
        {
          repositories: {
            projectDimensions: context.repositories.projectDimensions,
            projectKnowledge: context.repositories.projectKnowledge,
            settingsProjects: context.settings.projects,
          },
          fetchers: {
            inline_text: {
              fetch: vi.fn().mockResolvedValue({
                ok: true,
                unchanged: false,
                content: "Operator context",
                contentHash: "hash:inline",
                lastModified: null,
              }),
            },
            notion: {
              fetch: vi.fn().mockResolvedValue({
                ok: true,
                unchanged: false,
                content: "Notion context",
                contentHash: "hash:notion",
                lastModified: null,
              }),
            },
            web_page: {
              fetch: vi.fn().mockResolvedValue({
                ok: true,
                unchanged: false,
                content: "Web context",
                contentHash: "hash:web",
                lastModified: null,
              }),
            },
          },
          invokeModel: vi.fn().mockResolvedValue({
            text: "# Synthesized AI Knowledge",
            usage: {
              inputTokens: 210,
              outputTokens: 90,
            },
            stopReason: "end_turn",
            model: "claude-sonnet-4-6",
          }),
          notion: {
            apiKey: "notion-key",
            createMarkdownPage: vi.fn().mockResolvedValue({
              // Real Notion returns a 32-hex-character page ID;
              // normalizeNotionId rejects anything else.
              id: "cccccccccccccccccccccccccccccccc",
              url: "https://www.notion.so/new-synthesized-page",
              blockCount: 12,
            }),
          },
          db: context.db,
          now: () => new Date("2026-05-09T15:30:00.000Z"),
        },
        {
          projectId: "project:synth",
        },
      );

      expect(result).toMatchObject({
        ok: true,
        notionUrl: "https://www.notion.so/new-synthesized-page",
        tokensIn: 210,
        tokensOut: 90,
      });

      const [row] = await context.db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:synth"));
      expect(row?.aiOptimizedSynthesizedAt).toEqual(
        new Date("2026-05-09T15:30:00.000Z"),
      );
      expect(row?.aiOptimizedInputHash).toBeTruthy();
      expect(row?.aiKnowledgeUrl).toBe(
        "https://www.notion.so/new-synthesized-page",
      );

      const updatedSources =
        await context.repositories.projectDimensions.getAiKnowledgeSources(
          "project:synth",
        );
      expect(updatedSources).toHaveLength(3);
      for (const source of updatedSources) {
        expect(source.last_synced_at).toBeTruthy();
        expect(source.last_sync_status).toBe("healthy");
        expect(source.source_content_hash).toBeTruthy();
      }

      // The synthesis output should land in ai_knowledge_entries
      // immediately (closes the synthesis-vs-cache seam that left every
      // project's draft pipeline ungrounded until a separate
      // notion-knowledge-sync was manually enqueued).
      const [cacheEntry] = await context.db
        .select()
        .from(aiKnowledgeEntries)
        .where(
          and(
            eq(aiKnowledgeEntries.scope, "project"),
            eq(aiKnowledgeEntries.scopeKey, "project:synth"),
          ),
        );
      expect(cacheEntry).toBeTruthy();
      expect(cacheEntry?.content).toBe("# Synthesized AI Knowledge");
      expect(cacheEntry?.sourceProvider).toBe("notion");
      expect(cacheEntry?.sourceUrl).toBe(
        "https://www.notion.so/new-synthesized-page",
      );
      expect(cacheEntry?.sourceLastEditedAt).toEqual(
        new Date("2026-05-09T15:30:00.000Z"),
      );
    } finally {
      await context.dispose();
    }
  });

  it("deletes stale Notion-scoped cache entries when synthesis publishes a new page", async () => {
    const context = await createTestWorkerContext();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project:stale",
        projectName: "Stale Project",
        projectAlias: "Stale",
        source: "salesforce",
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [
          buildSource({
            id: "44444444-4444-4444-8444-444444444444",
            kind: "inline_text",
            url: "https://example.test/inline-stale",
          }),
        ],
      });

      // Seed a stale project-scoped cache entry that references the OLD
      // synthesis Notion page. After a fresh synthesis lands, this should
      // be deleted in favour of the new entry. sourceId is in the dashed
      // form normalizeNotionId emits (32-hex split into 8-4-4-4-12).
      await context.db.insert(aiKnowledgeEntries).values({
        id: "ai_knowledge:notion:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        scope: "project",
        scopeKey: "project:stale",
        sourceProvider: "notion",
        sourceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sourceUrl: "https://www.notion.so/old-stale-page",
        title: "Stale Project — AI Knowledge (synthesized 2026-04-15T00:00)",
        content: "# Old synthesized content",
        contentHash: "hash:stale",
        metadataJson: {},
        sourceLastEditedAt: new Date("2026-04-15T00:00:00.000Z"),
        syncedAt: new Date("2026-04-15T00:00:00.000Z"),
        updatedAt: new Date("2026-04-15T00:00:00.000Z"),
        createdAt: new Date("2026-04-15T00:00:00.000Z"),
      });

      await runSynthesizeProjectKnowledge(
        {
          repositories: {
            projectDimensions: context.repositories.projectDimensions,
            projectKnowledge: context.repositories.projectKnowledge,
            settingsProjects: context.settings.projects,
          },
          fetchers: {
            inline_text: {
              fetch: vi.fn().mockResolvedValue({
                ok: true,
                unchanged: false,
                content: "Operator context refreshed",
                contentHash: "hash:inline-2",
                lastModified: null,
              }),
            },
            notion: { fetch: vi.fn() },
            web_page: { fetch: vi.fn() },
          },
          invokeModel: vi.fn().mockResolvedValue({
            text: "# Fresh synthesized content",
            usage: { inputTokens: 100, outputTokens: 50 },
            stopReason: "end_turn",
            model: "claude-sonnet-4-6",
          }),
          notion: {
            apiKey: "notion-key",
            createMarkdownPage: vi.fn().mockResolvedValue({
              id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              url: "https://www.notion.so/new-stale-page",
              blockCount: 5,
            }),
          },
          db: context.db,
          now: () => new Date("2026-05-21T12:00:00.000Z"),
        },
        { projectId: "project:stale" },
      );

      const cacheEntries = await context.db
        .select()
        .from(aiKnowledgeEntries)
        .where(
          and(
            eq(aiKnowledgeEntries.scope, "project"),
            eq(aiKnowledgeEntries.scopeKey, "project:stale"),
          ),
        );
      expect(cacheEntries).toHaveLength(1);
      expect(cacheEntries[0]?.content).toBe("# Fresh synthesized content");
      expect(cacheEntries[0]?.sourceUrl).toBe(
        "https://www.notion.so/new-stale-page",
      );
    } finally {
      await context.dispose();
    }
  });
});
