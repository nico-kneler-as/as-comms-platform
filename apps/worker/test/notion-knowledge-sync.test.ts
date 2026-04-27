import { describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import { aiKnowledgeEntries, projectDimensions } from "@as-comms/db";
import { normalizeNotionId, type NotionClient } from "@as-comms/integrations";

import { runNotionKnowledgeSync } from "../src/jobs/notion-knowledge-sync/sync.js";
import { createTestWorkerContext } from "./helpers.js";

function buildRichText(text: string) {
  return [
    {
      plain_text: text,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        code: false,
      },
    },
  ];
}

function buildPage(input: {
  readonly id: string;
  readonly title: string;
  readonly lastEditedTime: string;
  readonly url: string;
}) {
  return {
    id: normalizeNotionId(input.id),
    url: input.url,
    last_edited_time: input.lastEditedTime,
    properties: {
      title: {
        type: "title",
        title: buildRichText(input.title),
      },
    },
  };
}

function buildParagraphBlock(id: string, text: string) {
  return {
    id: normalizeNotionId(id),
    type: "paragraph",
    has_children: false,
    paragraph: {
      rich_text: buildRichText(text),
    },
  };
}

function createFakeNotionClient(input: {
  readonly pages: Record<string, Record<string, unknown>>;
  readonly blockChildren?: Record<string, readonly Record<string, unknown>[]>;
}): NotionClient {
  const blockChildren = new Map(
    Object.entries(input.blockChildren ?? {}).map(([blockId, blocks]) => [
      normalizeNotionId(blockId),
      blocks,
    ]),
  );

  return {
    retrievePage(pageId) {
      const page = input.pages[normalizeNotionId(pageId)];
      if (page === undefined) {
        return Promise.reject(new Error(`Missing page fixture for ${pageId}`));
      }

      return Promise.resolve(page);
    },
    listBlockChildren({ blockId }) {
      return Promise.resolve({
        results: blockChildren.get(normalizeNotionId(blockId)) ?? [],
        has_more: false,
        next_cursor: null,
      });
    },
    queryDatabase() {
      return Promise.resolve({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    },
  };
}

async function seedProject(
  projectId: string,
  input?: {
    readonly aiKnowledgeUrl?: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
  },
) {
  const context = await createTestWorkerContext();
  await context.repositories.projectDimensions.upsert({
    projectId,
    projectName: "PNW Biodiversity",
    source: "salesforce",
    aiKnowledgeUrl: input?.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt: input?.aiKnowledgeSyncedAt ?? null,
  });
  return context;
}

describe("runNotionKnowledgeSync", () => {
  it("returns not_configured when NOTION_API_KEY is missing", async () => {
    const context = await seedProject("project:alpha");

    try {
      const result = await runNotionKnowledgeSync(
        {
          db: context.db,
          integrationHealth: context.settings.integrationHealth,
          notion: {
            apiKey: null,
            generalTrainingPageId: null,
          },
        },
        {
          projectId: "project:alpha",
          trigger: "manual",
        },
      );

      expect(result).toMatchObject({
        ok: false,
        code: "not_configured",
      });
      await expect(
        context.settings.integrationHealth.findById("notion"),
      ).resolves.toMatchObject({
        status: "not_configured",
      });
    } finally {
      await context.dispose();
    }
  });

  it("rejects a project without a valid Notion page URL", async () => {
    const context = await seedProject("project:beta", {
      aiKnowledgeUrl: "https://www.notion.so/workspace/no-page-id",
    });

    try {
      const result = await runNotionKnowledgeSync(
        {
          db: context.db,
          integrationHealth: context.settings.integrationHealth,
          notion: {
            apiKey: "test-key",
            generalTrainingPageId: null,
          },
          createClient: () =>
            createFakeNotionClient({
              pages: {},
            }),
        },
        {
          projectId: "project:beta",
          trigger: "manual",
        },
      );

      expect(result).toMatchObject({
        ok: false,
        code: "invalid_source",
      });
    } finally {
      await context.dispose();
    }
  });

  it("syncs the project page into ai_knowledge_entries and stamps the project row", async () => {
    const projectPageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const generalPageId = normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const context = await seedProject("project:gamma", {
      aiKnowledgeUrl: `https://www.notion.so/workspace/PNW-${projectPageId.replace(/-/gu, "")}`,
    });

    try {
      const result = await runNotionKnowledgeSync(
        {
          db: context.db,
          integrationHealth: context.settings.integrationHealth,
          notion: {
            apiKey: "test-key",
            generalTrainingPageId: generalPageId,
          },
          createClient: () =>
            createFakeNotionClient({
              pages: {
                [projectPageId]: buildPage({
                  id: projectPageId,
                  title: "PNW Biodiversity",
                  lastEditedTime: "2026-04-27T12:00:00.000Z",
                  url: "https://www.notion.so/workspace/pnw-bio",
                }),
                [generalPageId]: buildPage({
                  id: generalPageId,
                  title: "General Training",
                  lastEditedTime: "2026-04-27T12:05:00.000Z",
                  url: "https://www.notion.so/workspace/general-training",
                }),
              },
              blockChildren: {
                [projectPageId]: [buildParagraphBlock(projectPageId, "Project context")],
                [generalPageId]: [buildParagraphBlock(generalPageId, "Voice guidance")],
              },
            }),
        },
        {
          projectId: "project:gamma",
          trigger: "url_save",
        },
      );

      expect(result).toMatchObject({
        ok: true,
        projectId: "project:gamma",
        sourceId: projectPageId,
        generalTrainingUpdated: true,
      });

      const rows = await context.db
        .select()
        .from(aiKnowledgeEntries)
        .orderBy(aiKnowledgeEntries.scope, aiKnowledgeEntries.sourceId);
      expect(rows).toHaveLength(2);
      expect(
        rows.find((row) => row.scope === "project" && row.scopeKey === "project:gamma"),
      ).toMatchObject({
        sourceProvider: "notion",
        sourceId: projectPageId,
        content: "Project context",
      });

      const [projectRow] = await context.db
        .select({
          aiKnowledgeSyncedAt: projectDimensions.aiKnowledgeSyncedAt,
        })
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:gamma"));
      expect(projectRow?.aiKnowledgeSyncedAt).toBeInstanceOf(Date);
    } finally {
      await context.dispose();
    }
  });
});
