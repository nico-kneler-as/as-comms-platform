import { describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn(),
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

import { markInboxNeedsFollowUpAction } from "../../app/inbox/actions";

describe("follow-up action validation", () => {
  it("returns a validation error when contactId is missing", async () => {
    requireSession.mockResolvedValueOnce({
      id: "user:nico",
      name: "Nico",
      email: "nico@adventurescientists.org",
      emailVerified: new Date("2026-04-14T10:00:00.000Z"),
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: new Date("2026-04-14T10:00:00.000Z"),
      updatedAt: new Date("2026-04-14T10:00:00.000Z"),
    });

    const formData = new FormData();

    await expect(markInboxNeedsFollowUpAction(formData)).resolves.toMatchObject(
      {
        ok: false,
        code: "validation_error",
      },
    );
  });
});
