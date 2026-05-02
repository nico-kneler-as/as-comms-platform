import { describe, expect, it, vi } from "vitest";

import type { UserRecord } from "@as-comms/domain";

import {
  backfillUserNameOnSignIn,
  resolveBackfillProfileName,
} from "../../src/server/auth/name-backfill";

function buildUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
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

describe("resolveBackfillProfileName", () => {
  it("prefers a trimmed profile name over the user name", () => {
    expect(
      resolveBackfillProfileName({
        profileName: "  Nicolas Kneler  ",
        userName: "Ignored Fallback",
      }),
    ).toBe("Nicolas Kneler");
  });

  it("falls back to a trimmed user name when the profile name is blank", () => {
    expect(
      resolveBackfillProfileName({
        profileName: "   ",
        userName: "  Nicolas K.  ",
      }),
    ).toBe("Nicolas K.");
  });
});

describe("backfillUserNameOnSignIn", () => {
  it("updates a pre-seeded user when the record name is null and the profile has a name", async () => {
    const updateName = vi.fn().mockResolvedValue(buildUserRecord({ name: "Nicolas Kneler" }));

    await backfillUserNameOnSignIn({
      record: buildUserRecord(),
      profileName: "Nicolas Kneler",
      userName: null,
      usersRepository: { updateName },
    });

    expect(updateName).toHaveBeenCalledTimes(1);
    expect(updateName).toHaveBeenCalledWith("user-1", "Nicolas Kneler");
  });

  it("does not overwrite an existing non-empty name", async () => {
    const updateName = vi.fn();

    await backfillUserNameOnSignIn({
      record: buildUserRecord({ name: "Nicolas Kneler" }),
      profileName: "Nicolas K.",
      userName: null,
      usersRepository: { updateName },
    });

    expect(updateName).not.toHaveBeenCalled();
  });

  it("does not update when no user record exists", async () => {
    const updateName = vi.fn();

    await backfillUserNameOnSignIn({
      record: null,
      profileName: "Nicolas Kneler",
      userName: null,
      usersRepository: { updateName },
    });

    expect(updateName).not.toHaveBeenCalled();
  });

  it("does not update when the profile and user names are empty", async () => {
    const updateName = vi.fn();

    await backfillUserNameOnSignIn({
      record: buildUserRecord(),
      profileName: "   ",
      userName: "\t",
      usersRepository: { updateName },
    });

    expect(updateName).not.toHaveBeenCalled();
  });

  it("swallows update failures and logs a warning", async () => {
    const cause = new Error("boom");
    const updateName = vi.fn().mockRejectedValue(cause);
    const logWarn = vi.fn();

    await expect(
      backfillUserNameOnSignIn({
        record: buildUserRecord(),
        profileName: "Nicolas Kneler",
        userName: null,
        usersRepository: { updateName },
        logWarn,
      }),
    ).resolves.toBeUndefined();

    expect(updateName).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith("auth.signIn name backfill failed", {
      userId: "user-1",
      cause,
    });
  });
});
