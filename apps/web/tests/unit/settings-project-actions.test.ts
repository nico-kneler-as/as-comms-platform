import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateProjectSettings,
  revalidateIntegrationHealth
}));

import {
  activateProjectAction,
  deactivateProjectAction,
  inviteUserAction,
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
    readonly emails: readonly string[];
  }
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    source: "salesforce",
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: null
  });

  for (const [index, email] of input.emails.entries()) {
    await runtime.context.settings.aliases.create({
      id: `${input.projectId}:alias:${String(index)}`,
      alias: email,
      projectId: input.projectId,
      createdAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      updatedAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      createdBy: null,
      updatedBy: null
    });
  }
}

describe("settings project actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
    const now = new Date("2026-04-20T15:00:00.000Z");
    await runtime.context.settings.users.upsert({
      id: "user:admin",
      name: "admin",
      email: "admin@adventurescientists.org",
      emailVerified: now,
      image: null,
      role: "admin",
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now
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
      emails: []
    });

    const result = await activateProjectAction("project:no-emails");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      fieldErrors: {
        emails: "Add at least one email to activate this project."
      }
    });
  });

  it("returns a requirements error when activateProjectAction is missing the AI knowledge URL", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, {
      projectId: "project:no-url",
      projectName: "No URL",
      isActive: false,
      aiKnowledgeUrl: null,
      emails: ["ready@asc.internal"]
    });

    const result = await activateProjectAction("project:no-url");

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
      fieldErrors: {
        aiKnowledgeUrl: "Add an AI knowledge URL to activate this project."
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

  it("keeps user invite actions stubbed behind a not_implemented envelope", async () => {
    const formData = new FormData();
    formData.set("email", "operator@asc.internal");
    formData.set("role", "internal_user");

    const result = await inviteUserAction(formData);

    expect(result).toMatchObject({
      ok: false,
      code: "not_implemented"
    });
  });
});
