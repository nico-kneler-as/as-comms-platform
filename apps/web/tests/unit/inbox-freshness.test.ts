import { describe, expect, it } from "vitest";

import {
  detailFreshnessChanged,
  listFreshnessChanged
} from "../../app/inbox/_components/inbox-freshness-poller";

describe("inbox freshness polling helpers", () => {
  it("detects list freshness drift after missed invalidation", () => {
    expect(
      listFreshnessChanged(
        {
          latestUpdatedAt: "2026-04-14T10:00:00.000Z",
          total: 12
        },
        {
          latestUpdatedAt: "2026-04-14T10:05:00.000Z",
          total: 12
        }
      )
    ).toBe(true);
  });

  it("detects detail freshness drift when timeline rows change under an open view", () => {
    expect(
      detailFreshnessChanged(
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineCount: 4
        },
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:03:00.000Z",
          timelineCount: 5
        }
      )
    ).toBe(true);
  });

  it("detects when an open detail view disappears after a rebuild", () => {
    expect(
      detailFreshnessChanged(
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineCount: 4
        },
        null
      )
    ).toBe(true);
  });
});
