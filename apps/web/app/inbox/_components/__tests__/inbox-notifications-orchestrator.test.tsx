import { createRequire } from "node:module";
import React, { act } from "react";

Object.assign(globalThis, { React });

import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { InboxNotificationsOrchestrator } from "../inbox-notifications-orchestrator";

const workerRequire = createRequire(
  new URL("../../../../../../worker/package.json", import.meta.url),
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
  readonly rerender: (unreadCount: number) => Promise<void>;
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
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: window.Event,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function mountOrchestrator(unreadCount: number): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);
  setVisibilityState("visible");

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);

  const render = (nextUnreadCount: number) => {
    root.render(
      <InboxNotificationsOrchestrator unreadCount={nextUnreadCount} />,
    );
  };

  await act(async () => {
    render(unreadCount);
    await Promise.resolve();
  });

  return {
    rerender: async (nextUnreadCount) => {
      await act(async () => {
        render(nextUnreadCount);
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
  if (activeSession !== null) {
    await activeSession.cleanup();
    activeSession = null;
  }
});

describe("InboxNotificationsOrchestrator", () => {
  it("prefixes the hidden-tab title with the unread count", async () => {
    activeSession = await mountOrchestrator(0);

    expect(document.title).toBe("AS Comms Platform");

    setVisibilityState("hidden");
    await activeSession.rerender(3);

    expect(document.title).toBe("(3) AS Comms Platform");
  });

  it("restores the baseline title when the tab becomes visible again", async () => {
    activeSession = await mountOrchestrator(2);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("(2) AS Comms Platform");

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(document.title).toBe("AS Comms Platform");
  });

  it("restores the baseline title when unread count returns to zero", async () => {
    activeSession = await mountOrchestrator(4);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("(4) AS Comms Platform");

    await activeSession.rerender(0);

    expect(document.title).toBe("AS Comms Platform");
  });
});
