import { createRequire } from "node:module";
import React, {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode
} from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());
const actionMocks = vi.hoisted(() => ({
  activateProjectFromWizardAction: vi.fn(),
  pollProjectKnowledgeBootstrapAction: vi.fn(),
  syncProjectKnowledgeForActivationAction: vi.fn(),
  updateProjectAiKnowledgeAction: vi.fn()
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) =>
    createElement("a", { href, ...props }, children)
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefresh
  })
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("lucide-react", () => ({
  ArrowLeft: iconMock("ArrowLeft"),
  Check: iconMock("Check"),
  ChevronRight: iconMock("ChevronRight"),
  Circle: iconMock("Circle"),
  FolderOpen: iconMock("FolderOpen"),
  Mail: iconMock("Mail"),
  Pencil: iconMock("Pencil"),
  Plus: iconMock("Plus"),
  RefreshCw: iconMock("RefreshCw"),
  Search: iconMock("Search"),
  Sparkles: iconMock("Sparkles"),
  Trash2: iconMock("Trash2"),
  UserPlus: iconMock("UserPlus"),
  X: iconMock("X")
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
        className
      });
    }

    return createElement("button", { className, ...props }, children);
  }
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props)
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    label
  }: {
    readonly label: string;
  }) => createElement("span", null, label)
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open
  }: {
    readonly children: ReactNode;
    readonly open?: boolean;
  }) => (open ? createElement("div", { "data-dialog-root": true }, children) : null),
  DialogContent: ({
    children,
    className
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("div", { className, role: "dialog" }, children),
  DialogDescription: ({
    children,
    className
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("p", { className }, children),
  DialogTitle: ({
    children,
    className
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("h2", { className }, children)
}));

vi.mock("@/app/settings/actions", () => ({
  activateProjectFromWizardAction: actionMocks.activateProjectFromWizardAction,
  pollProjectKnowledgeBootstrapAction:
    actionMocks.pollProjectKnowledgeBootstrapAction,
  syncProjectKnowledgeForActivationAction:
    actionMocks.syncProjectKnowledgeForActivationAction,
  updateProjectAiKnowledgeAction: actionMocks.updateProjectAiKnowledgeAction
}));

import { ActivationWizard } from "../../app/settings/_components/activation-wizard";
import { ProjectsSection } from "../../app/settings/_components/projects-section";

type ProjectRowViewModel =
  Parameters<typeof ActivationWizard>[0]["inactiveProjects"][number];

const workerRequire = createRequire(
  new URL("../../../worker/package.json", import.meta.url)
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

function buildProject(
  input: Partial<ProjectRowViewModel> & {
    readonly projectId: string;
    readonly projectName: string;
    readonly suggestedAlias: string;
  }
): ProjectRowViewModel {
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    suggestedAlias: input.suggestedAlias,
    projectAlias: input.projectAlias ?? null,
    isActive: false,
    primaryEmail: input.primaryEmail ?? null,
    emailAliases: input.emailAliases ?? [],
    additionalEmailCount: input.additionalEmailCount ?? 0,
    aiKnowledgeUrl: input.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt ?? null,
    memberCount: input.memberCount ?? 0,
    activationRequirementsMet: input.activationRequirementsMet ?? false
  };
}

const inactiveProjects = [
  buildProject({
    projectId: "project:river",
    projectName: "River Cleanup",
    suggestedAlias: "River Cleanup"
  }),
  buildProject({
    projectId: "project:trail",
    projectName: "Trail Restore",
    suggestedAlias: "Trail Restore",
    projectAlias: "Trail Restore",
    primaryEmail: "trail@adventurescientists.org",
    emailAliases: ["trail@adventurescientists.org"],
    additionalEmailCount: 0,
    aiKnowledgeUrl: "https://www.notion.so/workspace/trail-restore",
    aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
    activationRequirementsMet: true
  })
] as const satisfies readonly ProjectRowViewModel[];

function buildProjectsViewModel(isAdmin: boolean) {
  return {
    isAdmin,
    active: [],
    inactive: inactiveProjects,
    counts: {
      active: 0,
      inactive: inactiveProjects.length,
      total: inactiveProjects.length
    }
  };
}

function buildActivationResult() {
  return {
    ok: true as const,
    requestId: "request-activate",
    data: {
      projectId: "project:river",
      projectName: "River Cleanup",
      projectAlias: "River Cleanup",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/workspace/river-cleanup",
      aiKnowledgeSyncedAt: "2026-04-26T12:00:00.000Z",
      activationRequirementsMet: true,
      emails: [
        {
          id: "alias:river",
          address: "river@adventurescientists.org",
          isPrimary: true,
          signature: "Warmly,\nThe River Cleanup Team\nAdventure Scientists"
        }
      ]
    }
  };
}

interface RenderSession {
  readonly cleanup: () => Promise<void>;
  readonly container: HTMLDivElement;
  readonly rerender: (nextElement: ReactElement) => Promise<void>;
  readonly root: Root;
}

let activeSession: RenderSession | null = null;

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
  routerRefresh.mockReset();
  actionMocks.activateProjectFromWizardAction.mockReset();
  actionMocks.pollProjectKnowledgeBootstrapAction.mockReset();
  actionMocks.syncProjectKnowledgeForActivationAction.mockReset();
  actionMocks.updateProjectAiKnowledgeAction.mockReset();
  vi.useRealTimers();
});

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function invokeTimerHandler(
  handler: TimerHandler,
  args: readonly unknown[]
): void {
  if (typeof handler === "function") {
    (handler as (...handlerArgs: readonly unknown[]) => void)(...args);
    return;
  }

  throw new TypeError("String timers are not supported in tests.");
}

function setDomGlobals(window: Window & typeof globalThis) {
  const entries = {
    document: window.document,
    Element: window.Element,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    KeyboardEvent: window.KeyboardEvent,
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

  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: window.getComputedStyle.bind(window),
    writable: true
  });

  window.requestAnimationFrame = (((callback: FrameRequestCallback) => {
    return globalThis.setTimeout(() => {
      callback(Date.now());
    }, 16);
  }) as unknown) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (((handle: number) => {
    globalThis.clearTimeout(handle);
  }) as unknown) as typeof window.cancelAnimationFrame;
  window.setTimeout = (((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    return globalThis.setTimeout(() => {
      invokeTimerHandler(handler, args);
    }, timeout);
  }) as unknown) as typeof window.setTimeout;
  window.clearTimeout = (((handle?: number) => {
    globalThis.clearTimeout(handle);
  }) as unknown) as typeof window.clearTimeout;
  window.setInterval = (((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    return globalThis.setInterval(() => {
      invokeTimerHandler(handler, args);
    }, timeout);
  }) as unknown) as typeof window.setInterval;
  window.clearInterval = (((handle?: number) => {
    globalThis.clearInterval(handle);
  }) as unknown) as typeof window.clearInterval;
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined
  })) as typeof window.matchMedia;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

