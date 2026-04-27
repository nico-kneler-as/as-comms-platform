import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateAccessSettings = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag,
}));

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession,
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateAccessSettings,
  revalidateProjectSettings,
  revalidateIntegrationHealth,
}));

import {
  activateProjectAction,
  syncProjectAiKnowledgeAction,
  updateProjectAiKnowledgeAction,
} from "../../app/settings/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function adminSession() {
  return {
    ok: true as const,
    user: {
      id: "user:admin",
    },
  };
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectAlias: string | null;
    readonly aiKnowledgeUrl: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
    readonly hasCachedContent?: boolean;
    readonly isActive?: boolean;
    readonly emails?: readonly string[];
  },
) {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: "PNW Biodiversity",
    projectAlias: input.projectAlias,
    source: "salesforce",
    isActive: input.isActive ?? false,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt ?? null,
  });

  for (const [index, email] of (input.emails ?? []).entries()) {
    await runtime.context.settings.aliases.create({
      id: `${input.projectId}:alias:${String(index)}`,
      alias: email,
      signature: "Warmly",
      projectId: input.projectId,
      createdAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      updatedAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      createdBy: null,
      updatedBy: null,
    });
  }

  if (input.hasCachedContent === true) {
    await runtime.context.repositories.aiKnowledge.upsert({
      id: `ai_knowledge:notion:${input.projectId}`,
      scope: "project",
      scopeKey: input.projectId,
      sourceProvider: "notion",
      sourceId: `${input.projectId}-page`,
      sourceUrl: input.aiKnowledgeUrl,
      title: "Project context",
      content: "Grounding",
      contentHash: "hash",
      metadataJson: {},
      sourceLastEditedAt: null,
      syncedAt: "2026-04-20T15:00:00.000Z",
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:00:00.000Z",
    });
  }
}

describe("settings project actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("requires a Notion URL before direct activation", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:no-url",
      projectAlias: "PNW",
      aiKnowledgeUrl: null,
      emails: ["pnw@adventurescientists.org"],
    });

    const result = await activateProjectAction("project:no-url");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      fieldErrors: {
        aiKnowledgeUrl: "Set a Notion page URL before activating this project.",
      },
    });
  });

  it("allows activation when alias, email, and Notion URL are present", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:ready",
      projectAlias: "PNW",
      aiKnowledgeUrl: "https://www.notion.so/workspace/pnw-page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      aiKnowledgeSyncedAt: null,
      emails: ["pnw@adventurescientists.org"],
    });

    const result = await activateProjectAction("project:ready");

    expect(result).toMatchObject({
      ok: true,
      data: {
        projectId: "project:ready",
        isActive: true,
      },
    });
  });

  it("unlinks AI knowledge atomically", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:linked",
      projectAlias: "PNW",
      aiKnowledgeUrl: "https://www.notion.so/workspace/pnw-page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      hasCachedContent: true,
      emails: ["pnw@adventurescientists.org"],
    });

    const result = await updateProjectAiKnowledgeAction("project:linked", null);

    expect(result).toMatchObject({
      ok: true,
      data: {
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        hasCachedAiKnowledge: false,
      },
    });
  });

  it("refuses a manual sync when no Notion URL is configured", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:missing-url",
      projectAlias: "PNW",
      aiKnowledgeUrl: null,
      emails: ["pnw@adventurescientists.org"],
    });

    const result = await syncProjectAiKnowledgeAction("project:missing-url");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
    });
  });
});
