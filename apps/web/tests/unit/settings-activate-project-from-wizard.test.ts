import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateAccessSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag
}));

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateProjectSettings,
  revalidateAccessSettings,
  revalidateIntegrationHealth
}));

import {
  activateProjectFromWizardAction,
  pollProjectKnowledgeBootstrapAction,
  type ActivationWizardInput
} from "../../app/settings/actions";
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

async function seedUser(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly email: string;
    readonly role: "admin" | "operator";
    readonly emailVerified?: Date | null;
    readonly deactivatedAt?: Date | null;
  }
): Promise<void> {
  const now = new Date("2026-04-20T15:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: input.id,
    name: input.email.split("@")[0] ?? input.email,
    email: input.email,
    emailVerified: input.emailVerified ?? now,
    image: null,
    role: input.role,
    deactivatedAt: input.deactivatedAt ?? null,
    createdAt: now,
    updatedAt: now
  });
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly projectAlias?: string | null;
    readonly isActive: boolean;
    readonly aiKnowledgeUrl: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
    readonly emails: readonly {
      readonly address: string;
      readonly signature?: string;
    }[];
  }
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    projectAlias:
      input.projectAlias === undefined ? input.projectName : input.projectAlias,
    source: "salesforce",
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt ?? null
  });

  for (const [index, email] of input.emails.entries()) {
    await runtime.context.settings.aliases.create({
      id: `${input.projectId}:alias:${String(index)}`,
      alias: email.address,
      signature: email.signature ?? "",
      projectId: input.projectId,
      createdAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      updatedAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      createdBy: null,
      updatedBy: null
    });
  }
}

async function seedBootstrapRun(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly status:
      | "queued"
      | "fetching"
      | "synthesizing"
      | "writing"
      | "done"
      | "error";
    readonly errorDetail?: string | null;
  }
): Promise<void> {
  await runtime.context.repositories.projectKnowledgeBootstrapRuns.create({
    id: input.id,
    projectId: input.projectId,
    status: input.status,
    force: false,
    startedAt: "2026-04-20T15:00:00.000Z",
    completedAt:
      input.status === "queued" ||
      input.status === "fetching" ||
      input.status === "synthesizing" ||
      input.status === "writing"
        ? null
        : "2026-04-20T15:05:00.000Z",
    statsJson: {},
    errorDetail: input.errorDetail ?? null,
    createdAt: "2026-04-20T15:00:00.000Z",
    updatedAt: "2026-04-20T15:00:00.000Z"
  });
}

function buildWizardInput(
  overrides: Partial<ActivationWizardInput> = {}
): ActivationWizardInput {
  return {
    projectId: "project:wizard",
    projectAlias: "Field Ops",
    aliases: [
      {
        address: "updates@asc.internal",
        isPrimary: false
      },
      {
        address: "primary@asc.internal",
        isPrimary: true
      }
    ],
    signature: "Adventure Scientists",
    aiKnowledgeRunId: "run:wizard:done",
    ...overrides
  };
}

