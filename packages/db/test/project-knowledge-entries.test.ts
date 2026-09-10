import { describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { projectKnowledgeEntries } from "../src/index.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function buildEntry(input: {
  readonly id: string;
  readonly projectId?: string;
  readonly kind?: "canonical_reply" | "snippet" | "pattern";
  readonly questionSummary?: string;
  readonly issueType?: string | null;
  readonly approvedForAi?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
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
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

async function seedConnectedProjects(
  context: TestStage1Context,
): Promise<void> {
  await context.repositories.projectDimensions.upsert({
    projectId: "project:host",
    projectName: "Host project",
    projectAlias: "Host",
    source: "salesforce",
    isActive: true,
  });
  await context.repositories.projectDimensions.upsert({
    projectId: "project:sub",
    projectName: "Connected sub-project",
    projectAlias: null,
    source: "salesforce",
    isActive: true,
    connectedToProjectId: "project:host",
  });
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

  it("retrieves host rows when a connected sub-project has none of its own", async () => {
    const context = await createTestStage1Context();
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);

    try {
      await seedConnectedProjects(context);
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:host-only",
          projectId: "project:host",
          questionSummary: "Host field kit guidance",
        }),
      );

      const rows = await context.repositories.projectKnowledge.getForRetrieval({
        projectId: "project:sub",
        issueTypeHint: null,
        keywordsLower: [],
        limitPerKind: 3,
      });

      expect(rows.map((row) => row.id)).toEqual(["knowledge:host-only"]);
      expect(debugSpy).toHaveBeenCalledWith(
        '{"event":"project_knowledge.fallback","subProjectId":"project:sub","hostProjectId":"project:host"}',
      );
    } finally {
      debugSpy.mockRestore();
      await context.dispose();
    }
  });

  it("prefers equally relevant sub-project rows over host rows", async () => {
    const context = await createTestStage1Context();

    try {
      await seedConnectedProjects(context);
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:host-equal",
          projectId: "project:host",
          questionSummary: "Alpha host guidance",
          updatedAt: "2026-04-25T12:00:00.000Z",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:sub-equal",
          projectId: "project:sub",
          questionSummary: "Zebra sub-project guidance",
        }),
      );

      const rows = await context.repositories.projectKnowledge.getForRetrieval({
        projectId: "project:sub",
        issueTypeHint: null,
        keywordsLower: [],
        limitPerKind: 3,
      });

      expect(rows.map((row) => row.id)).toEqual([
        "knowledge:sub-equal",
        "knowledge:host-equal",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("keeps a more relevant host row ahead of a lower-scoring sub-project row", async () => {
    const context = await createTestStage1Context();

    try {
      await seedConnectedProjects(context);
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:host-relevant",
          projectId: "project:host",
          issueType: "Training",
          questionSummary: "Training checklist guidance",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:sub-lower-score",
          projectId: "project:sub",
          questionSummary: "General welcome message",
        }),
      );

      const rows = await context.repositories.projectKnowledge.getForRetrieval({
        projectId: "project:sub",
        issueTypeHint: "Training",
        keywordsLower: ["training"],
        limitPerKind: 3,
      });

      expect(rows.map((row) => row.id)).toEqual([
        "knowledge:host-relevant",
        "knowledge:sub-lower-score",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("preserves host-project retrieval and limits each kind across combined rows", async () => {
    const context = await createTestStage1Context();
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project:host",
        projectName: "Host project",
        projectAlias: "Host",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:host-one",
          projectId: "project:host",
          questionSummary: "Host one",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:host-two",
          projectId: "project:host",
          questionSummary: "Host two",
        }),
      );

      const hostRows =
        await context.repositories.projectKnowledge.getForRetrieval({
          projectId: "project:host",
          issueTypeHint: null,
          keywordsLower: [],
          limitPerKind: 1,
        });

      expect(hostRows.map((row) => row.id)).toEqual(["knowledge:host-one"]);
      expect(debugSpy).not.toHaveBeenCalled();

      await seedConnectedProjects(context);
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:sub-one",
          projectId: "project:sub",
          questionSummary: "Sub one",
        }),
      );
      await context.repositories.projectKnowledge.upsert(
        buildEntry({
          id: "knowledge:sub-two",
          projectId: "project:sub",
          questionSummary: "Sub two",
        }),
      );

      const combinedRows =
        await context.repositories.projectKnowledge.getForRetrieval({
          projectId: "project:sub",
          issueTypeHint: null,
          keywordsLower: [],
          limitPerKind: 2,
        });

      expect(combinedRows.map((row) => row.id)).toEqual([
        "knowledge:sub-one",
        "knowledge:sub-two",
      ]);
    } finally {
      debugSpy.mockRestore();
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
