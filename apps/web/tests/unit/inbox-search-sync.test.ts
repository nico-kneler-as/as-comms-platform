import { describe, expect, it } from "vitest";

import { shouldApplyUrlSearchQuery } from "../../app/inbox/_lib/search-sync";

describe("inbox search sync", () => {
  it("does not re-apply the same stale URL query while the operator is typing", () => {
    expect(
      shouldApplyUrlSearchQuery({
        urlQuery: "",
        previousUrlQuery: "",
        currentQuery: "",
      }),
    ).toBe(false);
  });

  it("applies external URL query changes", () => {
    expect(
      shouldApplyUrlSearchQuery({
        urlQuery: "alex",
        previousUrlQuery: "",
        currentQuery: "",
      }),
    ).toBe(true);
  });

  it("does not apply stale delayed URL writes over newer local input", () => {
    expect(
      shouldApplyUrlSearchQuery({
        urlQuery: "d",
        previousUrlQuery: "",
        currentQuery: "darrel",
      }),
    ).toBe(false);
  });
});
