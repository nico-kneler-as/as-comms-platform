import React, { act, createElement, type InputHTMLAttributes } from "react";

Object.assign(globalThis, { React });

import { createRequire } from "node:module";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const w = dom.window;
  const entries = {
    document: w.document,
    Event: w.Event,
    HTMLElement: w.HTMLElement,
    HTMLInputElement: w.HTMLInputElement,
    MouseEvent: w.MouseEvent,
    Node: w.Node,
    PointerEvent: w.PointerEvent,
    window: w,
  } as const;
  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  Object.defineProperty(w.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(w.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: () => undefined,
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const searchContactsAction = vi.fn<
  (query: string) => Promise<{ readonly ok: boolean; readonly data: readonly unknown[] }>
>();

vi.mock("../../app/inbox/actions", () => ({
  searchContactsAction: (query: string) => searchContactsAction(query),
}));

vi.mock("@/components/ui/chip", () => ({
  Chip: ({ children }: { readonly children: React.ReactNode }) =>
    createElement("span", null, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) =>
    createElement("input", {
      ...props,
      onInput: props.onChange,
    }),
}));

vi.mock("../../app/inbox/_components/icons", () => ({
  SearchIcon: () => createElement("svg", { "data-icon": "search" }),
  XIcon: () => createElement("svg", { "data-icon": "x" }),
}));

import { ComposerRecipientPicker } from "../../app/inbox/_components/composer-recipient-picker";
import { ComposerSmsRecipientPicker } from "../../app/inbox/_components/composer-sms-recipient-picker";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
}

async function typeQuery(input: HTMLInputElement, value: string): Promise<void> {
  const valueDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );

  await act(async () => {
    input.focus();
    valueDescriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await Promise.resolve();
  });
}

async function clickOutside(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await Promise.resolve();
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await Promise.resolve();
  });
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  searchContactsAction.mockReset();
});

describe("composer recipient pickers", () => {
  it("collapses email search results after an outside click", async () => {
    searchContactsAction.mockResolvedValue({ ok: true, data: [] });

    await mount(
      <ComposerRecipientPicker recipients={[]} onRecipientsChange={vi.fn()} />,
    );

    const input = document.querySelector("input");
    expect(input).not.toBeNull();
    if (input === null) {
      throw new Error("Expected the email recipient input to render");
    }

    await typeQuery(input, "maya");

    expect(document.body.textContent).toContain("No matching contacts.");

    await clickOutside();

    expect(document.body.textContent).not.toContain("No matching contacts.");
  });

  it("collapses SMS search results after an outside click", async () => {
    searchContactsAction.mockResolvedValue({ ok: true, data: [] });

    await mount(
      <ComposerSmsRecipientPicker
        recipient={null}
        onRecipientChange={vi.fn()}
      />,
    );

    const input = document.querySelector("input");
    expect(input).not.toBeNull();
    if (input === null) {
      throw new Error("Expected the SMS recipient input to render");
    }

    await typeQuery(input, "maya");

    expect(document.body.textContent).toContain("No matching phone contacts.");

    await clickOutside();

    expect(document.body.textContent).not.toContain(
      "No matching phone contacts.",
    );
  });
});
