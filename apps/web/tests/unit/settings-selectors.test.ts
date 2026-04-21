import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader
}));

const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser
}));

import {
  loadAccessSettings,
  loadIntegrationHealth,
  loadProjectSettingsDetail,
  loadProjectsSettings
} from "../../src/server/settings/selectors";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support";

function buildUser(input: {
  readonly id: string;
  readonly email: string;
  readonly role: "admin" | "operator";
  readonly emailVerified?: Date | null;
  readonly deactivatedAt?: Date | null;
}): {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: Date | null;
  readonly image: null;
  readonly role: "admin" | "operator";
  readonly deactivatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
} {
  const now = new Date("2026-04-20T15:00:00.000Z");
  return {
    id: input.id,
    name: input.email.split("@")[0] ?? input.email,
    email: input.email,
    emailVerified: input.emailVerified ?? now,
    image: null,
    role: input.role,
    deactivatedAt: input.deactivatedAt ?? null,
    createdAt: now,
    updatedAt: now
  };
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly isActive: boolean;
    readonly aiKnowledgeUrl: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
    readonly emails: readonly string[];
    readonly memberCount: number;
  }
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    source: "salesforce",
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt ?? null
  });

  for (const [index, email] of input.emails.entries()) {
    await runtime.context.settings.aliases.create({
      id: `${input.projectId}:alias:${String(index)}`,
      alias: email,
      signature: "",
      projectId: input.projectId,
      createdAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      updatedAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      createdBy: null,
      updatedBy: null
    });
  }

  for (let index = 0; index < input.memberCount; index += 1) {
    const contactId = `contact:${input.projectId}:${String(index)}`;
    await runtime.context.repositories.contacts.upsert({
      id: contactId,
      salesforceContactId: null,
      displayName: `${input.projectName} Member ${String(index + 1)}`,
      primaryEmail: null,
      primaryPhone: null,
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:00:00.000Z"
    });
    await runtime.context.repositories.contactMemberships.upsert({
      id: `${input.projectId}:membership:${String(index)}`,
      contactId,
      projectId: input.projectId,
      expeditionId: null,
      role: "volunteer",
      status: "active",
      source: "salesforce"
    });
  }
}

describe("settings selectors", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue({
      id: "user:admin",
      role: "admin"
    });
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("returns only active projects for the active filter with accurate counts", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:active-ready",
      projectName: "Ready Project",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/ready",
      emails: ["ready@asc.internal"],
      memberCount: 2
    });
    await seedProject(runtime, {
      projectId: "project:active-missing-knowledge",
      projectName: "Missing Knowledge",
      isActive: true,
      aiKnowledgeUrl: null,
      emails: ["missing@asc.internal"],
      memberCount: 1
    });
    await seedProject(runtime, {
      projectId: "project:inactive",
      projectName: "Inactive Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/inactive",
      emails: ["inactive@asc.internal"],
      memberCount: 3
    });

    const viewModel = await loadProjectsSettings({
      filter: "active"
    });

    expect(viewModel.active).toHaveLength(2);
    expect(viewModel.active.every((project) => project.isActive)).toBe(true);
    expect(viewModel.inactive).toHaveLength(0);
    expect(viewModel.counts).toEqual({
      active: 2,
      inactive: 0,
      total: 2
    });
  });

  it("marks activation requirements met only when a project has email plus knowledge url", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:ready",
      projectName: "Ready Project",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/ready",
      emails: ["ready@asc.internal"],
      memberCount: 1
    });
    await seedProject(runtime, {
      projectId: "project:no-knowledge",
      projectName: "No Knowledge",
      isActive: true,
      aiKnowledgeUrl: null,
      emails: ["knowledge-missing@asc.internal"],
      memberCount: 1
    });
    await seedProject(runtime, {
      projectId: "project:no-email",
      projectName: "No Email",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/no-email",
      emails: [],
      memberCount: 0
    });

    const viewModel = await loadProjectsSettings({
      filter: "all"
    });
    const projects = [...viewModel.active, ...viewModel.inactive];

    expect(
      projects.find((project) => project.projectId === "project:ready")
        ?.activationRequirementsMet
    ).toBe(true);
    expect(
      projects.find((project) => project.projectId === "project:no-knowledge")
        ?.activationRequirementsMet
    ).toBe(false);
    expect(
      projects.find((project) => project.projectId === "project:no-email")
        ?.activationRequirementsMet
    ).toBe(false);
  });

  it("returns null when project detail is requested for an unknown id", async () => {
    await expect(
      loadProjectSettingsDetail("project:does-not-exist")
    ).resolves.toBeNull();
  });

  it("buckets admins and internal users from the users table", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:admin",
        email: "admin@adventurescientists.org",
        role: "admin"
      })
    );
    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:operator-active",
        email: "operator.active@adventurescientists.org",
        role: "operator"
      })
    );
    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:operator-pending",
        email: "operator.pending@adventurescientists.org",
        role: "operator",
        emailVerified: null
      })
    );

    const viewModel = await loadAccessSettings();

    expect(viewModel.admins.map((user) => user.userId)).toEqual(["user:admin"]);
    expect(viewModel.internalUsers.map((user) => user.userId)).toEqual([
      "user:operator-active",
      "user:operator-pending"
    ]);
    expect(viewModel.internalUsers.map((user) => user.role)).toEqual([
      "internal_user",
      "internal_user"
    ]);
  });

  it("returns the six seeded integrations in stable order on first read", async () => {
    const viewModel = await loadIntegrationHealth();

    expect(viewModel.integrations.map((integration) => integration.serviceName)).toEqual(
      [
        "salesforce",
        "gmail",
        "simpletexting",
        "mailchimp",
        "notion",
        "openai"
      ]
    );
    expect(viewModel.integrations.map((integration) => integration.status)).toEqual(
      [
        "not_checked",
        "not_checked",
        "not_configured",
        "not_configured",
        "not_configured",
        "not_configured"
      ]
    );
  });
});
