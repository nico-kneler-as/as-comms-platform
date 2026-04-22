import { describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { aiKnowledgeEntries } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

describe("ai_knowledge_entries table", () => {
  it("supports insert, upsert by source, and delete by source id", async () => {
    const context = await createTestStage1Context();
    const syncedAt = new Date("2026-04-21T12:00:00.000Z");

    try {
      await context.db.insert(aiKnowledgeEntries).values({
        id: "ai_knowledge:notion:global",
        scope: "global",
        scopeKey: null,
        sourceProvider: "notion",
        sourceId: "3278a912-9211-804b-aa72-c76a86d084d0",
        sourceUrl: "https://www.notion.so/general-training",
        title: null,
        content: "Initial content",
        contentHash: "hash:initial",
        metadataJson: {},
        sourceLastEditedAt: new Date("2026-04-21T11:59:00.000Z"),
        syncedAt
      });

      const [existingRow] = await context.db
        .select()
        .from(aiKnowledgeEntries)
        .where(eq(aiKnowledgeEntries.id, "ai_knowledge:notion:global"))
        .limit(1);

      expect(existingRow).toMatchObject({
        scope: "global",
        sourceProvider: "notion",
        content: "Initial content"
      });

      await context.db
        .insert(aiKnowledgeEntries)
        .values({
          id: "ai_knowledge:notion:global",
          scope: "global",
          scopeKey: null,
          sourceProvider: "notion",
          sourceId: "3278a912-9211-804b-aa72-c76a86d084d0",
          sourceUrl: "https://www.notion.so/general-training",
          title: null,
          content: "Updated content",
          contentHash: "hash:updated",
          metadataJson: {
            tier: 1
          },
          sourceLastEditedAt: new Date("2026-04-21T12:01:00.000Z"),
          syncedAt: new Date("2026-04-21T12:02:00.000Z")
        })
        .onConflictDoUpdate({
          target: [
            aiKnowledgeEntries.sourceProvider,
            aiKnowledgeEntries.sourceId
          ],
          set: {
            content: "Updated content",
            contentHash: "hash:updated",
            metadataJson: {
              tier: 1
            },
            sourceLastEditedAt: new Date("2026-04-21T12:01:00.000Z"),
            syncedAt: new Date("2026-04-21T12:02:00.000Z")
          }
        });

      const [upsertedRow] = await context.db
        .select()
        .from(aiKnowledgeEntries)
        .where(
          and(
            eq(aiKnowledgeEntries.sourceProvider, "notion"),
            eq(
              aiKnowledgeEntries.sourceId,
              "3278a912-9211-804b-aa72-c76a86d084d0"
            )
          )
        )
        .limit(1);

      expect(upsertedRow).toMatchObject({
        content: "Updated content",
        contentHash: "hash:updated",
        metadataJson: {
          tier: 1
        }
      });

      await context.db
        .delete(aiKnowledgeEntries)
        .where(
          eq(
            aiKnowledgeEntries.sourceId,
            "3278a912-9211-804b-aa72-c76a86d084d0"
          )
        );

      await expect(
        context.db
          .select()
          .from(aiKnowledgeEntries)
          .where(eq(aiKnowledgeEntries.id, "ai_knowledge:notion:global"))
      ).resolves.toEqual([]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await context.dispose();
    }
  });
});
