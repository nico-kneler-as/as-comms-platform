import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  Check: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  Trash2: () => null
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => React.createElement("button", props, children)
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("input", props)
}));

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

import { StepKnowledge } from "../../app/settings/_components/activation-wizard/step-knowledge";
import type { KnowledgeSourceDraft } from "../../app/settings/_components/activation-wizard/state";

let dom: InstanceType<typeof JSDOM> | null = null;
let root: Root | null = null;

function setupDom() {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/settings",
    pretendToBeVisual: true
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Event = dom.window.Event;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function renderStep(input: {
  readonly knowledgeSourceDrafts?: readonly KnowledgeSourceDraft[];
  readonly skipKnowledgeSetup?: boolean;
  readonly onSubmit?: () => void;
}) {
  if (!root) {
    throw new Error("root not initialized");
  }
  const activeRoot = root;

  act(() => {
    activeRoot.render(
      <StepKnowledge
        knowledgeSourceDrafts={
          input.knowledgeSourceDrafts ?? [{ url: "", label: "" }]
        }
        skipKnowledgeSetup={input.skipKnowledgeSetup ?? false}
        knowledgeStatus="idle"
        knowledgeMessage={null}
        onAddRow={() => undefined}
        onRemoveRow={() => undefined}
        onFieldChange={() => undefined}
        onSkipKnowledgeSetupChange={() => undefined}
        onSubmit={input.onSubmit ?? (() => undefined)}
      />
    );
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
  dom = null;
});

function getSaveButton(): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent.includes("Save sources")
  );
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("Save sources button not found");
  }
  return element;
}

describe("StepKnowledge", () => {
  it("renders one row per draft with URL and Label inputs", () => {
    renderStep({
      knowledgeSourceDrafts: [
        { url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "Whitebark FAQ" },
        { url: "", label: "" }
      ]
    });

    expect(document.body.textContent).toContain("AI Knowledge sources");
    expect(document.body.textContent).toContain("Source URL");
    expect(document.body.textContent).toContain("Label");
    // Two URL inputs + two Label inputs = 4 inputs (plus the skip checkbox).
    const inputs = document.querySelectorAll("input");
    // checkbox is an input too — so we have 4 row inputs + 1 checkbox.
    expect(inputs.length).toBeGreaterThanOrEqual(5);
  });

  it("flags invalid URLs inline next to the offending row", () => {
    renderStep({
      knowledgeSourceDrafts: [
        { url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "" },
        { url: "not-a-url", label: "" }
      ]
    });

    // The error text appears in the second row.
    const errorEls = document.querySelectorAll("p.text-rose-600");
    const errorTexts = Array.from(errorEls).map((node) => node.textContent);
    expect(errorTexts.length).toBeGreaterThan(0);
    expect(errorTexts.some((text) => text.length > 0)).toBe(true);
  });

  it("disables submission when every row is empty or any URL is invalid", () => {
    renderStep({
      knowledgeSourceDrafts: [{ url: "", label: "" }]
    });
    expect(getSaveButton().disabled).toBe(true);

    renderStep({
      knowledgeSourceDrafts: [{ url: "not-a-url", label: "" }]
    });
    expect(getSaveButton().disabled).toBe(true);

    renderStep({
      knowledgeSourceDrafts: [
        { url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "" }
      ]
    });
    expect(getSaveButton().disabled).toBe(false);
  });

  it("supports the skip path without submitting sources", () => {
    const onSubmit = vi.fn();
    renderStep({
      skipKnowledgeSetup: true,
      onSubmit
    });

    expect(document.body.textContent).toContain("Skip - set up AI Knowledge later");
    expect(document.body.textContent).not.toContain("Save sources");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits once at least one valid URL is present", () => {
    const onSubmit = vi.fn();
    renderStep({
      knowledgeSourceDrafts: [
        { url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "Notion FAQ" },
        { url: "https://www.adventurescientists.org/project/whitebark-pine", label: "Homepage" }
      ],
      onSubmit
    });

    const saveButton = getSaveButton();
    expect(saveButton.disabled).toBe(false);

    act(() => {
      saveButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
