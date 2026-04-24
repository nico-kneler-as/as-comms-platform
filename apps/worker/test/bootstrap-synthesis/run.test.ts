import { describe, expect, it, vi } from "vitest";

import type { ProjectKnowledgeEntryRecord } from "@as-comms/contracts";

import {
  runBootstrapProjectKnowledge,
  type BootstrapProjectKnowledgeDependencies,
} from "../../src/jobs/bootstrap-project-knowledge/run.js";
import type { SynthesisResult } from "../../src/jobs/bootstrap-project-knowledge/synthesize.js";
import { createTestWorkerContext } from "../helpers.js";

const nowIso = "2026-04-24T12:00:00.000Z";

async function createRun(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  input: {
    readonly runId: string;
    readonly projectId?: string;
    readonly force?: boolean;
  },
) {
  await context.repositories.projectKnowledgeBootstrapRuns.create({
    id: input.runId,
    projectId: input.projectId ?? "project:alpha",
    status: "queued",
    force: input.force ?? false,
    startedAt: nowIso,
    completedAt: null,
    statsJson: {},
    errorDetail: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function createSource(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  projectId = "project:alpha",
) {
  await context.repositories.projectKnowledgeSourceLinks.upsert({
    id: "source:alpha",
    projectId,
    kind: "public_project_page",
    label: "Public page",
    url: "https://example.org/project-alpha",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

function buildDependencies(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  overrides?: Partial<BootstrapProjectKnowledgeDependencies>,
): BootstrapProjectKnowledgeDependencies {
  return {
    db: context.db,
    repositories: context.repositories,
    settings: context.settings,
    env: {},
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    now: () => new Date(nowIso),
    fetchAndExtract: () =>
      Promise.resolve({
        title: "Project Alpha",
        markdown: "Volunteers should complete field training before deployment.",
        wordCount: 7,
      }),
    synthesize: (): Promise<SynthesisResult> =>
      Promise.resolve({
        candidates: [
          {
            topic: "Field training",
            kind: "canonical_reply",
            issueType: "training",
            volunteerStage: "pre-deployment",
            questionSummary: "What training is required?",
            replyStrategy: "Confirm the required field training before deployment.",
            maskedExample:
              "Hi {NAME}, please complete field training before deployment.",
            sourceExcerpt:
              "Volunteers should complete field training before deployment.",
            chunkId: "source:alpha:chunk:1",
          },
        ],
        topicsFound: 1,
        costEstimateUsd: 0.0123,
        modelCalls: 2,
        warnings: [],
      }),
    ...overrides,
  };
}

function seedKnowledgeEntry(
  index: number,
  projectId = "project:alpha",
): ProjectKnowledgeEntryRecord {
  return {
    id: `knowledge:${String(index)}`,
    projectId,
    kind: "snippet",
    issueType: "training",
    volunteerStage: null,
    questionSummary: `Existing entry ${String(index)}`,
    replyStrategy: null,
    maskedExample: null,
    sourceKind: "hand_authored",
    approvedForAi: true,
    sourceEventId: null,
    metadataJson: {},
    lastReviewedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

describe("bootstrap project knowledge run", () => {
  it("fetches sources, synthesizes candidates, and writes unapproved bootstrap entries", async () => {
    const context = await createTestWorkerContext();

    try {
      await createSource(context);
      await createRun(context, {
        runId: "run:happy",
      });

      await runBootstrapProjectKnowledge(buildDependencies(context), {
        runId: "run:happy",
        projectId: "project:alpha",
      });

      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.findById("run:happy"),
      ).resolves.toMatchObject({
        status: "done",
        completedAt: nowIso,
        statsJson: {
          sourcesConfigured: 1,
          sourcesFetched: 1,
          candidatesWritten: 1,
          costEstimateUsd: 0.0123,
          budgetWarn: false,
        },
      });

      await expect(
        context.repositories.projectKnowledge.list({
          projectId: "project:alpha",
        }),
      ).resolves.toMatchObject([
        {
          sourceKind: "bootstrap_synthesized",
          approvedForAi: false,
          questionSummary: "What training is required?",
          metadataJson: {
            bootstrapRunId: "run:happy",
            sourceExcerpt:
              "Volunteers should complete field training before deployment.",
            chunkId: "source:alpha:chunk:1",
          },
        },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("marks the run as error when no source links are configured", async () => {
    const context = await createTestWorkerContext();

    try {
      await createRun(context, {
        runId: "run:no-sources",
      });

      await runBootstrapProjectKnowledge(buildDependencies(context), {
        runId: "run:no-sources",
        projectId: "project:alpha",
      });

      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.findById(
          "run:no-sources",
        ),
      ).resolves.toMatchObject({
        status: "error",
        errorDetail:
          "No knowledge source links are configured for this project. Add at least one source before generating baseline knowledge.",
      });
    } finally {
      await context.dispose();
    }
  });

  it("requires force when the project already has more than 50 knowledge entries", async () => {
    const context = await createTestWorkerContext();
    const synthesize = vi.fn();

    try {
      await createSource(context);
      await createRun(context, {
        runId: "run:needs-force",
      });
      for (let index = 0; index < 51; index += 1) {
        await context.repositories.projectKnowledge.upsert(seedKnowledgeEntry(index));
      }

      await runBootstrapProjectKnowledge(
        buildDependencies(context, {
          synthesize,
        }),
        {
          runId: "run:needs-force",
          projectId: "project:alpha",
        },
      );

      expect(synthesize).not.toHaveBeenCalled();
      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.findById(
          "run:needs-force",
        ),
      ).resolves.toMatchObject({
        status: "error",
        errorDetail:
          "This project already has more than 50 knowledge entries. Confirm generation to run bootstrap anyway.",
      });
    } finally {
      await context.dispose();
    }
  });

  it("marks provider or synthesis failures as non-retried admin-visible run errors", async () => {
    const context = await createTestWorkerContext();

    try {
      await createSource(context);
      await createRun(context, {
        runId: "run:provider-error",
        force: true,
      });

      await runBootstrapProjectKnowledge(
        buildDependencies(context, {
          synthesize: () =>
            Promise.reject(new Error("Anthropic provider unavailable.")),
        }),
        {
          runId: "run:provider-error",
          projectId: "project:alpha",
          force: true,
        },
      );

      await expect(
        context.repositories.projectKnowledgeBootstrapRuns.findById(
          "run:provider-error",
        ),
      ).resolves.toMatchObject({
        status: "error",
        errorDetail: "Anthropic provider unavailable.",
      });
    } finally {
      await context.dispose();
    }
  });
});
