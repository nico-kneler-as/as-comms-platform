import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn());

Object.assign(globalThis, { React });

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader
}));

vi.mock("next/navigation", () => ({
  redirect,
  notFound,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
  getCurrentUser,
}));

import SettingsAccessPage from "../../app/settings/access/page";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildUser(input: {
  readonly id: string;
  readonly email: string;
  readonly role: "admin" | "operator";
}): {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: Date;
  readonly image: null;
  readonly role: "admin" | "operator";
  readonly deactivatedAt: null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
} {
  const now = new Date("2026-04-14T10:00:00.000Z");
  return {
    id: input.id,
    name: input.email.split("@")[0] ?? input.email,
    email: input.email,
    emailVerified: now,
    image: null,
    role: input.role,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("settings users read audit", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    redirect.mockReset();
    notFound.mockReset();
    requireSession.mockReset();
    getCurrentUser.mockReset();
    runtime = await createStage1WebTestRuntime();

    const admin = buildUser({
      id: "user:admin",
      email: "admin@adventurescientists.org",
      role: "admin",
    });
    const operator = buildUser({
      id: "user:operator",
      email: "operator@adventurescientists.org",
      role: "operator",
    });

    await runtime.context.settings.users.upsert(admin);
    await runtime.context.settings.users.upsert(operator);

    // Session helpers return the admin; both `requireSession` and
    // `getCurrentUser` are called from the Access sub-route.
    requireSession.mockResolvedValue(admin);
    getCurrentUser.mockResolvedValue(admin);
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("records who opened the settings Access page", async () => {
    const page = await SettingsAccessPage();
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await waitForPendingSecurityAuditTasksForTests();

    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "settings_page",
        entityId: "users",
      });
    const latestAudit = audits.at(-1);

    expect(page).toBeTruthy();
    expect(latestAudit).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.users.read",
      result: "recorded",
      policyCode: "security.read_audit",
    });
    // visibleUserCount is sourced from the mock user list on the page,
    // which always includes at least the seeded teammates. We only assert
    // the field exists and is a positive integer — the exact count is a
    // UI-only detail that may evolve with the mock data.
    expect(latestAudit?.metadataJson).toBeDefined();
    const metadata = latestAudit?.metadataJson as {
      readonly visibleUserCount?: unknown;
    };
    expect(typeof metadata.visibleUserCount).toBe("number");
    expect(metadata.visibleUserCount).toBeGreaterThan(0);
  });

  it("redirects non-admin operators back to settings", async () => {
    const operator = buildUser({
      id: "user:operator",
      email: "operator@adventurescientists.org",
      role: "operator",
    });
    requireSession.mockResolvedValueOnce(operator);
    getCurrentUser.mockResolvedValueOnce(operator);
    redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT_SETTINGS");
    });

    await expect(SettingsAccessPage()).rejects.toThrow("NEXT_REDIRECT_SETTINGS");
    expect(redirect).toHaveBeenCalledWith("/settings");
  });
});
