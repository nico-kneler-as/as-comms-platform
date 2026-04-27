import { createRequire } from "node:module";
import React, {
  act,
  cloneElement,
  createElement,
  isValidElement,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());
const actionMocks = vi.hoisted(() => ({
  deactivateUserAction: vi.fn(),
  demoteUserAction: vi.fn(),
  inviteUserAction: vi.fn(),
  promoteUserAction: vi.fn(),
  reactivateUserAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefresh,
  }),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("lucide-react", () => ({
  UserPlus: iconMock("UserPlus"),
  X: iconMock("X"),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild = false,
    children,
    className,
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly asChild?: boolean;
    readonly size?: string;
    readonly variant?: string;
  }) => {
    void size;
    void variant;

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, {
        ...props,
        className,
      });
    }

    return createElement("button", { className, ...props }, children);
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) =>
    createElement("span", null, label),
}));

vi.mock("@/components/ui/tone-avatar", () => ({
  ToneAvatar: ({ initials }: { readonly initials: string }) =>
    createElement("span", null, initials),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    readonly children: ReactNode;
    readonly open?: boolean;
  }) =>
    open ? createElement("div", { "data-dialog-root": true }, children) : null,
  DialogContent: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("div", { className, role: "dialog" }, children),
  DialogDescription: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("p", { className }, children),
  DialogFooter: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("div", { className }, children),
  DialogTitle: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("h2", { className }, children),
}));

vi.mock("@/app/settings/actions", () => ({
  deactivateUserAction: actionMocks.deactivateUserAction,
  demoteUserAction: actionMocks.demoteUserAction,
  inviteUserAction: actionMocks.inviteUserAction,
  promoteUserAction: actionMocks.promoteUserAction,
  reactivateUserAction: actionMocks.reactivateUserAction,
}));

vi.mock("../../app/settings/actions", () => ({
  deactivateUserAction: actionMocks.deactivateUserAction,
  demoteUserAction: actionMocks.demoteUserAction,
  inviteUserAction: actionMocks.inviteUserAction,
  promoteUserAction: actionMocks.promoteUserAction,
  reactivateUserAction: actionMocks.reactivateUserAction,
}));

import { AccessSection } from "../../app/settings/_components/access-section";
import { TeammateInviteModal } from "../../app/settings/_components/teammate-invite-modal";
import type { AccessSettingsViewModel } from "../../src/server/settings/selectors";

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
  readonly cleanup: () => Promise<void>;
  readonly container: HTMLDivElement;
  readonly root: Root;
}

let activeSession: RenderSession | null = null;

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
  actionMocks.deactivateUserAction.mockReset();
  actionMocks.demoteUserAction.mockReset();
  actionMocks.inviteUserAction.mockReset();
  actionMocks.promoteUserAction.mockReset();
  actionMocks.reactivateUserAction.mockReset();
  routerRefresh.mockReset();
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
    window,
  } as const;

  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: window.getComputedStyle.bind(window),
    writable: true,
  });

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    return globalThis.setTimeout(() => {
      callback(Date.now());
    }, 16);
  }) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) => {
    globalThis.clearTimeout(handle);
  }) as unknown as typeof window.cancelAnimationFrame;
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as typeof window.matchMedia;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

async function mount(element: ReactElement): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  activeSession = {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      dom.window.close();
    },
  };
  return activeSession;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function getText(container: HTMLElement): string {
  return normalizeText(container.textContent);
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => normalizeText(element.textContent).includes(text),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function findInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector(
    'input[placeholder="teammate@adventurescientists.org"]',
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Invite email input not found");
  }

  return input;
}

function findForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("Invite form not found");
  }

  return form;
}

