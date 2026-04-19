import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());

Object.assign(globalThis, { React });

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin,
}));

import UsersPage from "../../app/settings/users/page";
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
    requireAdmin.mockReset();
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

    requireAdmin.mockResolvedValue(admin);
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("records who opened the users-and-roles settings page", async () => {
    const page = await UsersPage();
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
    expect(latestAudit?.metadataJson).toMatchObject({
      visibleUserCount: 2,
    });
  });
});
