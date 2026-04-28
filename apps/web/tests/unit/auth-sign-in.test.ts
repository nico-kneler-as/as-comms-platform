import { describe, expect, it } from "vitest";

import { canSignInWithGoogle } from "../../src/server/auth/google-sign-in-policy";

function buildUserRecord(input?: { readonly deactivatedAt?: Date | null }) {
  return {
    deactivatedAt: input?.deactivatedAt ?? null
  };
}

describe("Google sign-in policy", () => {
  it("returns false when no user record exists for the Google email", () => {
    expect(
      canSignInWithGoogle({
        email: "operator@adventurescientists.org",
        userRecord: null
      })
    ).toBe(false);
  });

  it("returns false when the user record exists but is deactivated", () => {
    expect(
      canSignInWithGoogle({
        email: "operator@adventurescientists.org",
        userRecord: buildUserRecord({
          deactivatedAt: new Date("2026-04-28T12:00:00.000Z")
        })
      })
    ).toBe(false);
  });

  it("returns true when an active user record exists with an AS Workspace email", () => {
    expect(
      canSignInWithGoogle({
        email: "operator@adventurescientists.org",
        userRecord: buildUserRecord()
      })
    ).toBe(true);
  });

  it("returns false when an AS Workspace email is not pre-seeded", () => {
    expect(
      canSignInWithGoogle({
        email: "new-hire@adventurescientists.org",
        userRecord: null
      })
    ).toBe(false);
  });

  it("returns false when a non-Workspace email exists in the users table", () => {
    expect(
      canSignInWithGoogle({
        email: "operator@example.com",
        userRecord: buildUserRecord()
      })
    ).toBe(false);
  });
});
