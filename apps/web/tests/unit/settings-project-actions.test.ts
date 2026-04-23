import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateAccessSettings = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateAccessSettings,
  revalidateProjectSettings,
  revalidateIntegrationHealth
}));

import {
  activateProjectAction,
  deactivateUserAction,
  deactivateProjectAction,
  demoteUserAction,
  inviteUserAction,
  promoteUserAction,
  reactivateUserAction,
  updateProjectAiKnowledgeAction,
  updateProjectEmailsAction
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

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly isActive: boolean;
    readonly aiKnowledgeUrl: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
    readonly emails: readonly string[];
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

describe("settings project actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
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

  it("returns forbidden for activateProjectAction when the user is not an admin", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await activateProjectAction("project:inactive");

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden"
    });
  });

  it("returns not_found for activateProjectAction when the project is missing", async () => {
    const result = await activateProjectAction("project:missing");

    expect(result).toMatchObject({
      ok: false,
      code: "not_found"
    });
  });

  it("returns already_active for activateProjectAction when the project is already active", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:active",
      projectName: "Active Project",
      isActive: true,
      aiKnowledgeUrl: "https://docs.example.org/active",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["active@asc.internal"]
    });

    const result = await activateProjectAction("project:active");

    expect(result).toMatchObject({
      ok: false,
      code: "already_active"
    });
  });

  it("returns a requirements error when activateProjectAction is missing emails", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:no-emails",
      projectName: "No Emails",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/no-emails",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: []
    });

    const result = await activateProjectAction("project:no-emails");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      fieldErrors: {
        emails: "Add at least one project inbox alias to activate this project."
      }
    });
  });

  it("returns a requirements error when activateProjectAction is missing AI knowledge sync", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:no-url",
      projectName: "No URL",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/no-url",
      emails: ["ready@asc.internal"]
    });

    const result = await activateProjectAction("project:no-url");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      fieldErrors: {
        aiKnowledgeUrl: "Sync AI knowledge before activating this project."
      }
    });
  });

  it("activates a ready project, records audit evidence, and revalidates the project settings route", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:ready",
      projectName: "Ready Project",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/ready",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["ready@asc.internal"]
    });

    const result = await activateProjectAction("project:ready");
    const updatedProject = await runtime.context.settings.projects.findById(
      "project:ready"
    );
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "project",
      entityId: "project:ready"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        projectId: "project:ready",
        isActive: true
      }
    });
    expect(updatedProject?.isActive).toBe(true);
    expect(audits.at(-1)).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.project.activated",
      entityType: "project",
      entityId: "project:ready",
      policyCode: "settings.admin_mutation"
    });
    expect(revalidateProjectSettings).toHaveBeenCalledWith("project:ready");
  });

  it("deactivates an active project", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:to-deactivate",
      projectName: "Deactivate Me",
      isActive: true,
      aiKnowledgeUrl: "https://docs.example.org/deactivate",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["deactivate@asc.internal"]
    });

    const result = await deactivateProjectAction("project:to-deactivate");
    const updatedProject = await runtime.context.settings.projects.findById(
      "project:to-deactivate"
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        projectId: "project:to-deactivate",
        isActive: false
      }
    });
    expect(updatedProject?.isActive).toBe(false);
  });

  it("returns already_inactive for deactivateProjectAction when the project is already inactive", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:inactive",
      projectName: "Already Inactive",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/inactive",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["inactive@asc.internal"]
    });

    const result = await deactivateProjectAction("project:inactive");

    expect(result).toMatchObject({
      ok: false,
      code: "already_inactive"
    });
  });

  it("updates project emails with one primary email", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:emails",
      projectName: "Email Project",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/emails",
      emails: ["first@asc.internal", "second@asc.internal"]
    });

    const result = await updateProjectEmailsAction("project:emails", [
      { address: "second@asc.internal", isPrimary: true },
      { address: "third@asc.internal", isPrimary: false }
    ]);

    expect(result).toMatchObject({
      ok: true,
      data: {
        emails: [
          { address: "second@asc.internal", isPrimary: true },
          { address: "third@asc.internal", isPrimary: false }
        ]
      }
    });
  });

  it("rejects project email updates with an invalid email address", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:invalid-email",
      projectName: "Invalid Email Project",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: []
    });

    const result = await updateProjectEmailsAction("project:invalid-email", [
      { address: "not-an-email", isPrimary: true }
    ]);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_email_format"
    });
  });

  it("rejects project email updates with zero primary emails", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:no-primary",
      projectName: "No Primary",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: []
    });

    const result = await updateProjectEmailsAction("project:no-primary", [
      { address: "first@asc.internal", isPrimary: false },
      { address: "second@asc.internal", isPrimary: false }
    ]);

    expect(result).toMatchObject({
      ok: false,
      code: "primary_email_required"
    });
  });

  it("rejects project email updates with multiple primary emails", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:multi-primary",
      projectName: "Multi Primary",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: []
    });

    const result = await updateProjectEmailsAction("project:multi-primary", [
      { address: "first@asc.internal", isPrimary: true },
      { address: "second@asc.internal", isPrimary: true }
    ]);

    expect(result).toMatchObject({
      ok: false,
      code: "multiple_primary_emails"
    });
  });

  it("updates the AI knowledge URL with a valid https URL", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:knowledge",
      projectName: "Knowledge Project",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: ["knowledge@asc.internal"]
    });

    const result = await updateProjectAiKnowledgeAction(
      "project:knowledge",
      "https://docs.example.org/knowledge"
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        aiKnowledgeUrl: "https://docs.example.org/knowledge"
      }
    });
  });

  it("rejects invalid AI knowledge URLs", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:invalid-url",
      projectName: "Invalid URL Project",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: []
    });

    const result = await updateProjectAiKnowledgeAction(
      "project:invalid-url",
      "http://docs.example.org/not-https"
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_url"
    });
  });

  it("clears the AI knowledge URL when null is submitted", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:clear-url",
      projectName: "Clear URL Project",
      isActive: false,
      aiKnowledgeUrl: "https://docs.example.org/existing",
      emails: []
    });

    const result = await updateProjectAiKnowledgeAction(
      "project:clear-url",
      null
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        aiKnowledgeUrl: null
      }
    });
  });

  it("invites a teammate as a pending operator and revalidates access settings", async () => {
    const formData = new FormData();
    formData.set("email", "operator@adventurescientists.org");
    formData.set("role", "internal_user");

    const result = await inviteUserAction(formData);
    if (!runtime) throw new Error("runtime not initialized");

    expect(result).toMatchObject({
      ok: true,
      data: {
        user: {
          email: "operator@adventurescientists.org",
          role: "internal_user",
          status: "pending"
        }
      }
    });
    expect(revalidateAccessSettings).toHaveBeenCalled();

    const savedUser = await runtime.context.settings.users.findByEmail(
      "operator@adventurescientists.org"
    );
    expect(savedUser).toMatchObject({
      role: "operator",
      emailVerified: null,
      deactivatedAt: null
    });
  });

  it("promotes, demotes, deactivates, and reactivates teammates with audit-safe mutations", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedUser(runtime, {
      id: "user:operator",
      email: "operator@adventurescientists.org",
      role: "operator"
    });
    await seedUser(runtime, {
      id: "user:second-admin",
      email: "second.admin@adventurescientists.org",
      role: "admin"
    });

    const promoteFormData = new FormData();
    promoteFormData.set("id", "user:operator");
    const promoted = await promoteUserAction(promoteFormData);

    expect(promoted).toMatchObject({
      ok: true,
      data: {
        user: {
          userId: "user:operator",
          role: "admin",
          status: "active"
        }
      }
    });

    const demoteFormData = new FormData();
    demoteFormData.set("id", "user:second-admin");
    const demoted = await demoteUserAction(demoteFormData);

    expect(demoted).toMatchObject({
      ok: true,
      data: {
        user: {
          userId: "user:second-admin",
          role: "internal_user"
        }
      }
    });

    const deactivateFormData = new FormData();
    deactivateFormData.set("id", "user:operator");
    const deactivated = await deactivateUserAction(deactivateFormData);

    expect(deactivated).toMatchObject({
      ok: true,
      data: {
        user: {
          userId: "user:operator",
          status: "deactivated"
        }
      }
    });

    const reactivateFormData = new FormData();
    reactivateFormData.set("id", "user:operator");
    const reactivated = await reactivateUserAction(reactivateFormData);

    expect(reactivated).toMatchObject({
      ok: true,
      data: {
        user: {
          userId: "user:operator",
          status: "active"
        }
      }
    });
  });

  it("blocks admins from changing their own access from settings", async () => {
    const formData = new FormData();
    formData.set("id", "user:admin");

    const result = await deactivateUserAction(formData);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_operation"
    });
  });

  it("rejects inviting a teammate outside the workspace domain", async () => {
    const formData = new FormData();
    formData.set("email", "external@example.org");

    const result = await inviteUserAction(formData);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_email_domain"
    });
  });
});
