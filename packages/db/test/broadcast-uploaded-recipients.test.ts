import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateDraftInput } from "@as-comms/contracts";

import {
  countBroadcastUploadedRecipientsForRun,
  createStage5RepositoryBundle,
  listBroadcastUploadedRecipientsForRun,
  replaceBroadcastUploadedRecipientsForRun,
  type Stage5RepositoryBundle,
} from "../src/index.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function buildDraftInput(
  id: string,
  projectId = "project-1",
): CreateDraftInput {
  return {
    id,
    kind: "project",
    launchType: "normal_email",
    projectId,
    name: null,
    fromEmail: "project@example.org",
    fromName: "Adventure Scientists",
    replyToEmail: "project@example.org",
    subjectTemplate: "Subject",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    bodyDesignJson: null,
    preheader: null,
    audienceCriteria: {
      projectId,
      projectIds: [projectId],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

async function seedProject(
  context: TestStage1Context,
  projectId = "project-1",
): Promise<void> {
  await context.repositories.projectDimensions.upsert({
    projectId,
    projectName: `Project ${projectId}`,
    projectAlias: `alias-${projectId}`,
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });
}

describe("broadcast uploaded recipients repository", () => {
  let context: TestStage1Context;
  let campaigns: Stage5RepositoryBundle;

  beforeEach(async () => {
    context = await createTestStage1Context();
    campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context, "project-1");
    await seedProject(context, "project-2");
    await campaigns.campaignRuns.create(buildDraftInput("run-1", "project-1"));
    await campaigns.campaignRuns.create(buildDraftInput("run-2", "project-2"));
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("replaces prior rows for the same run", async () => {
    await replaceBroadcastUploadedRecipientsForRun(context.db, "run-1", [
      {
        email: "alpha@example.org",
        firstName: "Alpha",
        lastName: null,
      },
      {
        email: "bravo@example.org",
        firstName: "Bravo",
        lastName: "Lane",
      },
    ]);

    await replaceBroadcastUploadedRecipientsForRun(context.db, "run-1", [
      {
        email: "charlie@example.org",
        firstName: "Charlie",
        lastName: null,
      },
    ]);

    await expect(
      listBroadcastUploadedRecipientsForRun(context.db, "run-1"),
    ).resolves.toMatchObject([
      {
        email: "charlie@example.org",
        firstName: "Charlie",
        lastName: null,
      },
    ]);
  });

  it("lists and counts rows per run in isolation", async () => {
    await replaceBroadcastUploadedRecipientsForRun(context.db, "run-1", [
      {
        email: "alpha@example.org",
        firstName: "Alpha",
        lastName: null,
      },
      {
        email: "bravo@example.org",
        firstName: null,
        lastName: "Lane",
      },
    ]);
    await replaceBroadcastUploadedRecipientsForRun(context.db, "run-2", [
      {
        email: "delta@example.org",
        firstName: "Delta",
        lastName: null,
      },
    ]);

    const runOneRows = await listBroadcastUploadedRecipientsForRun(
      context.db,
      "run-1",
    );
    const runTwoRows = await listBroadcastUploadedRecipientsForRun(
      context.db,
      "run-2",
    );

    expect(runOneRows).toHaveLength(2);
    expect(runTwoRows).toHaveLength(1);
    expect(runOneRows.map((row) => row.email)).toEqual([
      "alpha@example.org",
      "bravo@example.org",
    ]);
    expect(runTwoRows.map((row) => row.email)).toEqual(["delta@example.org"]);
    await expect(
      countBroadcastUploadedRecipientsForRun(context.db, "run-1"),
    ).resolves.toBe(2);
    await expect(
      countBroadcastUploadedRecipientsForRun(context.db, "run-2"),
    ).resolves.toBe(1);
  });
});
