import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin,
  requireSession,
}));

import {
  getAudienceBuilderBootstrap,
  searchProjectVolunteersAction,
} from "../../app/broadcasts/_lib/audience-data-source";
import {
  createOrgSenderForTests,
  createStage1WebTestRuntime,
  setOrgSenderEnabledForTests,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:operator",
    email: "operator@example.org",
  };
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    projectAlias: input.projectName,
    connectedToProjectId: null,
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
    source: "manual",
  });

  await runtime.context.settings.aliases.create({
    id: `${input.projectId}:alias:0`,
    alias: input.email,
    signature: "",
    projectId: input.projectId,
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  });
  await runtime.context.settings.projects.setPostmarkSenderStatus(
    input.projectId,
    "verified",
  );
}

async function seedContact(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly contactId: string;
    readonly displayName: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
  });
}

describe("campaign audience data source", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    requireAdmin.mockReset();
    requireSession.mockReset();
    requireAdmin.mockResolvedValue(sessionUser());
    requireSession.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("includes enabled org senders alongside project aliases and excludes disabled org senders", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-1",
      projectName: "Beech Leaf Disease",
      email: "forests@example.org",
    });
    const enabledOrgSender = await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists",
    });
    const disabledOrgSender = await createOrgSenderForTests(runtime, {
      email: "disabled@adventurescientists.org",
      label: "Disabled sender",
    });
    await setOrgSenderEnabledForTests(runtime, disabledOrgSender.id, false);
    (
      runtime.runtime.connection as {
        sql: (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<readonly unknown[]>;
      }
    ).sql = vi.fn(() => Promise.resolve([]));

    const bootstrap = await getAudienceBuilderBootstrap();

    expect(bootstrap.senderOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "forests@example.org",
          projectId: "project-1",
          senderType: "project",
        }),
        expect.objectContaining({
          email: enabledOrgSender.email,
          projectId: null,
          senderType: "org",
        }),
      ]),
    );
    expect(
      bootstrap.senderOptions.some(
        (option) => option.email === "disabled@adventurescientists.org",
      ),
    ).toBe(false);
  });

  it("searches all contacts for org-sender specific audiences when no project scope is supplied", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedContact(runtime, {
      contactId: "contact-1",
      displayName: "Allie Example",
      email: "allie@example.org",
    });

    const result = await searchProjectVolunteersAction({
      aliasProjectIds: [],
      query: "allie",
    });

    expect(result).toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({
          contactId: "contact-1",
          email: "allie@example.org",
          project: null,
        }),
      ],
    });
  });
});
