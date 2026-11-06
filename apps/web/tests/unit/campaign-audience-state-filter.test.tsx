import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  Check: () => null,
  Plus: () => null,
}));

const PopoverContext = React.createContext<{
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    open,
    onOpenChange,
    children,
  }: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly children: React.ReactNode;
  }) => (
    <PopoverContext.Provider value={{ open, onOpenChange }}>
      {children}
    </PopoverContext.Provider>
  ),
  PopoverTrigger: ({
    children,
  }: {
    readonly children: React.ReactElement<React.ComponentProps<"button">>;
  }) => {
    const context = React.useContext(PopoverContext);
    return React.cloneElement(children, {
      onClick: () => {
        context?.onOpenChange(!context.open);
      },
    });
  },
  PopoverContent: ({ children }: { readonly children: React.ReactNode }) => {
    const context = React.useContext(PopoverContext);
    return context?.open ? <div role="dialog">{children}</div> : null;
  },
}));

import {
  AudienceStateFilterSection,
  type AudienceStateCounts,
} from "../../app/broadcasts/new/_components/audience-filter-panel";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (html?: string, options?: { readonly url?: string; readonly pretendToBeVisual?: boolean }) => {
    readonly window: Window & typeof globalThis;
  };
};

let root: Root | null = null;

const stateCounts: AudienceStateCounts = {
  byState: [
    { code: "MT", count: 1618 },
    { code: "ID", count: 187 },
    { code: "WA", count: 90 },
    { code: "OR", count: 80 },
    { code: "CA", count: 70 },
    { code: "CO", count: 60 },
    { code: "TX", count: 50 },
    { code: "NY", count: 40 },
    { code: "FL", count: 30 },
    { code: "AZ", count: 20 },
    { code: "AK", count: 10 },
    { code: "AL", count: 9 },
  ],
  noStateOnFile: 2,
  total: 2265,
  lastSyncedAt: "2026-11-06T00:00:00.000Z",
};

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
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PointerEvent = dom.window.PointerEvent;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function renderSection(
  overrides: Partial<React.ComponentProps<typeof AudienceStateFilterSection>> = {},
) {
  const props: React.ComponentProps<typeof AudienceStateFilterSection> = {
    selectedStates: [],
    stateCounts,
    loading: false,
    errorMessage: null,
    onToggle: () => undefined,
    onClear: () => undefined,
    ...overrides,
  };
  act(() => {
    root?.render(<AudienceStateFilterSection {...props} />);
  });
}

function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${label}`);
  }
  act(() => {
    button.click();
  });
}

beforeEach(setupDom);

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("AudienceStateFilterSection", () => {
  it("renders the top ten states with formatted counts and appends a selected state outside them", () => {
    renderSection({ selectedStates: ["AK"] });

    expect(document.body.textContent).toContain("Montana");
    expect(document.body.textContent).toContain("1,618");
    expect(document.body.textContent).toContain("Arizona");
    expect(document.body.textContent).toContain("Alaska");
    expect(document.querySelector('[aria-label="Toggle state Alaska (AK)"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Toggle state Alabama (AL)"]')).toBeNull();
  });

  it("toggles state pills and clears the selected states", () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    renderSection({ selectedStates: ["MT"], onToggle, onClear });

    clickButton("Toggle state Montana (MT)");
    clickButton("Clear states");

    expect(onToggle).toHaveBeenCalledWith("MT");
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("lists remaining states by count and closes after one is picked", () => {
    const onToggle = vi.fn();
    renderSection({ onToggle });

    clickButton("Add another state");
    const menuText = document.body.textContent;
    expect(menuText.indexOf("Alaska")).toBeLessThan(menuText.indexOf("Alabama"));

    const alaska = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent.includes("Alaska"),
    );
    if (!(alaska instanceof HTMLButtonElement)) {
      throw new Error("Missing Alaska menu option");
    }
    act(() => {
      alaska.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggle).toHaveBeenCalledWith("AK");
    expect(document.body.textContent).not.toContain("Alabama");
  });

  it("shows the no-state helper only for selected states, with singular and plural grammar", () => {
    renderSection({ selectedStates: ["MT"] });
    expect(document.body.textContent).toContain("2 people with no state on file are left out.");

    renderSection({
      selectedStates: ["MT"],
      stateCounts: { ...stateCounts, noStateOnFile: 1 },
    });
    expect(document.body.textContent).toContain("1 person with no state on file is left out.");

    renderSection({ selectedStates: [] });
    expect(document.body.textContent).not.toContain("no state on file are left out");
  });

  it("renders the not-synced and empty-state notes", () => {
    const notSynced = renderToStaticMarkup(
      <AudienceStateFilterSection
        selectedStates={[]}
        stateCounts={{ ...stateCounts, lastSyncedAt: null }}
        loading={false}
        errorMessage={null}
        onToggle={() => undefined}
        onClear={() => undefined}
      />,
    );
    const empty = renderToStaticMarkup(
      <AudienceStateFilterSection
        selectedStates={[]}
        stateCounts={{ ...stateCounts, byState: [] }}
        loading={false}
        errorMessage={null}
        onToggle={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(notSynced).toContain("State data hasn&#x27;t synced from Salesforce yet.");
    expect(empty).toContain("No one in this audience has a state on file.");
  });
});
