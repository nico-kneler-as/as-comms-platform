import { createRequire } from "node:module";
import React, { act } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxWelcomeSalesforceLifecycleData } from "../../app/inbox/_lib/home-dashboard";
import type { InboxWelcomeWorkloadViewModel } from "../../app/inbox/_lib/view-models";

const routerPushMock = vi.hoisted(() => vi.fn());
const projectMetricDetailDialogMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) => {
    return React.createElement("svg", { "data-icon": name, ...props });
  };
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
  }) => {
    return <span>{initials}</span>;
  },
}));

vi.mock("../../app/inbox/_components/project-metric-detail-dialog", () => ({
  ProjectMetricDetailDialog: (
    props: {
      readonly open: boolean;
      readonly onOpenChange: (open: boolean) => void;
      readonly onOpenContact: (contactId: string) => void;
      readonly projectName: string | null;
      readonly metricLabel: string | null;
    },
  ) => {
    projectMetricDetailDialogMock(props);

    if (!props.open) {
      return null;
    }

    return (
      <div data-metric-dialog="true">
        <p>{props.projectName}</p>
        <p>{props.metricLabel}</p>
        <button
          type="button"
          onClick={() => {
            props.onOpenChange(false);
          }}
        >
          Close dialog
        </button>
        <button
          type="button"
          onClick={() => {
            props.onOpenContact("contact:alpha");
          }}
        >
          Open Alpha contact
        </button>
      </div>
    );
  },
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

function buildWorkload(): InboxWelcomeWorkloadViewModel {
  return {
    projects: [],
    totals: {
      activeProjects: 0,
      unread: 0,
      needsFollowUp: 0,
    },
    followUpRail: {
      totalCount: 0,
      entries: [],
    },
  };
}

function buildSalesforceLifecycle(): InboxWelcomeSalesforceLifecycleData {
  return {
    freshness: "fresh",
    lastSuccessAt: new Date("2026-05-07T11:55:00.000Z"),
    tiles: [
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

function renderComponent(): RenderSession {
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
        workload={buildWorkload()}
        salesforceLifecycle={buildSalesforceLifecycle()}
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
  routerPushMock.mockReset();
  projectMetricDetailDialogMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();

  if (activeSession !== null) {
    activeSession.cleanup();
    activeSession = null;
  }
});

describe("InboxWelcomeWorkload metric dialog wiring", () => {
  it("opens the dialog with the right project name and metric label from a tile click", () => {
    activeSession = renderComponent();

    const signupsButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("Signups"));

    if (signupsButton === undefined) {
      throw new Error("Expected signups metric button");
    }

    act(() => {
      signupsButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(activeSession.container.textContent).toContain("Alpha Research");
    expect(activeSession.container.textContent).toContain("New Signups");
  });

  it("clears metricDialog state when the dialog closes", () => {
    activeSession = renderComponent();

    const trainingButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("Training"));

    if (trainingButton === undefined) {
      throw new Error("Expected training metric button");
    }

    act(() => {
      trainingButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    const closeButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent === "Close dialog");

    if (closeButton === undefined) {
      throw new Error("Expected dialog close button");
    }

    act(() => {
      closeButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(activeSession.container.querySelector("[data-metric-dialog]")).toBeNull();
  });

  it("navigates to the inbox detail route when the dialog opens a contact", () => {
    activeSession = renderComponent();

    const submissionsButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("Submissions"));

    if (submissionsButton === undefined) {
      throw new Error("Expected submissions metric button");
    }

    act(() => {
      submissionsButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    const openContactButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent === "Open Alpha contact");

    if (openContactButton === undefined) {
      throw new Error("Expected dialog contact button");
    }

    act(() => {
      openContactButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(routerPushMock).toHaveBeenCalledWith("/inbox/contact%3Aalpha");
    expect(activeSession.container.querySelector("[data-metric-dialog]")).toBeNull();
  });
});
