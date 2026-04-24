import { describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { projectKnowledgeEntries } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

function buildEntry(input: {
  readonly id: string;
  readonly projectId?: string;
  readonly kind?: "canonical_reply" | "snippet" | "pattern";
  readonly questionSummary?: string;
  readonly issueType?: string | null;
  readonly approvedForAi?: boolean;
}) {
  const now = "2026-04-24T12:00:00.000Z";

  return {
    id: input.id,
    projectId: input.projectId ?? "project:alpha",
    kind: input.kind ?? "canonical_reply",
    issueType: input.issueType ?? null,
    volunteerStage: null,
    questionSummary:
      input.questionSummary ?? "How do I prepare for field training?",
    replyStrategy: "Acknowledge the question and point to the next training step.",
    maskedExample:
      "Hi {NAME}, thanks for asking about field training. The next step is to review the checklist.",
    sourceKind: "hand_authored" as const,
    approvedForAi: input.approvedForAi ?? true,
    sourceEventId: null,
    metadataJson: {},
    lastReviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("project_knowledge_entries repository", () => {
  it("round-trips rows and filters approved entries", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectKnowledge.upsert(
        buildEntry({ id: "knowledge:approved" }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:draft",
          questionSummary: "Captured reply awaiting review",
          approvedForAi: false,
        }),
      );

      await expect(
        context.repositories.projectKnowledge.list({
          projectId: "project:alpha",
        }),
      ).resolves.toHaveLength(2);

      await expect(
        context.repositories.projectKnowledge.list({
          projectId: "project:alpha",
          approvedOnly: true,
        }),
      ).resolves.toMatchObject([
        {
          id: "knowledge:approved",
          approvedForAi: true,
        },
      ]);

      await context.repositories.projectKnowledge.setApproved({
        id: "knowledge:draft",
        approved: true,
        reviewedAt: new Date("2026-04-24T13:00:00.000Z"),
      });

      const approved = await context.repositories.projectKnowledge.list({
        projectId: "project:alpha",
        approvedOnly: true,
      });
      expect(approved.map((entry) => entry.id).sort()).toEqual([
        "knowledge:approved",
        "knowledge:draft",
      ]);
      expect(
        approved.find((entry) => entry.id === "knowledge:draft")
          ?.lastReviewedAt,
      ).toBe("2026-04-24T13:00:00.000Z");
    } finally {
      await context.dispose();
    }
  });

  it("ranks retrieval by issue type and keyword matches per kind", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:training",
          kind: "canonical_reply",
          issueType: "Training",
          questionSummary: "Field training checklist and preparation",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:travel",
          kind: "canonical_reply",
          issueType: "Travel",
          questionSummary: "Travel reimbursements",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:snippet",
          kind: "snippet",
          issueType: "Training",
          questionSummary: "Training portal link",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:unapproved",
          issueType: "Training",
          questionSummary: "Hidden training guidance",
          approvedForAi: false,
        }),
      );

      const rows = await context.repositories.projectKnowledge.getForRetrieval({
        projectId: "project:alpha",
        issueTypeHint: "Training",
        keywordsLower: ["training", "checklist"],
        limitPerKind: 1,
      });

      expect(rows.map((row) => row.id)).toEqual([
        "knowledge:training",
        "knowledge:snippet",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("deletes rows by id", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectKnowledge.upsert(
        buildEntry({ id: "knowledge:delete" }),
      );
      await context.repositories.projectKnowledge.deleteById("knowledge:delete");

      await expect(
        context.db
          .select()
          .from(projectKnowledgeEntries)
          .where(eq(projectKnowledgeEntries.id, "knowledge:delete")),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });
});
