import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

describe("project knowledge bootstrap repositories", () => {
  it("round-trips source links for a project", async () => {
    const context = await createTestStage1Context();
    const now = "2026-04-24T12:00:00.000Z";

    try {
      await context.repositories.projectKnowledgeSourceLinks.upsert({
        id: "source:alpha",
        projectId: "project:alpha",
        kind: "public_project_page",
        label: "Public page",
        url: "https://example.org/project-alpha",
        createdAt: now,
        updatedAt: now,
      });
      await context.repositories.projectKnowledgeSourceLinks.upsert({
        id: "source:beta",
        projectId: "project:beta",
        kind: "training_site",
        label: null,
        url: "https://example.org/project-beta",
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        context.repositories.projectKnowledgeSourceLinks.list("project:alpha"),
      ).resolves.toMatchObject([
        {
          id: "source:alpha",
          kind: "public_project_page",
          label: "Public page",
        },
      ]);

      await context.repositories.projectKnowledgeSourceLinks.deleteById(
        "source:alpha",
      );

      await expect(
        context.repositories.projectKnowledgeSourceLinks.list("project:alpha"),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("tracks bootstrap run status and recent run ordering", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectKnowledgeBootstrapRuns.create({
        id: "run:old",
        projectId: "project:alpha",
        status: "queued",
        force: false,
        startedAt: "2026-04-24T10:00:00.000Z",
        completedAt: null,
        statsJson: {},
        errorDetail: null,
        createdAt: "2026-04-24T10:00:00.000Z",
        updatedAt: "2026-04-24T10:00:00.000Z",
      });
      await context.repositories.projectKnowledgeBootstrapRuns.create({
        id: "run:new",
        projectId: "project:alpha",
        status: "queued",
        force: true,
        startedAt: "2026-04-24T11:00:00.000Z",
        completedAt: null,
        statsJson: {},
        errorDetail: null,
        createdAt: "2026-04-24T11:00:00.000Z",
        updatedAt: "2026-04-24T11:00:00.000Z",
      });

      await context.repositories.projectKnowledgeBootstrapRuns.update({
        id: "run:new",
        status: "done",
        completedAt: "2026-04-24T11:05:00.000Z",
        statsJson: {
          candidatesWritten: 2,
        },
      });

      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.findById("run:new"),
      ).resolves.toMatchObject({
        id: "run:new",
        status: "done",
        force: true,
        completedAt: "2026-04-24T11:05:00.000Z",
        statsJson: {
          candidatesWritten: 2,
        },
      });

      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.listByProject(
          "project:alpha",
          1,
        ),
      ).resolves.toMatchObject([
        {
          id: "run:new",
        },
      ]);
    } finally {
      await context.dispose();
    }
  });
});
