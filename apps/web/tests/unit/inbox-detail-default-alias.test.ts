import { describe, expect, it } from "vitest";

import { resolveProjectAliasOverride } from "../../app/inbox/_lib/composer-ui";

describe("resolveProjectAliasOverride", () => {
  it("falls through to the host project alias for connected subs", () => {
    expect(
      resolveProjectAliasOverride({
        projectIds: ["sub:beech", "host:forests", null],
        aliases: [
          {
            id: "alias-1",
            alias: "forests@adventurescientists.org",
            projectId: "host:forests",
            projectName: "Beech & Butternut",
            signature: "Best,\nForests",
            isAiReady: true,
            isAiConfigured: true,
            hasCachedContent: true,
          },
        ],
      }),
    ).toBe("forests@adventurescientists.org");
  });

  it("returns null when none of the candidate projects own an alias", () => {
    expect(
      resolveProjectAliasOverride({
        projectIds: ["sub:beech", "host:forests"],
        aliases: [],
      }),
    ).toBeNull();
  });
});
