import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  Check: () => null,
  RefreshCw: () => null
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => React.createElement("button", props, children)
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
  readonly knowledgeSourcesText?: string;
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
        knowledgeSourcesText={input.knowledgeSourcesText ?? ""}
        skipKnowledgeSetup={input.skipKnowledgeSetup ?? false}
        knowledgeStatus="idle"
        knowledgeMessage={null}
        onKnowledgeSourcesTextChange={() => undefined}
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

describe("StepKnowledge", () => {
  it("renders the multiline textarea", () => {
    renderStep({});

    expect(document.querySelector("textarea")).not.toBeNull();
    expect(document.body.textContent).toContain("AI Knowledge sources");
  });

  it("validates URLs as the operator types", () => {
    renderStep({
      knowledgeSourcesText:
        "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nnot-a-url"
    });

    expect(document.body.textContent).toContain("Line 2:");
  });

  it("disables submission when the lines are empty or invalid", () => {
    renderStep({});

    const getSaveButton = () => {
      const element = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent.includes("Save sources")
      );
      if (!(element instanceof HTMLButtonElement)) {
        throw new Error("Save sources button not found");
      }

      return element;
    };

    expect(getSaveButton().disabled).toBe(true);

    renderStep({
      knowledgeSourcesText: "not-a-url"
    });
    expect(getSaveButton().disabled).toBe(true);

    renderStep({
      knowledgeSourcesText:
        "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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

  it("submits after multiple valid URLs are entered", () => {
    const onSubmit = vi.fn();
    renderStep({
      knowledgeSourcesText: [
        "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://www.adventurescientists.org/project/whitebark-pine"
      ].join("\n"),
      onSubmit
    });

    const saveButton = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent.includes("Save sources")
    );
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("Save sources button not found");
    }

    act(() => {
      saveButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