async function renderIntoDom(element: ReactElement): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/"
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  return {
    container,
    root,
    rerender: async (nextElement) => {
      await act(async () => {
        root.render(nextElement);
        await Promise.resolve();
      });
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      dom.window.close();
    }
  };
}

async function mount(element: ReactElement): Promise<RenderSession> {
  const session = await renderIntoDom(element);
  activeSession = session;
  return session;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function exactTextCount(container: HTMLElement, text: string): number {
  return Array.from(container.querySelectorAll("*")).filter((element) => {
    return normalizeText(element.textContent) === text;
  }).length;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => normalizeText(element.textContent) === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function findInputByPlaceholder(
  container: HTMLElement,
  placeholder: string
): HTMLInputElement {
  const input = container.querySelector(
    `input[placeholder="${placeholder}"]`
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found: ${placeholder}`);
  }

  return input;
}

function findTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("Textarea not found");
  }

  return textarea;
}

function getText(container: HTMLElement): string {
  return normalizeText(container.textContent);
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
        cancelable: true
      })
    );
    await Promise.resolve();
  });
}

async function typeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    throw new Error("Element is detached from a document");
  }

  const prototype =
    element instanceof view.HTMLTextAreaElement
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set !== undefined) {
    descriptor.set.call(element, value);
  }

  await act(async () => {
    element.dispatchEvent(new view.Event("input", { bubbles: true }));
    element.dispatchEvent(new view.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function reachAliasesStep(container: HTMLElement) {
  await click(findButton(container, "River Cleanup"));
  await click(findButton(container, "Continue"));
}

async function addPrimaryAlias(container: HTMLElement, address: string) {
  await typeValue(
    findInputByPlaceholder(container, "project@adventurescientists.org"),
    address
  );
  await click(findButton(container, "Add"));
}

async function reachSignatureStep(container: HTMLElement) {
  await reachAliasesStep(container);
  await addPrimaryAlias(container, "river@adventurescientists.org");
  await click(findButton(container, "Continue"));
}

async function reachKnowledgeStep(container: HTMLElement) {
  await reachSignatureStep(container);
  await click(findButton(container, "Continue"));
}

async function reachReviewStep(container: HTMLElement) {
  vi.useFakeTimers();
  actionMocks.syncProjectKnowledgeForActivationAction.mockResolvedValue({
    ok: true,
    requestId: "request-sync",
    data: {
      runId: "run-1"
    }
  });
  actionMocks.pollProjectKnowledgeBootstrapAction
    .mockResolvedValueOnce({
      ok: true,
      requestId: "request-poll-1",
      data: {
        status: "running",
        errorMessage: null
      }
    })
    .mockResolvedValueOnce({
      ok: true,
      requestId: "request-poll-2",
      data: {
        status: "done",
        errorMessage: null
      }
    });

  await reachKnowledgeStep(container);
  await typeValue(
    findInputByPlaceholder(
      container,
      "https://www.notion.so/your-workspace/Page-Name"
    ),
    "https://www.notion.so/workspace/river-cleanup"
  );
  await click(findButton(container, "Sync now"));
  await flushEffects();
  await advanceTimers(1_000);
  await advanceTimers(1_000);
  await click(findButton(container, "Continue"));
}

describe("settings activation wizard", () => {
  it("renders the wizard shell with the stepper and checklist", async () => {
    const onClose = vi.fn();
    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose,
        inactiveProjects
      })
    );

    const text = getText(container);
    expect(text).toContain("Pick project");
    expect(text).toContain("Inbox aliases");
    expect(text).toContain("Email signature");
    expect(text).toContain("AI knowledge");
    expect(text).toContain("Review & activate");
    expect(text).toContain("Activation checklist");
    expect(text).toContain("Alias set");
  });

  it("moves from Step 1 to Step 2 and auto-fills the alias from suggestedAlias", async () => {
    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await click(findButton(container, "River Cleanup"));

    expect(
      findInputByPlaceholder(container, "e.g. Butternut").value
    ).toBe("River Cleanup");
    expect(findButton(container, "Continue").disabled).toBe(false);

    await click(findButton(container, "Continue"));

    expect(getText(container)).toContain("Routing addresses");
  });

  it("validates Step 2, rejects duplicate aliases, and keeps exactly one primary", async () => {
    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await reachAliasesStep(container);

    expect(findButton(container, "Continue").disabled).toBe(true);

    await addPrimaryAlias(container, "river@adventurescientists.org");
    expect(findButton(container, "Continue").disabled).toBe(false);

    await typeValue(
      findInputByPlaceholder(container, "project@adventurescientists.org"),
      "river@adventurescientists.org"
    );
    await click(findButton(container, "Add"));
    expect(getText(container)).toContain("Each inbox alias must be unique.");

    await typeValue(
      findInputByPlaceholder(container, "project@adventurescientists.org"),
      "cleanup@adventurescientists.org"
    );
    await click(findButton(container, "Add"));
    await click(findButton(container, "Make primary"));

    expect(exactTextCount(container, "Primary")).toBe(1);
  });

  it("pre-fills the Step 3 signature template from the alias", async () => {
    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await reachSignatureStep(container);

    expect(findTextarea(container).value).toBe(
      "Warmly,\nThe River Cleanup Team\nAdventure Scientists"
    );
  });

  it("completes the Step 4 sync flow and enables Continue only after done", async () => {
    vi.useFakeTimers();
    actionMocks.syncProjectKnowledgeForActivationAction.mockResolvedValue({
      ok: true,
      requestId: "request-sync",
      data: {
        runId: "run-1"
      }
    });
    actionMocks.pollProjectKnowledgeBootstrapAction
      .mockResolvedValueOnce({
        ok: true,
        requestId: "request-poll-1",
        data: {
          status: "running",
          errorMessage: null
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: "request-poll-2",
        data: {
          status: "done",
          errorMessage: null
        }
      });

    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await reachKnowledgeStep(container);
    await typeValue(
      findInputByPlaceholder(
        container,
        "https://www.notion.so/your-workspace/Page-Name"
      ),
      "https://www.notion.so/workspace/river-cleanup"
    );
    await click(findButton(container, "Sync now"));
    await flushEffects();

    expect(findButton(container, "Continue").disabled).toBe(true);

    await advanceTimers(1_000);
    expect(findButton(container, "Continue").disabled).toBe(true);

    await advanceTimers(1_000);
    expect(getText(container)).toContain("Synced. Ready to activate.");
    expect(findButton(container, "Continue").disabled).toBe(false);
  });

  it("shows the Step 4 timeout state after roughly two minutes", async () => {
    vi.useFakeTimers();
    actionMocks.syncProjectKnowledgeForActivationAction.mockResolvedValue({
      ok: true,
      requestId: "request-sync",
      data: {
        runId: "run-1"
      }
    });
    actionMocks.pollProjectKnowledgeBootstrapAction.mockResolvedValue({
      ok: true,
      requestId: "request-poll",
      data: {
        status: "running",
        errorMessage: null
      }
    });

    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await reachKnowledgeStep(container);
    await typeValue(
      findInputByPlaceholder(
        container,
        "https://www.notion.so/your-workspace/Page-Name"
      ),
      "https://www.notion.so/workspace/river-cleanup"
    );
    await click(findButton(container, "Sync now"));
    await flushEffects();
    await advanceTimers(125_000);

    expect(getText(container)).toContain("Sync is still running");
    expect(findButton(container, "Close")).toBeDefined();
  });

  it("re-syncs automatically on Step 4 when reopening a project with synced knowledge", async () => {
    actionMocks.syncProjectKnowledgeForActivationAction.mockResolvedValue({
      ok: true,
      requestId: "request-sync",
      data: {
        runId: "run-resume"
      }
    });

    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects,
        initialProjectId: "project:trail"
      })
    );

    await click(findButton(container, "Continue"));
    await click(findButton(container, "Continue"));
    await click(findButton(container, "Continue"));
    await flushEffects();

    expect(
      actionMocks.syncProjectKnowledgeForActivationAction
    ).toHaveBeenCalledWith(
      "project:trail",
      "https://www.notion.so/workspace/trail-restore"
    );
    expect(getText(container)).toContain("Syncing your Notion page...");
  });

  it("activates on Step 5 and renders the success state without closing", async () => {
    actionMocks.activateProjectFromWizardAction.mockResolvedValue(
      buildActivationResult()
    );
    const onClose = vi.fn();
    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose,
        inactiveProjects
      })
    );

    await reachReviewStep(container);
    await click(findButton(container, "Activate project"));
    await flushEffects();

    expect(getText(container)).toContain("River Cleanup is live");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces activation errors inline and stays on Step 5", async () => {
    actionMocks.activateProjectFromWizardAction.mockResolvedValue({
      ok: false,
      code: "alias_collision",
      message: "An inbox alias is already taken by another project.",
      requestId: "request-error",
      fieldErrors: {
        aliases: "An inbox alias is already taken by another project."
      }
    });

    const { container } = await mount(
      createElement(ActivationWizard, {
        open: true,
        onClose: vi.fn(),
        inactiveProjects
      })
    );

    await reachReviewStep(container);
    await click(findButton(container, "Activate project"));
    await flushEffects();

    expect(getText(container)).toContain(
      "An inbox alias is already taken by another project."
    );
    expect(getText(container)).toContain("What happens on activate");
  });

  it("hides activation CTAs for non-admin users", async () => {
    const { container } = await mount(
      createElement(ProjectsSection, {
        viewModel: buildProjectsViewModel(false)
      })
    );

    expect(getText(container)).not.toContain("Activate a project");
    expect(getText(container)).not.toContain("Activate ->");
  });
});
