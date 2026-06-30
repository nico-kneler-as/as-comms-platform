import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const routerRefreshMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

Object.assign(globalThis, { fetch: fetchMock });

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: React.ReactNode;
    readonly href: string;
    readonly [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
}));

import {
  BroadcastMediaLibrary,
  type BroadcastMediaLibraryAsset,
} from "../../app/broadcasts/media/_components/broadcast-media-library";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    },
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

let root: Root | null = null;
let domWindow: (Window & typeof globalThis & { close: () => void }) | null =
  null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts/media",
    pretendToBeVisual: true,
  });

  domWindow = dom.window;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteTextMock,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.File = dom.window.File;
  globalThis.FormData = dom.window.FormData;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  return container;
}

function renderLibrary(
  container: HTMLElement,
  props: {
    readonly assets: readonly BroadcastMediaLibraryAsset[];
    readonly nextCursor?: string | null;
  },
) {
  act(() => {
    root?.render(
      <BroadcastMediaLibrary
        initialAssets={props.assets}
        initialNextCursor={props.nextCursor ?? null}
        emptyStateIcon={<svg aria-hidden="true" />}
      />,
    );
  });

  return container;
}

function makeAsset(overrides: Partial<BroadcastMediaLibraryAsset> = {}) {
  return {
    id: "0d34633d-aee7-4f17-8c3f-6e5551f58a11",
    url: "https://cdn.example.org/images/hero.png",
    filename: "hero.png",
    contentType: "image/png",
    sizeBytes: 1024,
    createdAt: "2026-06-27T18:00:00.000Z",
    ...overrides,
  } satisfies BroadcastMediaLibraryAsset;
}

beforeEach(() => {
  routerRefreshMock.mockReset();
  routerPushMock.mockReset();
  routerReplaceMock.mockReset();
  clipboardWriteTextMock.mockReset();
  fetchMock.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  domWindow?.close();
  domWindow = null;
});

describe("broadcast media library", () => {
  it("renders the empty state and uploaded assets", () => {
    const emptyContainer = setupDom();
    renderLibrary(emptyContainer, { assets: [] });
    expect(emptyContainer.textContent).toContain("No images yet");
    expect(emptyContainer.textContent).toContain("Upload one to get started.");

    act(() => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    root = null;
    domWindow?.close();

    const assetsContainer = setupDom();
    renderLibrary(assetsContainer, {
      assets: [
        makeAsset(),
        makeAsset({
          id: "2b8beef8-c630-4f2b-97eb-770dc4e5aa89",
          url: "https://cdn.example.org/images/secondary.webp",
          filename: "secondary.webp",
          contentType: "image/webp",
          sizeBytes: 24576,
        }),
      ],
    });

    expect(assetsContainer.textContent).toContain("hero.png");
    expect(assetsContainer.textContent).toContain("secondary.webp");
    expect(assetsContainer.textContent).toContain("Copy URL");
  });

  it("copies the asset url", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);

    const container = setupDom();
    renderLibrary(container, { assets: [makeAsset()] });

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.includes("Copy URL"),
    );

    expect(copyButton).toBeTruthy();
    if (!copyButton || !domWindow) {
      throw new Error("Expected copy button and JSDOM window.");
    }
    const activeWindow = domWindow;

    await act(async () => {
      copyButton.dispatchEvent(
        new activeWindow.MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledTimes(1);
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "https://cdn.example.org/images/hero.png",
    );
    expect(container.textContent).toContain("URL copied.");
  });

  it("loads more assets and hides the button when pagination is exhausted", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              id: "ad85c64b-bd72-4fd0-8d07-e9f869f594a1",
              url: "https://cdn.example.org/images/third.webp",
              filename: "third.webp",
              contentType: "image/webp",
              sizeBytes: 4096,
              createdAt: "2026-06-27T19:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
    });

    const container = setupDom();
    renderLibrary(container, {
      assets: [makeAsset()],
      nextCursor: "cursor:page-2",
    });

    const loadMoreButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent.includes("Load more"));

    expect(loadMoreButton).toBeTruthy();
    if (!loadMoreButton || !domWindow) {
      throw new Error("Expected load more button and JSDOM window.");
    }
    const activeWindow = domWindow;

    await act(async () => {
      loadMoreButton.dispatchEvent(
        new activeWindow.MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/broadcasts/images?cursor=cursor%3Apage-2&limit=100",
    );
    expect(container.textContent).toContain("hero.png");
    expect(container.textContent).toContain("third.webp");
    expect(container.textContent).not.toContain("Load more");
  });
});
