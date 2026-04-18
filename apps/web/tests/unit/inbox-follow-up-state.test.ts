import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn()
}));

import { markInboxNeedsFollowUpAction } from "../../app/inbox/actions";

describe("follow-up action validation", () => {
  it("returns a validation error when contactId is missing", async () => {
    const formData = new FormData();

    await expect(
      markInboxNeedsFollowUpAction(formData)
    ).resolves.toMatchObject({
      ok: false,
      code: "validation_error"
    });
  });
});
