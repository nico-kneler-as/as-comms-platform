import { createRequire } from "node:module";
import React, { act, createElement } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxWelcomeSalesforceLifecycleData } from "../../app/inbox/_lib/home-dashboard";
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
  AlertTriangleIcon: iconMock("AlertTriangleIcon"),
  ArrowUpRightIcon: iconMock("ArrowUpRightIcon"),
  DatabaseIcon: iconMock("DatabaseIcon"),
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

function renderComponent(
  workload: InboxWelcomeWorkloadViewModel,
  salesforceLifecycle: InboxWelcomeSalesforceLifecycleData,
): RenderSession {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InboxWelcomeWorkload
        workload={workload}
        salesforceLifecycle={salesforceLifecycle}
        firstName="Nicolas"
      />,
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

function buildSalesforceLifecycle(
  overrides: Partial<InboxWelcomeSalesforceLifecycleData> = {},
): InboxWelcomeSalesforceLifecycleData {
  return {
    freshness: overrides.freshness ?? "fresh",
    lastSuccessAt:
      overrides.lastSuccessAt ?? new Date("2026-05-07T11:55:00.000Z"),
    tiles: overrides.tiles ?? [
      {
        projectId: "project:beta",
        projectName: "Beta Research",
        projectTone: "emerald",
        unreadCount: 0,
        totals: {
          signups: 2,
          trainingCompletions: 1,
          dataSubmissions: 0,
        },
        today: {
          signups: 1,
          trainingCompletions: 0,
          dataSubmissions: 0,
        },
        sparkline: {
          signups: [0, 0, 0, 0, 1, 0, 1],
          trainingCompletions: [0, 0, 0, 0, 0, 1, 0],
          dataSubmissions: [0, 0, 0, 0, 0, 0, 0],
        },
      },
      {
        projectId: "project:alpha",
        projectName: "Alpha Research",
        projectTone: "sky",
        unreadCount: 3,
        totals: {
          signups: 4,
          trainingCompletions: 2,
          dataSubmissions: 1,
        },
        today: {
          signups: 1,
          trainingCompletions: 1,
          dataSubmissions: 0,
        },
        sparkline: {
          signups: [0, 0, 1, 0, 1, 1, 1],
          trainingCompletions: [0, 0, 0, 0, 0, 1, 1],
          dataSubmissions: [0, 0, 0, 0, 0, 1, 0],
        },
      },
    ],
  };
}

afterEach(() => {
  routerPushMock.mockReset();

  if (activeSession !== null) {
    activeSession.cleanup();
    activeSession = null;
  }
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InboxWelcomeWorkload follow-up rail", () => {
  it("renders follow-up rows with conversation aria labels", () => {
    activeSession = renderComponent(buildWorkload(3), buildSalesforceLifecycle());

    const buttons = Array.from(
      activeSession.container.querySelectorAll(
        'button[aria-label^="Open conversation with"]',
      ),
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
    activeSession = renderComponent(buildWorkload(0), buildSalesforceLifecycle());

    expect(activeSession.container.textContent).not.toContain(
      "These need follow-up",
    );
    expect(activeSession.container.textContent).not.toContain("View all");
  });

  it("routes View all clicks to the follow-up inbox filter", () => {
    activeSession = renderComponent(buildWorkload(3), buildSalesforceLifecycle());

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

describe("InboxWelcomeWorkload lifecycle dashboard", () => {
  it("renders tiles in the order provided by the server assembler", () => {
    activeSession = renderComponent(buildWorkload(0), buildSalesforceLifecycle());

    const projectButtons = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).filter((element) =>
      ["Beta Research", "Alpha Research"].some((name) =>
        element.textContent.includes(name),
      ),
    );

    expect(projectButtons.map((element) => element.textContent)).toEqual([
      expect.stringContaining("Beta Research"),
      expect.stringContaining("Alpha Research"),
    ]);
  });

  it("renders the empty state when no active lifecycle tiles are returned", () => {
    activeSession = renderComponent(
      buildWorkload(0),
      buildSalesforceLifecycle({ tiles: [] }),
    );

    expect(activeSession.container.textContent).toContain(
      "No active projects yet — activate one in Settings",
    );
  });

  it("renders the stale banner only for stale-2h freshness", () => {
    activeSession = renderComponent(
      buildWorkload(0),
      buildSalesforceLifecycle({ freshness: "stale-2h" }),
    );

    expect(activeSession.container.textContent).toContain(
      "Salesforce sync delayed — numbers may be stale.",
    );

    activeSession.cleanup();
    activeSession = renderComponent(
      buildWorkload(0),
      buildSalesforceLifecycle({ freshness: "stale-30m" }),
    );

    expect(activeSession.container.textContent).not.toContain(
      "Salesforce sync delayed — numbers may be stale.",
    );
  });

  it.each([
    {
      freshness: "fresh" as const,
      lastSuccessAt: new Date("2026-05-07T11:55:00.000Z"),
      expectedLabel: "Last synced 5 min ago",
    },
    {
      freshness: "stale-30m" as const,
      lastSuccessAt: new Date("2026-05-07T11:00:00.000Z"),
      expectedLabel: "Last synced over 30 min ago",
    },
    {
      freshness: "stale-2h" as const,
      lastSuccessAt: new Date("2026-05-07T09:30:00.000Z"),
      expectedLabel: "Last synced over 2 hr ago",
    },
  ])("updates the freshness label for $freshness", ({
    freshness,
    lastSuccessAt,
    expectedLabel,
  }) => {
    activeSession = renderComponent(
      buildWorkload(0),
      buildSalesforceLifecycle({
        freshness,
        lastSuccessAt,
      }),
    );

    expect(activeSession.container.textContent).toContain(expectedLabel);
  });
});
