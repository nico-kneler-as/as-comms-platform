import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  Check: () => null,
  LoaderCircle: () => null,
  Lock: () => null,
}));

import { AudienceFilterPanel } from "../../app/broadcasts/new/_components/audience-filter-panel";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    }
  ) => {
    readonly window: Window & typeof globalThis;
  };
};

let root: Root | null = null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts/new",
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Event = dom.window.Event;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof AudienceFilterPanel>> = {}) {
  if (root === null) {
    throw new Error("root not initialized");
  }

  const props: React.ComponentProps<typeof AudienceFilterPanel> = {
    criteria: {
      projectId: "project-a",
      projectIds: ["project-a", "project-b"],
      statuses: [],
      contactIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    projectOptions: [
      {
        id: "project-a",
        name: "Restoring Butternut Forest Health",
        alias: null,
        aliasHint: "forests@",
        connectedToProjectId: "host-project",
        isSubProject: true,
      },
      {
        id: "project-b",
        name: "Saving American Beech",
        alias: null,
        aliasHint: "forests@",
        connectedToProjectId: "host-project",
        isSubProject: true,
      },
    ],
    statusOptions: ["Waitlist", "In Progress", "Denied"],
    statusCounts: {
      Waitlist: 12,
      "In Progress": 0,
      Denied: 3,
    },
    statusCountsLoading: false,
    statusCountsErrorMessage: null,
    onToggleAllStatuses: () => undefined,
    onProjectChange: () => undefined,
    onStatusToggle: () => undefined,
    ...overrides,
  };

  act(() => {
    root?.render(<AudienceFilterPanel {...props} />);
  });
}

beforeEach(() => {
  setupDom();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  document.body.innerHTML = "";
  root = null;
});

describe("AudienceFilterPanel", () => {
  it("renders accessible controls for project and stage-grouped status filters", () => {
    renderPanel();

    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("aria-label") ===
          "Choose project Restoring Butternut Forest Health",
      ),
    ).toBe(true);
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("aria-label") ===
          "Choose project Saving American Beech",
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("forests@");
    expect(document.body.textContent).toContain("pick one or more sub-projects");
    expect(
      Array.from(document.querySelectorAll("button")).some((button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("TOP-FUNNEL");
    expect(document.body.textContent).toContain("OFF-FUNNEL");
    expect(document.body.textContent).not.toContain("MID-FUNNEL");
  });

  it("fires project, select-all, and status callbacks when those controls change", () => {
    const projectChange = vi.fn();
    const toggleAllStatuses = vi.fn();
    const statusToggle = vi.fn();

    renderPanel({
      onProjectChange: projectChange,
      onToggleAllStatuses: toggleAllStatuses,
      onStatusToggle: statusToggle,
    });

    const hostButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Choose project Restoring Butternut Forest Health",
    );
    if (!(hostButton instanceof HTMLButtonElement)) {
      throw new Error("Host project button not found");
    }

    act(() => {
      hostButton.click();
    });

    const statusButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
    );
    if (!(statusButton instanceof HTMLButtonElement)) {
      throw new Error("Status chip not found");
    }

    act(() => {
      statusButton.click();
    });

    const selectAllButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Select all",
    );
    if (!(selectAllButton instanceof HTMLButtonElement)) {
      throw new Error("Select all button not found");
    }

    act(() => {
      selectAllButton.click();
    });

    expect(projectChange).toHaveBeenCalledWith("project-a");
    expect(statusToggle).toHaveBeenCalledWith("Waitlist");
    expect(toggleAllStatuses).toHaveBeenCalledWith(true);
  });

  it("applies the stage tone classes and hides empty stages", () => {
    renderPanel({
      criteria: {
        projectId: "project-a",
        projectIds: ["project-a", "project-b"],
        statuses: ["Waitlist"],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
    });

    const waitlistButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
    );
    const deniedButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Denied",
    );

    if (!(waitlistButton instanceof HTMLButtonElement)) {
      throw new Error("Waitlist status button not found");
    }
    if (!(deniedButton instanceof HTMLButtonElement)) {
      throw new Error("Denied status button not found");
    }

    expect(waitlistButton.getAttribute("aria-checked")).toBe("true");
    expect(waitlistButton.className).toContain("bg-emerald-600");
    expect(deniedButton.className).toContain("bg-rose-50");
    expect(document.body.textContent).not.toContain("MID-FUNNEL");
  });

  it("renders a locked pill for single-project aliases", () => {
    renderPanel({
      criteria: {
        projectId: "project-a",
        projectIds: ["project-a"],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      projectOptions: [
        {
          id: "project-a",
          name: "CA Biodiversity",
          alias: "cabio",
          aliasHint: "cabio@",
          connectedToProjectId: null,
          isSubProject: false,
        },
      ],
    });

    expect(document.body.textContent).toContain("Inherited from cabio@");
    expect(document.body.textContent).toContain("CA Biodiversity");
    expect(
      Array.from(document.querySelectorAll("button")).some((button) =>
        button.getAttribute("aria-label")?.startsWith("Choose project "),
      ),
    ).toBe(false);
  });
});
