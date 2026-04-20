import { describe, expect, it } from "vitest";

import { resolveAutoLoadInboxCursor } from "../../app/inbox/_components/inbox-list-pagination";

describe("resolveAutoLoadInboxCursor", () => {
  it("returns the next cursor when the sentinel intersects and a page is available", () => {
    expect(
      resolveAutoLoadInboxCursor({
        isIntersecting: true,
        hasMore: true,
        nextCursor: "cursor-2",
        isQueueLoading: false,
        isFilterTransitionPending: false,
        pendingCursor: null,
      }),
    ).toBe("cursor-2");
  });

  it("does not trigger while a page is already loading", () => {
    expect(
      resolveAutoLoadInboxCursor({
        isIntersecting: true,
        hasMore: true,
        nextCursor: "cursor-2",
        isQueueLoading: true,
        isFilterTransitionPending: false,
        pendingCursor: "cursor-2",
      }),
    ).toBeNull();
  });

  it("stops triggering once the list reaches the final page", () => {
    expect(
      resolveAutoLoadInboxCursor({
        isIntersecting: true,
        hasMore: false,
        nextCursor: null,
        isQueueLoading: false,
        isFilterTransitionPending: false,
        pendingCursor: null,
      }),
    ).toBeNull();
  });
});
