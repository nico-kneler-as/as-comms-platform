import { describe, expect, it } from "vitest";

import { shouldApplyUrlSearchQuery } from "../../app/inbox/_lib/search-sync";

describe("inbox search sync", () => {
  it("does not re-apply the same stale URL query while the operator is typing", () => {
    expect(
      shouldApplyUrlSearchQuery({
        urlQuery: "",
        previousUrlQuery: "",
      }),
    ).toBe(false);
  });

  it("applies external URL query changes", () => {
    expect(
      shouldApplyUrlSearchQuery({
        urlQuery: "alex",
        previousUrlQuery: "",
      }),
    ).toBe(true);
  });
});
