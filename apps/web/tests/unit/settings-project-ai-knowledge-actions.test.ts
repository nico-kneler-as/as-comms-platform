import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateAccessSettings = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag
}));

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateAccessSettings,
  revalidateProjectSettings,
  revalidateIntegrationHealth
}));

import {
  addAiKnowledgeSourceAction,
  removeAiKnowledgeSourceAction,
  submitWizardAiKnowledgeSourcesAction,
  syncOneAiKnowledgeSourceAction,
  triggerProjectKnowledgeSynthesisAction,
  updateAiAutoSyncScheduleAction,
  updateAiKnowledgeSourceAction,
  updateOperatingContextAction
} from "../../app/settings/actions";
import { getStage1WebRuntime } from "../../src/server/stage1-runtime";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support";

function adminSession() {
  return {
    ok: true as const,
    user: {
      id: "user:admin"
    }
  };
}

async function seedProject(runtime: Stage1WebTestRuntime, projectId = "project:ai") {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId,
    projectName: "PNW Biodiversity",
    projectAlias: "PNW",
    source: "salesforce",
    isActive: false,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null
  });
}

async function installSqlSpy() {
  const runtime = await getStage1WebRuntime();
  const sqlSpy = vi.fn(() => Promise.resolve([]));
  if ((runtime as { connection: unknown }).connection !== null) {
    (runtime as { connection: { sql: unknown } }).connection.sql = sqlSpy;
  }
  return sqlSpy;
}

