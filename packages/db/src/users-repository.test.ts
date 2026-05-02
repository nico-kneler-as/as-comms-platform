import { afterEach, describe, expect, it } from "vitest";

import type { UserRecord } from "@as-comms/domain";

import { createTestStage1Context } from "./test-helpers.js";

function buildUserRecord(
  overrides: Partial<UserRecord> = {},
): UserRecord {
  const now = new Date("2026-05-01T12:00:00.000Z");

  return {
    id: "user-1",
    name: null,
    email: "nico@adventurescientists.org",
    emailVerified: null,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("users repository updateName", () => {
  const contexts: Awaited<ReturnType<typeof createTestStage1Context>>[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("updates the stored name and bumps updatedAt", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    const created = await context.settings.users.upsert(buildUserRecord());
    const originalUpdatedAt = created.updatedAt;

    const renamed = await context.settings.users.updateName(
      created.id,
      "Nicolas Kneler",
    );

    expect(renamed.name).toBe("Nicolas Kneler");
    expect(renamed.updatedAt.getTime()).toBeGreaterThan(
      originalUpdatedAt.getTime(),
    );

    const overwritten = await context.settings.users.updateName(
      created.id,
      "Nicolas K.",
    );

    expect(overwritten.name).toBe("Nicolas K.");
    expect(overwritten.updatedAt.getTime()).toBeGreaterThan(
      renamed.updatedAt.getTime(),
    );
  });
});
