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
type AudienceFilterCriteria =
  React.ComponentProps<typeof AudienceFilterPanel>["criteria"];

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
        projectAlias: "Beech & Butternut",
        aliasHint: "forests@",
        connectedToProjectId: "host-project",
        isSubProject: true,
      },
      {
        id: "project-b",
        name: "Saving American Beech",
        alias: null,
        projectAlias: "Beech & Butternut",
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

function findProjectButton(projectName: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === `Choose project ${projectName}`,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Project button not found: ${projectName}`);
  }

  return button;
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
    expect(document.body.textContent).toContain("Waitlist");
    expect(document.body.textContent).toContain("Denied");
    expect(document.body.textContent).not.toContain("TOP-FUNNEL");
    expect(document.body.textContent).not.toContain("MID-FUNNEL");
    expect(document.body.textContent).not.toContain("OFF-FUNNEL");
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

  it("applies the stage tone classes and hides pills from empty stages", () => {
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
      statusCounts: {
        Waitlist: 12,
        "In Progress": 0,
        Denied: 0,
      },
    });

    const waitlistButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
    );

    if (!(waitlistButton instanceof HTMLButtonElement)) {
      throw new Error("Waitlist status button not found");
    }

    expect(waitlistButton.getAttribute("aria-checked")).toBe("true");
    expect(waitlistButton.className).toContain("bg-emerald-600");
    expect(
      document.querySelector(
        '[aria-label="Toggle expedition-member status Denied"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Toggle expedition-member status Failed"]',
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("MID-FUNNEL");
    expect(document.body.textContent).not.toContain("OFF-FUNNEL");
  });

  it("renders packed status pills in a flex-wrap row instead of the old grid", () => {
    renderPanel();

    const waitlistButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
    );

    if (!(waitlistButton instanceof HTMLButtonElement)) {
      throw new Error("Waitlist status button not found");
    }

    const pillContainer = waitlistButton.parentElement;
    if (!(pillContainer instanceof HTMLElement)) {
      throw new Error("Status pill container not found");
    }

    expect(pillContainer.className).toContain("flex-wrap");
    expect(pillContainer.className).not.toContain("grid-cols-");
  });

  it("renders compact rounded-full status pills without the legacy fixed height", () => {
    renderPanel();

    const waitlistButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") ===
        "Toggle expedition-member status Waitlist",
    );

    if (!(waitlistButton instanceof HTMLButtonElement)) {
      throw new Error("Waitlist status button not found");
    }

    expect(waitlistButton.className).toContain("rounded-full");
    expect(waitlistButton.className).not.toContain("min-h-[48px]");
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
          projectAlias: "CA Biodiversity",
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

  it("renders neutral project pills for multi-project aliases", () => {
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
    });

    const projectButtons = Array.from(document.querySelectorAll("button")).filter(
      (button) => button.getAttribute("aria-label")?.startsWith("Choose project "),
    );

    expect(projectButtons).toHaveLength(2);
    expect(projectButtons[0]?.className).toContain("rounded-full");
    expect(projectButtons[1]?.className).toContain("rounded-full");
    expect(projectButtons[0]?.className).not.toContain("rounded-xl");
    expect(projectButtons[0]?.className).toContain("bg-slate-900");
    expect(projectButtons[0]?.className).toContain("text-white");
    expect(projectButtons[1]?.className).toContain("bg-slate-100");
    expect(projectButtons[1]?.className).toContain("text-slate-700");
    expect(projectButtons[1]?.className).toContain("ring-slate-300");
    expect(
      document.querySelector(
        '[aria-label="Project Restoring Butternut Forest Health is locked to this sender alias"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Project Saving American Beech is locked to this sender alias"]',
      ),
    ).toBeNull();
  });

  it("keeps additive multi-select behavior on the email path", () => {
    const activeRoot = root;
    if (activeRoot === null) {
      throw new Error("root not initialized");
    }

    function Harness() {
      const [criteria, setCriteria] = React.useState<AudienceFilterCriteria>({
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time" as const,
        hasReplied: "either" as const,
        hasClicked: "either" as const,
      });

      return (
        <AudienceFilterPanel
          criteria={criteria}
          projectOptions={[
            {
              id: "project-a",
              name: "Restoring Butternut Forest Health",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "host-project",
              isSubProject: true,
            },
            {
              id: "project-b",
              name: "Saving American Beech",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "host-project",
              isSubProject: true,
            },
          ]}
          statusOptions={[]}
          statusCounts={{}}
          statusCountsLoading={false}
          statusCountsErrorMessage={null}
          showStatusSection={false}
          onProjectChange={(projectId) => {
            setCriteria((current) => {
              const nextProjectIds = current.projectIds.includes(projectId)
                ? current.projectIds.filter((value) => value !== projectId)
                : [...current.projectIds, projectId];

              return {
                ...current,
                projectId: nextProjectIds[0] ?? null,
                projectIds: nextProjectIds,
              };
            });
          }}
          onToggleAllStatuses={() => undefined}
          onStatusToggle={() => undefined}
        />
      );
    }

    act(() => {
      activeRoot.render(<Harness />);
    });

    const firstButton = findProjectButton("Restoring Butternut Forest Health");
    const secondButton = findProjectButton("Saving American Beech");

    act(() => {
      firstButton.click();
    });
    expect(
      findProjectButton("Restoring Butternut Forest Health").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    act(() => {
      secondButton.click();
    });

    expect(
      findProjectButton("Restoring Butternut Forest Health").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      findProjectButton("Saving American Beech").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("replaces the selected project in SMS single-select mode", () => {
    const activeRoot = root;
    if (activeRoot === null) {
      throw new Error("root not initialized");
    }

    function Harness() {
      const [criteria, setCriteria] = React.useState<AudienceFilterCriteria>({
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time" as const,
        hasReplied: "either" as const,
        hasClicked: "either" as const,
      });

      return (
        <AudienceFilterPanel
          criteria={criteria}
          projectOptions={[
            {
              id: "project-a",
              name: "Restoring Butternut Forest Health",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "host-project",
              isSubProject: true,
            },
            {
              id: "project-b",
              name: "Saving American Beech",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "host-project",
              isSubProject: true,
            },
          ]}
          singleSelectProjects={true}
          statusOptions={[]}
          statusCounts={{}}
          statusCountsLoading={false}
          statusCountsErrorMessage={null}
          showStatusSection={false}
          onProjectChange={(projectId) => {
            setCriteria((current) => ({
              ...current,
              projectId,
              projectIds: [projectId],
            }));
          }}
          onToggleAllStatuses={() => undefined}
          onStatusToggle={() => undefined}
        />
      );
    }

    act(() => {
      activeRoot.render(<Harness />);
    });

    act(() => {
      findProjectButton("Restoring Butternut Forest Health").click();
    });
    expect(
      findProjectButton("Restoring Butternut Forest Health").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    act(() => {
      findProjectButton("Saving American Beech").click();
    });

    expect(
      findProjectButton("Restoring Butternut Forest Health").getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
    expect(
      findProjectButton("Saving American Beech").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
