import { createRequire } from "node:module";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const fetchInboxFreshnessMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("../../app/inbox/_lib/client-api", () => ({
  fetchInboxFreshness: fetchInboxFreshnessMock,
}));

import {
  InboxFreshnessPoller,
  detailFreshnessChanged,
  listFreshnessChanged,
} from "../../app/inbox/_components/inbox-freshness-poller";

const workerRequire = createRequire(
  new URL("../../../worker/package.json", import.meta.url),
);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html: string,
    options: { readonly url: string },
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

interface RenderSession {
  readonly root: Root;
  readonly rerender: (input: {
    readonly latestUpdatedAt: string;
    readonly total: number;
  }) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

function setDomGlobals(window: Window & typeof globalThis) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: window.HTMLElement,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: window.Node,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function mountPoller(input: {
  readonly latestUpdatedAt: string;
  readonly total: number;
}): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderPoller = (next: {
    readonly latestUpdatedAt: string;
    readonly total: number;
  }) => {
    root.render(
      createElement(InboxFreshnessPoller, {
        listFreshness: next,
        intervalMs: 10,
      }),
    );
  };

  await act(async () => {
    renderPoller(input);
    await Promise.resolve();
  });

  return {
    root,
    rerender: async (next) => {
      await act(async () => {
        renderPoller(next);
        await Promise.resolve();
      });
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      dom.window.close();
    },
  };
}

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
  vi.useRealTimers();
  fetchInboxFreshnessMock.mockReset();
  routerRefreshMock.mockReset();
});

describe("inbox freshness polling helpers", () => {
  it("detects list freshness drift after missed invalidation", () => {
    expect(
      listFreshnessChanged(
        {
          latestUpdatedAt: "2026-04-14T10:00:00.000Z",
          total: 12,
        },
        {
          latestUpdatedAt: "2026-04-14T10:05:00.000Z",
          total: 12,
        },
      ),
    ).toBe(true);
  });

  it("detects detail freshness drift when timeline rows change under an open view", () => {
    expect(
      detailFreshnessChanged(
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineCount: 4,
        },
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:03:00.000Z",
          timelineCount: 5,
        },
      ),
    ).toBe(true);
  });

  it("detects when an open detail view disappears after a rebuild", () => {
    expect(
      detailFreshnessChanged(
        {
          inboxUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineUpdatedAt: "2026-04-14T10:00:00.000Z",
          timelineCount: 4,
        },
        null,
      ),
    ).toBe(true);
  });

  it("dedupes overlapping polls and waits for refreshed props before polling again", async () => {
    vi.useFakeTimers();

    const pendingFreshness = createDeferred<{
      readonly list: {
        readonly latestUpdatedAt: string;
        readonly total: number;
      };
      readonly detail: null;
    }>();

    fetchInboxFreshnessMock.mockReturnValueOnce(pendingFreshness.promise);

    activeSession = await mountPoller({
      latestUpdatedAt: "2026-04-14T10:00:00.000Z",
      total: 1,
    });

    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    expect(fetchInboxFreshnessMock).toHaveBeenCalledTimes(1);

    pendingFreshness.resolve({
      list: {
        latestUpdatedAt: "2026-04-14T10:05:00.000Z",
        total: 1,
      },
      detail: null,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(routerRefreshMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30);
      await Promise.resolve();
    });

    expect(fetchInboxFreshnessMock).toHaveBeenCalledTimes(1);

    fetchInboxFreshnessMock.mockResolvedValueOnce({
      list: {
        latestUpdatedAt: "2026-04-14T10:05:00.000Z",
        total: 1,
      },
      detail: null,
    });

    await activeSession.rerender({
      latestUpdatedAt: "2026-04-14T10:05:00.000Z",
      total: 1,
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });

    expect(fetchInboxFreshnessMock).toHaveBeenCalledTimes(2);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});