describe("activation wizard actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime, {
      id: "user:admin",
      email: "admin@adventurescientists.org",
      role: "admin"
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("activates a project from the wizard, writes aliases and signatures, and records a distinct audit row", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:wizard",
      projectName: "Wizard Project",
      projectAlias: null,
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/wizard",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: [
        {
          address: "legacy@asc.internal",
          signature: "Old signature"
        }
      ]
    });
    await seedBootstrapRun(runtime, {
      id: "run:wizard:done",
      projectId: "project:wizard",
      status: "done"
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());
    const updatedProject = await runtime.context.settings.projects.findById(
      "project:wizard"
    );
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "project",
      entityId: "project:wizard"
    });
    const wizardAudit = audits.filter(
      (audit) => audit.action === "settings.project.activated_via_wizard"
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        projectId: "project:wizard",
        projectAlias: "Field Ops",
        isActive: true,
        emails: [
          {
            address: "primary@asc.internal",
            isPrimary: true,
            signature: "Adventure Scientists"
          },
          {
            address: "updates@asc.internal",
            isPrimary: false,
            signature: "Adventure Scientists"
          }
        ]
      }
    });
    expect(updatedProject).toMatchObject({
      projectAlias: "Field Ops",
      isActive: true,
      emails: [
        {
          address: "primary@asc.internal",
          isPrimary: true,
          signature: "Adventure Scientists"
        },
        {
          address: "updates@asc.internal",
          isPrimary: false,
          signature: "Adventure Scientists"
        }
      ]
    });
    expect(wizardAudit).toHaveLength(1);
    expect(wizardAudit[0]).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.project.activated_via_wizard",
      entityType: "project",
      entityId: "project:wizard",
      policyCode: "settings.admin_mutation",
      metadataJson: {
        projectId: "project:wizard",
        projectAlias: "Field Ops",
        aliasCount: 2,
        primaryAlias: "primary@asc.internal",
        runId: "run:wizard:done"
      }
    });
    expect(wizardAudit[0]?.metadataJson).not.toHaveProperty("signature");
    expect(revalidateProjectSettings).toHaveBeenCalledWith("project:wizard");
  });

  it("returns unauthorized when no session is present", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "unauthorized"
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "unauthorized"
    });
  });

  it("returns forbidden for operator sessions", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden"
    });
  });

  it("returns not_found when the project is missing", async () => {
    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "not_found"
    });
  });

  it("returns already_active when the project is already active", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:wizard",
      projectName: "Wizard Project",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/wizard",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "already_active"
    });
  });

  it("rejects the activation when the bootstrap run belongs to a different project", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:wizard",
      projectName: "Wizard Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/wizard",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });
    await seedProject(runtime, {
      projectId: "project:other",
      projectName: "Other Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/other",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });
    await seedBootstrapRun(runtime, {
      id: "run:wizard:done",
      projectId: "project:other",
      status: "done"
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      message: "AI knowledge sync did not complete. Re-run the sync."
    });
  });

  it.each([
    ["queued", "queued"],
    ["running", "fetching"],
    ["errored", "error"]
  ] as const)(
    "rejects activation when the bootstrap run is %s",
    async (_label, status) => {
      if (!runtime) {
        throw new Error("runtime not initialized");
      }

      await seedProject(runtime, {
        projectId: "project:wizard",
        projectName: "Wizard Project",
        isActive: false,
        aiKnowledgeUrl: "https://www.notion.so/wizard",
        aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
        emails: []
      });
      await seedBootstrapRun(runtime, {
        id: "run:wizard:done",
        projectId: "project:wizard",
        status,
        errorDetail: status === "error" ? "Failed." : null
      });

      const result = await activateProjectFromWizardAction(buildWizardInput());

      expect(result).toMatchObject({
        ok: false,
        code: "requirements_not_met",
        message: "AI knowledge sync did not complete. Re-run the sync."
      });
    }
  );

  it("rejects activation when the project sync timestamp is still null after a done run", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:wizard",
      projectName: "Wizard Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/wizard",
      aiKnowledgeSyncedAt: null,
      emails: []
    });
    await seedBootstrapRun(runtime, {
      id: "run:wizard:done",
      projectId: "project:wizard",
      status: "done"
    });

    const result = await activateProjectFromWizardAction(buildWizardInput());

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      message: "AI knowledge sync did not complete. Re-run the sync."
    });
  });

  it.each([
    [
      "project alias too short",
      buildWizardInput({
        projectAlias: "A"
      }),
      "projectAlias",
      "Project alias must be at least 2 characters."
    ],
    [
      "signature too short",
      buildWizardInput({
        signature: "abc"
      }),
      "signature",
      "Signature must be at least 4 characters."
    ],
    [
      "no primary alias",
      buildWizardInput({
        aliases: [
          {
            address: "first@asc.internal",
            isPrimary: false
          }
        ]
      }),
      "aliases",
      "Choose one primary inbox alias."
    ],
    [
      "two primary aliases",
      buildWizardInput({
        aliases: [
          {
            address: "first@asc.internal",
            isPrimary: true
          },
          {
            address: "second@asc.internal",
            isPrimary: true
          }
        ]
      }),
      "aliases",
      "Choose exactly one primary inbox alias."
    ],
    [
      "duplicate aliases",
      buildWizardInput({
        aliases: [
          {
            address: "DUPLICATE@asc.internal",
            isPrimary: true
          },
          {
            address: "duplicate@asc.internal",
            isPrimary: false
          }
        ]
      }),
      "aliases",
      "Each inbox alias must be unique."
    ],
    [
      "empty alias list",
      buildWizardInput({
        aliases: []
      }),
      "aliases",
      "Add at least one inbox alias."
    ]
  ] as const)(
    "returns validation_error for %s",
    async (_label, input, field, message) => {
      const result = await activateProjectFromWizardAction(input);

      expect(result).toMatchObject({
        ok: false,
        code: "validation_error",
        fieldErrors: {
          [field]: message
        }
      });
    }
  );

  it("returns alias_collision when one of the aliases is already assigned to another project", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:wizard",
      projectName: "Wizard Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/wizard",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });
    await seedProject(runtime, {
      projectId: "project:other",
      projectName: "Other Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/other",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: [
        {
          address: "taken@asc.internal"
        }
      ]
    });
    await seedBootstrapRun(runtime, {
      id: "run:wizard:done",
      projectId: "project:wizard",
      status: "done"
    });

    const result = await activateProjectFromWizardAction(
      buildWizardInput({
        aliases: [
          {
            address: "taken@asc.internal",
            isPrimary: true
          }
        ]
      })
    );

    expect(result).toMatchObject({
      ok: false,
      code: "alias_collision",
      fieldErrors: {
        aliases: "An inbox alias is already taken by another project."
      }
    });
  });
});

