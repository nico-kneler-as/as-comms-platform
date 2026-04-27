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

import { activateProjectFromWizardAction } from "../../app/settings/actions";
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

async function seedProject(runtime: Stage1WebTestRuntime, url: string | null) {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project:wizard",
    projectName: "PNW Biodiversity",
    projectAlias: null,
    source: "salesforce",
    isActive: false,
    aiKnowledgeUrl: url,
    aiKnowledgeSyncedAt: null,
  });
}

async function seedAdminUser(runtime: Stage1WebTestRuntime): Promise<void> {
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
    updatedAt: now,
  });
}

describe("activateProjectFromWizardAction", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
    await seedAdminUser(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("activates without requiring a bootstrap run id", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(
      runtime,
      "https://www.notion.so/workspace/pnw-page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    const result = await activateProjectFromWizardAction({
      projectId: "project:wizard",
      projectAlias: "PNW",
      aliases: [
        {
          address: "pnw@adventurescientists.org",
          isPrimary: true,
        },
      ],
      signature: "Warmly,\nPNW Team",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        projectId: "project:wizard",
        isActive: true,
      },
    });
  });

  it("still blocks activation when the project has no Notion URL", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await seedProject(runtime, null);

    const result = await activateProjectFromWizardAction({
      projectId: "project:wizard",
      projectAlias: "PNW",
      aliases: [
        {
          address: "pnw@adventurescientists.org",
          isPrimary: true,
        },
      ],
      signature: "Warmly,\nPNW Team",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "requirements_not_met",
    });
  });
});
