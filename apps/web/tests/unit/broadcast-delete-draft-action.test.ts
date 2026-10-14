import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const requireSessionMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin: requireAdminMock,
  requireSession: requireSessionMock,
}));

import { deleteDraft as deleteDraftAction } from "../../app/broadcasts/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:admin",
    email: "admin@example.org",
  };
}

async function seedUser(runtime: Stage1WebTestRuntime): Promise<void> {
  const now = new Date("2026-07-08T12:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: "user:admin",
    name: "Admin User",
    email: "admin@example.org",
    emailVerified: now,
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProject(runtime: Stage1WebTestRuntime): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project-1",
    projectName: "Project Atlas",
    projectAlias: "atlas",
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

async function seedDraftRun(
  runtime: Stage1WebTestRuntime,
  runId: string,
  extra: {
    readonly workspace?: "volunteers" | "donors";
    readonly resendOfRunId?: string;
  } = {},
): Promise<void> {
  await runtime.runtime.campaigns.campaignRuns.create({
    id: runId,
    ...(extra.workspace === undefined ? {} : { workspace: extra.workspace }),
    ...(extra.resendOfRunId === undefined
      ? {}
      : { resendOfRunId: extra.resendOfRunId, resendDelayDays: 3 }),
    kind: "project",
    launchType: "normal_email",
    projectId: "project-1",
    name: "Draft to delete",
    fromEmail: "atlas@adventurescientists.org",
    fromName: null,
    replyToEmail: "atlas@adventurescientists.org",
    subjectTemplate: "Volunteer update",
    bodyDesignJson: null,
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId: "project-1",
      projectIds: ["project-1"],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: "user:admin",
    lastEditedByUserId: "user:admin",
  });
}

describe("broadcast delete draft action", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    headersMock.mockReset();
    requireAdminMock.mockReset();
    requireSessionMock.mockReset();

    headersMock.mockResolvedValue(new Headers());
    requireAdminMock.mockResolvedValue(sessionUser());
    requireSessionMock.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
    await seedProject(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("deletes a draft and appends an audit record", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedDraftRun(runtime, "run-delete-success");
    const deleteDraftSpy = vi.spyOn(
      runtime.runtime.campaigns.campaignRuns,
      "deleteDraft",
    );

    const result = await deleteDraftAction("run-delete-success");

    expect(deleteDraftSpy).toHaveBeenCalledWith("run-delete-success");
    expect(result).toMatchObject({
      ok: true,
      data: {
        runId: "run-delete-success",
        scheduledAt: null,
        state: "cancelled",
      },
    });
    await expect(
      runtime.runtime.campaigns.campaignRuns.findById("run-delete-success"),
    ).resolves.toBeNull();

    const audits = await runtime.context.repositories.auditEvidence.listByEntity(
      {
        entityType: "campaign_run",
        entityId: "run-delete-success",
      },
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: "user:admin",
      action: "campaign_run.draft_deleted",
      metadataJson: {
        detail: "Draft deleted before launch.",
      },
    });
  });

  it("refuses to delete a non-draft run", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedDraftRun(runtime, "run-delete-scheduled");
    await runtime.runtime.campaigns.campaignRuns.transitionState(
      "run-delete-scheduled",
      "draft",
      "scheduled",
      {
        scheduledAt: "2026-07-08T13:00:00.000Z",
      },
    );
    const deleteDraftSpy = vi.spyOn(
      runtime.runtime.campaigns.campaignRuns,
      "deleteDraft",
    );

    const result = await deleteDraftAction("run-delete-scheduled");

    expect(result).toMatchObject({
      ok: false,
      code: "campaign_delete_draft_failed",
      message: "Only drafts can be deleted.",
    });
    expect(deleteDraftSpy).not.toHaveBeenCalled();

    const audits = await runtime.context.repositories.auditEvidence.listByEntity(
      {
        entityType: "campaign_run",
        entityId: "run-delete-scheduled",
      },
    );
    expect(audits).toEqual([]);
  });

  it("requires admin access", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedDraftRun(runtime, "run-delete-forbidden");
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const deleteDraftSpy = vi.spyOn(
      runtime.runtime.campaigns.campaignRuns,
      "deleteDraft",
    );

    const result = await deleteDraftAction("run-delete-forbidden");

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only admins can manage broadcasts.",
    });
    expect(deleteDraftSpy).not.toHaveBeenCalled();
  });

  it("lets a donors-only teammate delete a donor draft without the admin role", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const now = new Date("2026-10-14T12:00:00.000Z");
    await runtime.context.settings.users.upsert({
      id: "user:devynn",
      name: "Devynn",
      email: "devynn@example.org",
      emailVerified: now,
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await runtime.context.settings.users.setWorkspaces("user:devynn", ["donors"]);
    requireSessionMock.mockResolvedValue({
      id: "user:devynn",
      email: "devynn@example.org",
      role: "operator",
    });
    await seedDraftRun(runtime, "run-donor-draft", { workspace: "donors" });

    const result = await deleteDraftAction("run-donor-draft");

    expect(result).toMatchObject({ ok: true });
    expect(requireAdminMock).not.toHaveBeenCalled();
    await expect(
      runtime.runtime.campaigns.campaignRuns.findById("run-donor-draft"),
    ).resolves.toBeNull();
  });

  it("refuses a donor draft to a volunteers-only operator", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    requireSessionMock.mockResolvedValue({
      id: "user:admin",
      email: "admin@example.org",
      role: "operator",
    });
    await runtime.context.settings.users.setWorkspaces("user:admin", ["volunteers"]);
    await seedDraftRun(runtime, "run-donor-guarded", { workspace: "donors" });

    const result = await deleteDraftAction("run-donor-guarded");

    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    await expect(
      runtime.runtime.campaigns.campaignRuns.findById("run-donor-guarded"),
    ).resolves.not.toBeNull();
  });

  it("removes a configured reminder together with its draft", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedDraftRun(runtime, "run-parent-with-reminder");
    await seedDraftRun(runtime, "run-reminder-child", {
      resendOfRunId: "run-parent-with-reminder",
    });

    const result = await deleteDraftAction("run-parent-with-reminder");

    expect(result).toMatchObject({ ok: true });
    await expect(
      runtime.runtime.campaigns.campaignRuns.findById("run-parent-with-reminder"),
    ).resolves.toBeNull();
    await expect(
      runtime.runtime.campaigns.campaignRuns.findById("run-reminder-child"),
    ).resolves.toBeNull();
  });
});
