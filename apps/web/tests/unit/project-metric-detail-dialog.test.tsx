import { createRequire } from "node:module";
import React, { act } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProjectMetricContacts = vi.hoisted(() => vi.fn());

vi.mock("../../app/inbox/actions", () => ({
  loadProjectMetricContacts,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    readonly children: React.ReactNode;
    readonly open: boolean;
  }) => (open ? <div data-dialog-root="true">{children}</div> : null),
  DialogContent: ({
    children,
    className,
  }: {
    readonly children: React.ReactNode;
    readonly className?: string;
  }) => (
    <div className={className} role="dialog">
      {children}
    </div>
  ),
  DialogTitle: ({
    children,
    className,
  }: {
    readonly children: React.ReactNode;
    readonly className?: string;
  }) => <h2 className={className}>{children}</h2>,
  DialogDescription: ({
    children,
    className,
  }: {
    readonly children: React.ReactNode;
    readonly className?: string;
  }) => <p className={className}>{children}</p>,
  DialogClose: ({
    children,
    className,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button className={className} onClick={onClick} type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: ({
    initials,
  }: {
    readonly initials: string;
  }) => <span data-avatar-initials={initials}>{initials}</span>,
}));

vi.mock("../../app/inbox/_components/icons", () => ({
  XIcon: (props: Record<string, unknown>) => <svg data-icon="x" {...props} />,
}));

import { ProjectMetricDetailDialog } from "../../app/inbox/_components/project-metric-detail-dialog";

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
  readonly rerender: (
    overrides?: Partial<React.ComponentProps<typeof ProjectMetricDetailDialog>>,
  ) => Promise<void>;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function buildProps(
  overrides: Partial<React.ComponentProps<typeof ProjectMetricDetailDialog>> = {},
): React.ComponentProps<typeof ProjectMetricDetailDialog> {
  return {
    open: overrides.open ?? true,
    onOpenChange: overrides.onOpenChange ?? vi.fn(),
    onOpenContact: overrides.onOpenContact ?? vi.fn(),
    projectId: overrides.projectId ?? "project:alpha",
    projectName: overrides.projectName ?? "Alpha Research",
    metricKey: overrides.metricKey ?? "signups",
    metricLabel: overrides.metricLabel ?? "New Signups",
    totalForDescription: overrides.totalForDescription ?? 23,
  };
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ProjectMetricDetailDialog>> = {},
): RenderSession {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  let props = buildProps(overrides);

  const renderCurrent = async () => {
    await act(async () => {
      root.render(<ProjectMetricDetailDialog {...props} />);
      await Promise.resolve();
    });
  };

  void renderCurrent();

  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      dom.window.close();
    },
    rerender: async (nextOverrides = {}) => {
      props = buildProps({
        ...props,
        ...nextOverrides,
      });
      await renderCurrent();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
  loadProjectMetricContacts.mockReset();
});

afterEach(() => {
  vi.useRealTimers();

  if (activeSession !== null) {
    activeSession.cleanup();
    activeSession = null;
  }
});

describe("ProjectMetricDetailDialog", () => {
  it("does not render dialog content when closed", async () => {
    activeSession = renderDialog({ open: false, projectId: null, metricKey: null });
    await activeSession.rerender();

    expect(activeSession.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders the dialog header title when opened", async () => {
    loadProjectMetricContacts.mockResolvedValue({ rows: [] });
    activeSession = renderDialog();
    await activeSession.rerender();

    expect(activeSession.container.textContent).toContain(
      "Alpha Research · New Signups · last 7 days",
    );
    expect(activeSession.container.textContent).toContain("23 people signed up");
  });

  it("shows loading skeletons before rows replace them", async () => {
    const pending = deferred<{
      readonly rows: readonly [
        {
          readonly contactId: string;
          readonly name: string | null;
          readonly email: string | null;
          readonly occurredAt: string;
        },
      ];
    }>();
    loadProjectMetricContacts.mockReturnValue(pending.promise);
    activeSession = renderDialog();
    await activeSession.rerender();

    expect(activeSession.container.querySelectorAll(".animate-pulse")).toHaveLength(24);

    pending.resolve({
      rows: [
        {
          contactId: "contact:alpha",
          name: "Alpha Person",
          email: "alpha@example.org",
          occurredAt: "2026-05-07T09:00:00.000Z",
        },
      ],
    });

    await act(async () => {
      await pending.promise;
      await Promise.resolve();
    });

    expect(activeSession.container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(activeSession.container.textContent).toContain("Alpha Person");
  });

  it("falls back from name to email to unknown contact", async () => {
    loadProjectMetricContacts.mockResolvedValue({
      rows: [
        {
          contactId: "contact:email-only",
          name: null,
          email: "x@y.org",
          occurredAt: "2026-05-06T08:00:00.000Z",
        },
        {
          contactId: "contact:unknown",
          name: null,
          email: null,
          occurredAt: "2026-05-05T08:00:00.000Z",
        },
      ],
    });
    activeSession = renderDialog();
    await activeSession.rerender();

    expect(activeSession.container.textContent).toContain("x@y.org");
    expect(activeSession.container.textContent).toContain("Unknown contact");
  });

  it("calls onOpenContact and closes when a row is clicked", async () => {
    const onOpenContact = vi.fn();
    const onOpenChange = vi.fn();
    loadProjectMetricContacts.mockResolvedValue({
      rows: [
        {
          contactId: "contact:alpha",
          name: "Alpha Person",
          email: "alpha@example.org",
          occurredAt: "2026-05-07T09:00:00.000Z",
        },
      ],
    });
    activeSession = renderDialog({
      onOpenContact,
      onOpenChange,
    });
    await activeSession.rerender();

    const rowButton = Array.from(
      activeSession.container.querySelectorAll("button"),
    ).find((element) => element.textContent.includes("Alpha Person"));

    if (rowButton === undefined) {
      throw new Error("Expected metric contact row button");
    }

    act(() => {
      rowButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenContact).toHaveBeenCalledWith("contact:alpha");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores stale responses when a newer open request replaces them", async () => {
    const first = deferred<{
      readonly rows: readonly [
        {
          readonly contactId: string;
          readonly name: string | null;
          readonly email: string | null;
          readonly occurredAt: string;
        },
      ];
    }>();
    const second = deferred<{
      readonly rows: readonly [
        {
          readonly contactId: string;
          readonly name: string | null;
          readonly email: string | null;
          readonly occurredAt: string;
        },
      ];
    }>();

    loadProjectMetricContacts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    activeSession = renderDialog({
      projectId: "project:alpha",
      metricKey: "signups",
      metricLabel: "New Signups",
    });
    await activeSession.rerender();

    await activeSession.rerender({
      projectId: "project:beta",
      projectName: "Beta Research",
      metricKey: "trainingCompletions",
      metricLabel: "Training Completions",
    });

    first.resolve({
      rows: [
        {
          contactId: "contact:stale",
          name: "Stale Person",
          email: "stale@example.org",
          occurredAt: "2026-05-06T09:00:00.000Z",
        },
      ],
    });

    await act(async () => {
      await first.promise;
      await Promise.resolve();
    });

    expect(activeSession.container.textContent).not.toContain("Stale Person");

    second.resolve({
      rows: [
        {
          contactId: "contact:fresh",
          name: "Fresh Person",
          email: "fresh@example.org",
          occurredAt: "2026-05-07T09:30:00.000Z",
        },
      ],
    });

    await act(async () => {
      await second.promise;
      await Promise.resolve();
    });

    expect(activeSession.container.textContent).not.toContain("Stale Person");
    expect(activeSession.container.textContent).toContain("Fresh Person");
  });
});
