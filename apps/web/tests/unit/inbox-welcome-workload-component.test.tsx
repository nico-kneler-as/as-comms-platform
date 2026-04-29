import { createRequire } from "node:module";
import React, { act, createElement } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxWelcomeWorkloadViewModel } from "../../app/inbox/_lib/view-models";

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("../../app/inbox/_components/icons", () => ({
  ArrowUpRightIcon: iconMock("ArrowUpRightIcon"),
  QuoteIcon: iconMock("QuoteIcon"),
  RefreshCwIcon: iconMock("RefreshCwIcon"),
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: ({
    initials,
  }: {
    readonly initials: string;
  }) => createElement("span", null, initials),
}));

import { InboxWelcomeWorkload } from "../../app/inbox/_components/inbox-welcome-workload";

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
  readonly container: HTMLElement;
  readonly root: Root;
  readonly cleanup: () => void;
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
  Object.defineProperty(globalThis, "MouseEvent", {
    configurable: true,
    value: window.MouseEvent,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      return window.setTimeout(callback, 16);
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => {
      window.clearTimeout(id);
    },
  });
}

function renderComponent(workload: InboxWelcomeWorkloadViewModel): RenderSession {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InboxWelcomeWorkload workload={workload} firstName="Nicolas" />,
    );
  });

  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      dom.window.close();
    },
  };
}

function buildWorkload(
  totalCount: number,
): InboxWelcomeWorkloadViewModel {
  const entries =
    totalCount === 0
      ? []
      : [
          {
            contactId: "contact:alpha",
            displayName: "Alpha Rowan",
            initials: "AR",
            avatarTone: "indigo" as const,
            projectLabel: "Amazon Basin Research",
            latestSubject: "Inbound email received",
            lastActivityLabel: "3d ago",
          },
          {
            contactId: "contact:bravo",
            displayName: "Bravo Stone",
            initials: "BS",
            avatarTone: "emerald" as const,
            projectLabel: "Tracking Whitebark Pine",
            latestSubject: "Outbound email sent",
            lastActivityLabel: "2d ago",
          },
          {
            contactId: "contact:charlie",
            displayName: "Charlie Vale",
            initials: "CV",
            avatarTone: "amber" as const,
            projectLabel: null,
            latestSubject: "Inbound SMS received",
            lastActivityLabel: "yesterday",
          },
        ].slice(0, Math.min(totalCount, 3));

  return {
    projects: [],
    totals: {
      activeProjects: 0,
      unread: 0,
      needsFollowUp: totalCount,
    },
    followUpRail: {
      totalCount,
      entries,
    },
  };
}

afterEach(() => {
  routerPushMock.mockReset();

  if (activeSession !== null) {
    activeSession.cleanup();
    activeSession = null;
  }
});

describe("InboxWelcomeWorkload follow-up rail", () => {
  it("renders follow-up rows with conversation aria labels", () => {
    activeSession = renderComponent(buildWorkload(3));

    const buttons = Array.from(
      activeSession.container.querySelectorAll("button[aria-label]"),
    ).map((element) => element.getAttribute("aria-label"));

    expect(
      activeSession.container.textContent.includes(
        "🚩 These need follow-up · 3",
      ),
    ).toBe(true);
    expect(buttons).toEqual([
      "Open conversation with Alpha Rowan",
      "Open conversation with Bravo Stone",
      "Open conversation with Charlie Vale",
    ]);
  });

  it("hides the follow-up rail entirely when the total count is zero", () => {
    activeSession = renderComponent(buildWorkload(0));

    expect(activeSession.container.textContent).not.toContain(
      "These need follow-up",
    );
    expect(activeSession.container.textContent).not.toContain("View all");
  });

  it("routes View all clicks to the follow-up inbox filter", () => {
    activeSession = renderComponent(buildWorkload(3));

    const viewAllButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("View all"));

    expect(viewAllButton).toBeTruthy();

    if (viewAllButton === undefined) {
      throw new Error("Expected View all button");
    }

    act(() => {
      viewAllButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(routerPushMock).toHaveBeenCalledWith("/inbox?filter=follow-up");
  });
});
