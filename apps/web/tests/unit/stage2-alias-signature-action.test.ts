import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateProjectSettings,
  revalidateIntegrationHealth: vi.fn()
}));

import { updateProjectAliasSignatureAction } from "../../app/settings/actions";
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

async function seedAlias(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly aliasId: string;
    readonly alias: string;
    readonly signature?: string;
  }
): Promise<void> {
  const now = new Date("2026-04-21T12:00:00.000Z");
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: "Signature Project",
    source: "salesforce"
  });
  await runtime.context.settings.aliases.create({
    id: input.aliasId,
    alias: input.alias,
    signature: input.signature ?? "",
    projectId: input.projectId,
    createdAt: now,
    updatedAt: now,
    createdBy: "user:admin",
    updatedBy: "user:admin"
  });
}

describe("stage2 alias signature action", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateProjectSettings.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());

    runtime = await createStage1WebTestRuntime();
    const now = new Date("2026-04-21T12:00:00.000Z");
    await runtime.context.settings.users.upsert({
      id: "user:admin",
      name: "Admin",
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

  it("returns forbidden for non-admin callers", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await updateProjectAliasSignatureAction(
      "alias:signature",
      "Thanks"
    );

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden"
    });
  });

  it("rejects signatures longer than 2000 characters", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedAlias(runtime, {
      projectId: "project:signature",
      aliasId: "alias:signature",
      alias: "signature@asc.internal"
    });

    const result = await updateProjectAliasSignatureAction(
      "alias:signature",
      "a".repeat(2001)
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_signature",
      fieldErrors: {
        signature: "Signature must be 2000 characters or fewer."
      }
    });
  });

  it("rejects HTML tags in signatures", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedAlias(runtime, {
      projectId: "project:signature",
      aliasId: "alias:signature",
      alias: "signature@asc.internal"
    });

    const result = await updateProjectAliasSignatureAction(
      "alias:signature",
      "Thanks,<br />Adventure Scientists"
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_signature",
      fieldErrors: {
        signature: "Signature must be plain text only."
      }
    });
  });

  it("updates the signature, writes an audit row, and revalidates the project detail", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedAlias(runtime, {
      projectId: "project:signature",
      aliasId: "alias:signature",
      alias: "signature@asc.internal"
    });

    const result = await updateProjectAliasSignatureAction(
      "alias:signature",
      "Thanks,\nAdventure Scientists   "
    );
    const updatedAlias = await runtime.context.settings.aliases.findById(
      "alias:signature"
    );
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "project_alias",
      entityId: "alias:signature"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "alias:signature",
        alias: "signature@asc.internal",
        signature: "Thanks,\nAdventure Scientists"
      }
    });
    expect(updatedAlias?.signature).toBe("Thanks,\nAdventure Scientists");
    expect(audits.at(-1)).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.project.alias_signature_updated",
      entityType: "project_alias",
      entityId: "alias:signature",
      policyCode: "settings.admin_mutation",
      metadataJson: {
        alias: "signature@asc.internal",
        projectId: "project:signature",
        before: "",
        after: "Thanks,\nAdventure Scientists"
      }
    });
    expect(revalidateProjectSettings).toHaveBeenCalledWith("project:signature");
  });
});