describe("settings project AI knowledge actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
    await seedProject(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("adds a notion source and enqueues synthesis", async () => {
    const sqlSpy = await installSqlSpy();

    const result = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        source: {
          kind: "notion",
          last_sync_status: null
        }
      }
    });
    expect(sqlSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid source URLs and dedupes collisions", async () => {
    const invalid = await addAiKnowledgeSourceAction("project:ai", {
      url: "not-a-url"
    });

    expect(invalid).toMatchObject({
      ok: false,
      code: "validation_error"
    });

    await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.adventurescientists.org/project/whitebark-pine"
    });
    const duplicate = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.adventurescientists.org/project/whitebark-pine"
    });

    expect(duplicate).toMatchObject({
      ok: false,
      code: "duplicate_source"
    });
  });

  it("updates labels without enqueueing and requeues on URL change", async () => {
    const sqlSpy = await installSqlSpy();
    const added = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.adventurescientists.org/project/whitebark-pine"
    });
    if (!added.ok) {
      throw new Error("expected source to be added");
    }
    sqlSpy.mockClear();

    const labelOnly = await updateAiKnowledgeSourceAction(
      "project:ai",
      added.data.source.id,
      {
        label: "Whitebark Pine"
      }
    );

    expect(labelOnly).toMatchObject({
      ok: true,
      data: {
        source: {
          label: "Whitebark Pine"
        }
      }
    });
    expect(sqlSpy).not.toHaveBeenCalled();

    const urlChange = await updateAiKnowledgeSourceAction(
      "project:ai",
      added.data.source.id,
      {
        url: "https://www.adventurescientists.org/project/urban-wildlife"
      }
    );

    expect(urlChange).toMatchObject({
      ok: true,
      data: {
        source: {
          last_sync_status: "pending",
          source_content_hash: null
        }
      }
    });
    expect(sqlSpy).toHaveBeenCalledTimes(1);
  });

  it("removes sources without enqueueing", async () => {
    const sqlSpy = await installSqlSpy();
    const added = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.adventurescientists.org/project/whitebark-pine"
    });
    if (!added.ok) {
      throw new Error("expected source to be added");
    }
    sqlSpy.mockClear();

    const result = await removeAiKnowledgeSourceAction(
      "project:ai",
      added.data.source.id
    );

    expect(result).toMatchObject({
      ok: true
    });
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("enqueues synthesis for per-source and full-project sync", async () => {
    const sqlSpy = await installSqlSpy();
    const added = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.adventurescientists.org/project/whitebark-pine"
    });
    if (!added.ok) {
      throw new Error("expected source to be added");
    }
    sqlSpy.mockClear();

    const syncOne = await syncOneAiKnowledgeSourceAction(
      "project:ai",
      added.data.source.id
    );
    const syncAll = await triggerProjectKnowledgeSynthesisAction("project:ai");

    expect(syncOne).toMatchObject({
      ok: true,
      data: { enqueued: true }
    });
    expect(syncAll).toMatchObject({
      ok: true,
      data: { enqueued: true }
    });
    expect(sqlSpy).toHaveBeenCalledTimes(2);
  });

  it("updates operating context without enqueueing", async () => {
    const sqlSpy = await installSqlSpy();

    const result = await updateOperatingContextAction(
      "project:ai",
      "Only recruit from current season waitlist."
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        content: "Only recruit from current season waitlist."
      }
    });
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("updates the auto-sync schedule without enqueueing", async () => {
    const sqlSpy = await installSqlSpy();

    const result = await updateAiAutoSyncScheduleAction("project:ai", "weekly");

    expect(result).toMatchObject({
      ok: true,
      data: {
        schedule: "weekly"
      }
    });
    expect(sqlSpy).not.toHaveBeenCalled();
    expect(revalidateProjectSettings).toHaveBeenCalledWith("project:ai");
  });

  it("validates the auto-sync schedule input", async () => {
    const result = await updateAiAutoSyncScheduleAction(
      "project:ai",
      "monthly" as never
    );

    expect(result).toMatchObject({
      ok: false,
      code: "validation_error"
    });
  });

  it("returns an auth error when updating the auto-sync schedule as a non-admin", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false as const,
      code: "forbidden",
      message: "Forbidden",
      requestId: "auth-error"
    });

    const result = await updateAiAutoSyncScheduleAction("project:ai", "daily");

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden"
    });
  });

  it("validates wizard source submission and persists multiple sources with labels", async () => {
    const sqlSpy = await installSqlSpy();

    const invalid = await submitWizardAiKnowledgeSourcesAction("project:ai", [
      {
        url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        label: "Notion FAQ"
      },
      { url: "not-a-url", label: "Broken" }
    ]);

    expect(invalid).toMatchObject({
      ok: false,
      code: "validation_error"
    });

    const valid = await submitWizardAiKnowledgeSourcesAction("project:ai", [
      {
        url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        label: "Notion FAQ"
      },
      {
        url: "https://www.adventurescientists.org/project/whitebark-pine",
        label: "Volunteer homepage"
      },
      // Empty row from the wizard should be silently dropped, not failed.
      { url: "", label: "" }
    ]);

    expect(valid).toMatchObject({
      ok: true
    });
    if (!valid.ok) {
      throw new Error("expected valid wizard submission");
    }
    expect(valid.data.sources).toHaveLength(2);
    expect(valid.data.sources[0]?.label).toBe("Notion FAQ");
    expect(valid.data.sources[1]?.label).toBe("Volunteer homepage");
    expect(sqlSpy).toHaveBeenCalledTimes(1);
  });

  it("returns forbidden or not_found across the AI knowledge actions", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      kind: "forbidden",
      error: {
        ok: false,
        code: "forbidden",
        message: "Only admins can add an AI knowledge source.",
        requestId: "request:forbidden"
      }
    });

    const forbidden = await addAiKnowledgeSourceAction("project:ai", {
      url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(forbidden).toMatchObject({
      ok: false,
      code: "forbidden"
    });

    const missingActions = await Promise.all([
      addAiKnowledgeSourceAction("project:missing", {
        url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }),
      updateAiKnowledgeSourceAction("project:missing", "source:missing", {
        label: "Missing"
      }),
      removeAiKnowledgeSourceAction("project:missing", "source:missing"),
      syncOneAiKnowledgeSourceAction("project:missing", "source:missing"),
      triggerProjectKnowledgeSynthesisAction("project:missing"),
      updateAiAutoSyncScheduleAction("project:missing", "daily"),
      updateOperatingContextAction("project:missing", "Missing"),
      submitWizardAiKnowledgeSourcesAction("project:missing", [
        {
          url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          label: null
        }
      ])
    ]);

    for (const result of missingActions) {
      expect(result).toMatchObject({
        ok: false,
        code: "not_found"
      });
    }
  });
});