describe("pollProjectKnowledgeBootstrapAction", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime, {
      id: "user:admin",
      email: "admin@adventurescientists.org",
      role: "admin"
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("maps bootstrap statuses into the wizard polling contract", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:poll",
      projectName: "Polling Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/poll",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:queued",
      projectId: "project:poll",
      status: "queued"
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:fetching",
      projectId: "project:poll",
      status: "fetching"
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:done",
      projectId: "project:poll",
      status: "done"
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:error",
      projectId: "project:poll",
      status: "error",
      errorDetail: "Worker exploded."
    });

    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:poll:queued")
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "queued",
        errorMessage: null
      }
    });
    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:poll:fetching")
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "running",
        errorMessage: null
      }
    });
    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:poll:done")
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "done",
        errorMessage: null
      }
    });
    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:poll:error")
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "error",
        errorMessage: "Worker exploded."
      }
    });
  });

  it("returns mismatched_project when the run id belongs to another project", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:poll",
      projectName: "Polling Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/poll",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:other",
      projectId: "project:other",
      status: "queued"
    });

    const result = await pollProjectKnowledgeBootstrapAction(
      "project:poll",
      "run:poll:other"
    );

    expect(result).toMatchObject({
      ok: false,
      code: "mismatched_project"
    });
  });

  it("returns not_found for unknown runs and surfaces a done-run desync as an error status", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:poll",
      projectName: "Polling Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/poll",
      aiKnowledgeSyncedAt: null,
      emails: []
    });
    await seedBootstrapRun(runtime, {
      id: "run:poll:desync",
      projectId: "project:poll",
      status: "done"
    });

    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:missing")
    ).resolves.toMatchObject({
      ok: false,
      code: "not_found"
    });
    await expect(
      pollProjectKnowledgeBootstrapAction("project:poll", "run:poll:desync")
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "error",
        errorMessage:
          "Bootstrap completed but project sync timestamp was not written."
      }
    });
  });
});
