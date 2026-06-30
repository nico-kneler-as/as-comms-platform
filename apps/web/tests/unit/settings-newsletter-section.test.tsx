import { createRequire } from "node:module";
import React, { act, createElement, type ReactNode } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  createOrgSenderAction: vi.fn(),
  setOrgSenderEnabledAction: vi.fn()
}));

vi.mock("@/app/settings/actions", () => ({
  createOrgSenderAction: actionMocks.createOrgSenderAction,
  setOrgSenderEnabledAction: actionMocks.setOrgSenderEnabledAction
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: ReactNode;
  }) => createElement("button", props, children)
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props)
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) =>
    createElement("span", null, label)
}));

import { NewsletterSection } from "../../app/settings/_components/newsletter-section";
import type { OrgSendersSettingsViewModel } from "../../src/server/settings/selectors";

const workerRequire = createRequire(
  new URL("../../../worker/package.json", import.meta.url),
);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html: string,
    options: { readonly url: string }
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

interface RenderSession {
  readonly cleanup: () => void;
  readonly container: HTMLDivElement;
  readonly root: Root;
}

let activeSession: RenderSession | null = null;

afterEach(() => {
  activeSession?.cleanup();
  activeSession = null;
  actionMocks.createOrgSenderAction.mockReset();
  actionMocks.setOrgSenderEnabledAction.mockReset();
});

function setDomGlobals(window: Window & typeof globalThis) {
  const entries = {
    document: window.document,
    Element: window.Element,
    Event: window.Event,
    FormData: window.FormData,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLFormElement: window.HTMLFormElement,
    HTMLInputElement: window.HTMLInputElement,
    MouseEvent: window.MouseEvent,
    MutationObserver: window.MutationObserver,
    navigator: window.navigator,
    Node: window.Node,
    self: window,
    window
  } as const;

  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true
  });
}

function renderSection(
  viewModel: OrgSendersSettingsViewModel
): RenderSession {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/settings/newsletter"
  });
  const { window } = dom;
  setDomGlobals(window);

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(NewsletterSection, { viewModel }));
  });

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
      window.close();
    }
  };
}

function buildViewModel(
  override: Partial<OrgSendersSettingsViewModel> = {}
): OrgSendersSettingsViewModel {
  return {
    isAdmin: true,
    orgSenders: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "info@adventurescientists.org",
        label: "Adventure Scientists",
        enabled: true,
        createdAt: "2026-06-30T12:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z"
      }
    ],
    ...override
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NewsletterSection", () => {
  it("renders the sender list, banner, and add form", () => {
    const html = renderToStaticMarkup(
      createElement(NewsletterSection, {
        viewModel: buildViewModel()
      })
    );

    expect(html).toContain(
      "Org senders send from the Postmark-verified domain adventurescientists.org."
    );
    expect(html).toContain("info@adventurescientists.org");
    expect(html).toContain("Adventure Scientists");
    expect(html).toContain("Add sender");
  });

  it("invokes the enable-disable action from the row button", async () => {
    actionMocks.setOrgSenderEnabledAction.mockResolvedValue({
      ok: true,
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        enabled: false
      },
      requestId: "request:toggle"
    });

    activeSession = renderSection(buildViewModel());

    const button = Array.from(
      activeSession.container.querySelectorAll("button")
    ).find((element) => element.textContent.trim() === "Disable");

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("disable button not rendered");
    }

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(actionMocks.setOrgSenderEnabledAction).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      false
    );
  });
});
