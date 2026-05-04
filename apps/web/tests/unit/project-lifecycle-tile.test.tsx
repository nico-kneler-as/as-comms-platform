import { createRequire } from "node:module";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectLifecycleTile } from "../../app/inbox/_components/project-lifecycle-tile";
import type { ProjectLifecycleTile as ProjectLifecycleTileData } from "../../app/inbox/_lib/project-lifecycle-metrics";

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
}

function renderComponent(
  tile: ProjectLifecycleTileData,
  handlers: {
    readonly onOpenProject?: (projectId: string) => void;
    readonly onOpenMetric?: (
      projectId: string,
      metricKey: "signups" | "trainingCompletions" | "dataSubmissions",
    ) => void;
  } = {},
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
      <ProjectLifecycleTile
        tile={tile}
        onOpenProject={handlers.onOpenProject ?? (() => undefined)}
        onOpenMetric={handlers.onOpenMetric ?? (() => undefined)}
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

function buildTile(overrides: Partial<ProjectLifecycleTileData> = {}): ProjectLifecycleTileData {
  return {
    projectId: overrides.projectId ?? "project:alpha",
    projectName: overrides.projectName ?? "Alpha Research",
    projectTone: overrides.projectTone ?? "sky",
    unreadCount: overrides.unreadCount ?? 4,
    totals: overrides.totals ?? {
      signups: 10,
      trainingCompletions: 6,
      dataSubmissions: 3,
    },
    today: overrides.today ?? {
      signups: 2,
      trainingCompletions: 1,
      dataSubmissions: 0,
    },
    sparkline: overrides.sparkline ?? {
      signups: [0, 1, 2, 1, 2, 2, 2],
      trainingCompletions: [0, 0, 1, 1, 1, 2, 1],
      dataSubmissions: [0, 0, 0, 0, 1, 1, 0],
    },
  };
}

afterEach(() => {
  if (activeSession !== null) {
    activeSession.cleanup();
    activeSession = null;
  }
});

describe("ProjectLifecycleTile", () => {
  it("renders project content, metrics, today counters, and three sparklines", () => {
    activeSession = renderComponent(buildTile());

    expect(activeSession.container.textContent).toContain("Alpha Research");
    expect(activeSession.container.textContent).toContain("4 unread");
    expect(activeSession.container.textContent).toContain("10");
    expect(activeSession.container.textContent).toContain("6");
    expect(activeSession.container.textContent).toContain("3");
    expect(activeSession.container.textContent).toContain("+2 today");
    expect(activeSession.container.textContent).toContain("+1 today");
    expect(activeSession.container.textContent).toContain("+0 today");
    expect(activeSession.container.querySelectorAll("svg").length).toBe(3);
    expect(activeSession.container.textContent).not.toContain("↗");
  });

  it("opens the project when the header region is clicked", () => {
    const onOpenProject = vi.fn();
    activeSession = renderComponent(buildTile(), { onOpenProject });

    const projectButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("Alpha Research"));

    if (projectButton === undefined) {
      throw new Error("Expected project button");
    }

    act(() => {
      projectButton.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenProject).toHaveBeenCalledWith("project:alpha");
  });

  it("opens the correct metric when each metric block is clicked", () => {
    const onOpenMetric = vi.fn();
    activeSession = renderComponent(buildTile(), { onOpenMetric });

    const buttons = Array.from(activeSession.container.querySelectorAll("button"));
    const signupsButton = buttons.find((element) =>
      element.textContent.includes("Signups"),
    );
    const trainingButton = buttons.find((element) =>
      element.textContent.includes("Training"),
    );
    const submissionsButton = buttons.find((element) =>
      element.textContent.includes("Submissions"),
    );

    for (const button of [signupsButton, trainingButton, submissionsButton]) {
      if (button === undefined) {
        throw new Error("Expected metric button");
      }

      act(() => {
        button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
    }

    expect(onOpenMetric).toHaveBeenNthCalledWith(1, "project:alpha", "signups");
    expect(onOpenMetric).toHaveBeenNthCalledWith(
      2,
      "project:alpha",
      "trainingCompletions",
    );
    expect(onOpenMetric).toHaveBeenNthCalledWith(
      3,
      "project:alpha",
      "dataSubmissions",
    );
  });

  it("renders the zero unread phrase instead of 0 unread", () => {
    activeSession = renderComponent(buildTile({ unreadCount: 0 }));

    expect(activeSession.container.textContent).toContain("No unread");
    expect(activeSession.container.textContent).not.toContain("0 unread");
  });
});