async function click(element: Element): Promise<void> {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    throw new Error("Element is detached from a document");
  }

  await act(async () => {
    element.dispatchEvent(
      new view.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

async function typeValue(
  element: HTMLInputElement,
  value: string,
): Promise<void> {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    throw new Error("Element is detached from a document");
  }

  // React 18 controlled-input pattern under JSDOM:
  // React patches the value setter on the input instance and tracks "last value"
  // via element._valueTracker. To make React's onChange fire, we must (a) clear
  // the tracker so React detects a change, then (b) set the value via the
  // PROTOTYPE setter (bypassing React's instance-level wrapper), then dispatch
  // a native input event. Without the tracker reset, React compares the new
  // value to the cached one and skips the onChange handler in some scenarios.
  const tracker = (
    element as HTMLInputElement & { _valueTracker?: { setValue(v: string): void } }
  )._valueTracker;
  if (tracker) {
    tracker.setValue("");
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    view.HTMLInputElement.prototype,
    "value",
  );
  if (descriptor?.set !== undefined) {
    descriptor.set.call(element, value);
  }

  await act(async () => {
    element.dispatchEvent(new view.Event("input", { bubbles: true }));
    element.dispatchEvent(new view.Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  const view = form.ownerDocument.defaultView;
  if (!view) {
    throw new Error("Form is detached from a document");
  }

  await act(async () => {
    form.dispatchEvent(
      new view.Event("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buildAccessViewModel(): AccessSettingsViewModel {
  return {
    isAdmin: true,
    currentUserId: "user:admin",
    admins: [
      {
        userId: "user:admin",
        displayName: "Admin User",
        email: "admin@adventurescientists.org",
        role: "admin",
        status: "active",
        lastActiveAt: "2026-04-24T12:00:00.000Z",
      },
    ],
    internalUsers: [],
  };
}

function ModalHarness() {
  const [open, setOpen] = useState(true);
  return (
    <TeammateInviteModal
      open={open}
      onClose={() => {
        setOpen(false);
      }}
    />
  );
}

function successfulInviteResult() {
  return {
    ok: true as const,
    requestId: "request-invite",
    data: {
      user: {
        userId: "user:new",
        displayName: "teammate@adventurescientists.org",
        email: "teammate@adventurescientists.org",
        role: "internal_user" as const,
        status: "pending" as const,
        lastActiveAt: null,
      },
    },
  };
}

describe("teammate invite modal", () => {
  it("opens when Invite button is clicked from Access", async () => {
    const { container } = await mount(
      createElement(AccessSection, {
        viewModel: buildAccessViewModel(),
      }),
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(findButton(container, "Invite teammate"));

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(getText(container)).toContain(
      "They'll link automatically on their first Google sign-in.",
    );
  });

  it("shows an email validation error for non-Adventure Scientists addresses", async () => {
    const { container } = await mount(
      createElement(TeammateInviteModal, {
        open: true,
        onClose: vi.fn(),
      }),
    );

    await typeValue(findInput(container), "person@example.org");

    expect(getText(container)).toContain(
      "Must be an @adventurescientists.org address.",
    );
    expect(findInput(container).getAttribute("aria-invalid")).toBe("true");
    expect(findButton(container, "Send invite").disabled).toBe(true);
  });

  it("defaults the role to operator", async () => {
    const { container } = await mount(
      createElement(TeammateInviteModal, {
        open: true,
        onClose: vi.fn(),
      }),
    );

    expect(findButton(container, "Operator").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(findButton(container, "Admin").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("selects Admin when the Admin card is clicked", async () => {
    const { container } = await mount(
      createElement(TeammateInviteModal, {
        open: true,
        onClose: vi.fn(),
      }),
    );

    await click(findButton(container, "Admin"));

    expect(findButton(container, "Admin").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(findButton(container, "Operator").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("submits inviteUserAction with the entered email and role", async () => {
    actionMocks.inviteUserAction.mockResolvedValue(successfulInviteResult());
    const { container } = await mount(
      createElement(TeammateInviteModal, {
        open: true,
        onClose: vi.fn(),
      }),
    );

    await typeValue(findInput(container), "New.Admin@AdventureScientists.org ");
    await click(findButton(container, "Admin"));
    await submit(findForm(container));

    expect(actionMocks.inviteUserAction).toHaveBeenCalledTimes(1);
    const formData = actionMocks.inviteUserAction.mock
      .calls[0]?.[0] as FormData;
    expect(formData.get("email")).toBe("new.admin@adventurescientists.org");
    expect(formData.get("role")).toBe("admin");
  });

  it("shows server errors inside the modal", async () => {
    actionMocks.inviteUserAction.mockResolvedValue({
      ok: false,
      code: "already_exists",
      message: "That teammate already has access.",
      requestId: "request-error",
    });
    const { container } = await mount(
      createElement(TeammateInviteModal, {
        open: true,
        onClose: vi.fn(),
      }),
    );

    await typeValue(findInput(container), "teammate@adventurescientists.org");
    await submit(findForm(container));

    expect(getText(container)).toContain("That teammate already has access.");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("closes after a successful submit", async () => {
    actionMocks.inviteUserAction.mockResolvedValue(successfulInviteResult());
    const { container } = await mount(createElement(ModalHarness));

    await typeValue(findInput(container), "teammate@adventurescientists.org");
    await submit(findForm(container));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
});
