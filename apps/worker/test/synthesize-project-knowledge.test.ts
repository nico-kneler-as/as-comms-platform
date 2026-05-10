import { describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { projectDimensions } from "@as-comms/db";
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
              id: "new-notion-page-id",
              url: "https://www.notion.so/new-synthesized-page",
              blockCount: 12,
            }),
          },
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
    } finally {
      await context.dispose();
    }
  });
});
