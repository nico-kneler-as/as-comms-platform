import { createRequire } from "node:module";
import React, {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputEvent as ReactInputEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("lucide-react", () => ({
  AlertCircle: iconMock("AlertCircle"),
  AlertTriangle: iconMock("AlertTriangle"),
  ArrowRight: iconMock("ArrowRight"),
  ArrowUpRight: iconMock("ArrowUpRight"),
  Bold: iconMock("Bold"),
  Bot: iconMock("Bot"),
  Calendar: iconMock("Calendar"),
  Check: iconMock("Check"),
  CheckCircle2: iconMock("CheckCircle2"),
  ChevronDown: iconMock("ChevronDown"),
  ChevronRight: iconMock("ChevronRight"),
  ChevronUp: iconMock("ChevronUp"),
  Clock: iconMock("Clock"),
  CornerUpLeft: iconMock("CornerUpLeft"),
  Database: iconMock("Database"),
  Eye: iconMock("Eye"),
  FileIcon: iconMock("FileIcon"),
  FileText: iconMock("FileText"),
  Flag: iconMock("Flag"),
  Image: iconMock("Image"),
  Inbox: iconMock("Inbox"),
  Italic: iconMock("Italic"),
  Link: iconMock("Link"),
  List: iconMock("List"),
  ListOrdered: iconMock("ListOrdered"),
  Loader2: iconMock("Loader2"),
  LogOut: iconMock("LogOut"),
  Mail: iconMock("Mail"),
  MailOpen: iconMock("MailOpen"),
  MapPin: iconMock("MapPin"),
  Megaphone: iconMock("Megaphone"),
  MousePointerClick: iconMock("MousePointerClick"),
  PanelRightClose: iconMock("PanelRightClose"),
  PanelRightOpen: iconMock("PanelRightOpen"),
  Paperclip: iconMock("Paperclip"),
  Pencil: iconMock("Pencil"),
  Phone: iconMock("Phone"),
  Quote: iconMock("Quote"),
  RefreshCw: iconMock("RefreshCw"),
  RotateCcw: iconMock("RotateCcw"),
  RotateCw: iconMock("RotateCw"),
  Save: iconMock("Save"),
  Search: iconMock("Search"),
  SearchX: iconMock("SearchX"),
  Send: iconMock("Send"),
  Settings: iconMock("Settings"),
  SlidersHorizontal: iconMock("SlidersHorizontal"),
  Sparkles: iconMock("Sparkles"),
  Trash2: iconMock("Trash2"),
  Upload: iconMock("Upload"),
  Wand2: iconMock("Wand2"),
  WifiOff: iconMock("WifiOff"),
  X: iconMock("X"),
  XCircle: iconMock("XCircle"),
  Zap: iconMock("Zap"),
}));

vi.mock("@/app/_components/adventure-scientists-logo", () => ({
  AdventureScientistsLogo: (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": "AdventureScientistsLogo", ...props }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open,
  }: {
    readonly children: ReactNode;
    readonly open?: boolean;
  }) => createElement("div", { "data-popover-open": String(open) }, children),
  PopoverAnchor: ({ children }: { readonly children: ReactNode }) =>
    createElement(React.Fragment, null, children),
  PopoverContent: ({ children }: { readonly children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    readonly children: ReactNode;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
  }) =>
    open
      ? createElement(
          "div",
          { "data-dialog-root": "true" },
          createElement(
            "button",
            {
              "aria-label": "Composer overlay",
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "overlay",
          ),
          children,
        )
      : null,
  DialogContent: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("div", { className, role: "dialog" }, children),
  DialogTitle: ({
    children,
    className,
  }: {
    readonly children: ReactNode;
    readonly className?: string;
  }) => createElement("h2", { className }, children),
}));

vi.mock("../../app/inbox/actions", () => ({
  createNoteAction: vi.fn(),
  draftWithAiAction: vi.fn(),
  searchContactsAction: vi.fn(),
  sendComposerAction: vi.fn(),
}));

vi.mock("../../app/inbox/_components/composer-detail-surfaces", () => ({
  ComposerEmailSurface: ({
    attachments,
    body,
    onBodyChange,
    onCancel,
    onRecipientChange,
    onSubjectChange,
    recipient,
    subject,
  }: {
    readonly attachments: readonly { readonly filename: string }[];
    readonly body: string;
    readonly onBodyChange: (value: {
      readonly bodyPlaintext: string;
      readonly bodyHtml: string;
    }) => void;
    readonly onCancel: () => void;
    readonly onRecipientChange: (
      recipient: {
        readonly kind: "email";
        readonly emailAddress: string;
      } | null,
    ) => void;
    readonly onSubjectChange: (value: string) => void;
    readonly recipient:
      | { readonly kind: "email"; readonly emailAddress: string }
      | { readonly kind: "contact"; readonly displayName: string }
      | null;
    readonly subject: string;
  }) =>
    createElement(
      "div",
      { "data-testid": "email-surface" },
      createElement("input", {
        "aria-label": "Recipient",
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const value = event.currentTarget.value.trim();
          onRecipientChange(
            value.length > 0 ? { kind: "email", emailAddress: value } : null,
          );
        },
        onInput: (event: ReactInputEvent<HTMLInputElement>) => {
          const value = event.currentTarget.value.trim();
          onRecipientChange(
            value.length > 0 ? { kind: "email", emailAddress: value } : null,
          );
        },
        value:
          recipient?.kind === "email"
            ? recipient.emailAddress
            : recipient?.kind === "contact"
              ? recipient.displayName
              : "",
      } satisfies InputHTMLAttributes<HTMLInputElement>),
      createElement("input", {
        "aria-label": "Subject",
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          onSubjectChange(event.currentTarget.value);
        },
        onInput: (event: ReactInputEvent<HTMLInputElement>) => {
          onSubjectChange(event.currentTarget.value);
        },
        value: subject,
      } satisfies InputHTMLAttributes<HTMLInputElement>),
      createElement("textarea", {
        "aria-label": "Message body",
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
          const value = event.currentTarget.value;
          onBodyChange({
            bodyPlaintext: value,
            bodyHtml: `<p>${value}</p>`,
          });
        },
        onInput: (event: ReactInputEvent<HTMLTextAreaElement>) => {
          const value = event.currentTarget.value;
          onBodyChange({
            bodyPlaintext: value,
            bodyHtml: `<p>${value}</p>`,
          });
        },
        value: body,
      } satisfies TextareaHTMLAttributes<HTMLTextAreaElement>),
      createElement(
        "ul",
        { "aria-label": "Attachments" },
        attachments.map((attachment) =>
          createElement(
            "li",
            { key: attachment.filename },
            attachment.filename,
          ),
        ),
      ),
      createElement("button", { onClick: onCancel, type: "button" }, "Cancel"),
    ),
  ComposerNoteSurface: ({
    body,
    onBodyChange,
  }: {
    readonly body: string;
    readonly onBodyChange: (value: string) => void;
  }) =>
    createElement("textarea", {
      "aria-label": "Internal note body",
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
        onBodyChange(event.currentTarget.value);
      },
      onInput: (event: ReactInputEvent<HTMLTextAreaElement>) => {
        onBodyChange(event.currentTarget.value);
      },
      value: body,
    } satisfies TextareaHTMLAttributes<HTMLTextAreaElement>),
}));

import type { InboxComposerAliasOption } from "../../app/inbox/_lib/view-models";
import {
  InboxClientProvider,
  useInboxClient,
} from "../../app/inbox/_components/inbox-client-provider";
import { InboxKeyboardProvider } from "../../app/inbox/_components/inbox-keyboard-provider";
import { InboxWorkspace } from "../../app/inbox/_components/inbox-workspace";

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

const composerAliases: readonly InboxComposerAliasOption[] = [
  {
    id: "alias:whitebark",
    alias: "whitebark@adventurescientists.org",
    projectId: "project:whitebark",
    projectName: "Whitebark Pine",
    isAiReady: true,
  },
];

const replyContext = {
  contactId: "contact:maya",
  contactDisplayName: "Maya Lee",
  subject: "Trip logistics",
  threadCursor: "event:inbound-1",
  threadId: "thread:gmail-1",
  inReplyToRfc822: "message:gmail-1",
  defaultAlias: "whitebark@adventurescientists.org",
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
  routerPush.mockReset();
  routerRefresh.mockReset();
});

function invokeTimerHandler(
  handler: TimerHandler,
  args: readonly unknown[],
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
    File: window.File,
    FileReader: window.FileReader,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    KeyboardEvent: window.KeyboardEvent,
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
  window.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    return globalThis.setTimeout(() => {
      invokeTimerHandler(handler, args);
    }, timeout);
  }) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((handle?: number) => {
    globalThis.clearTimeout(handle);
  }) as unknown as typeof window.clearTimeout;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

function ComposerControls() {
  const {
    closeComposer,
    composerPane,
    composerView,
    expandComposer,
    minimizeComposer,
    openNewDraft,
    openReplyDraft,
  } = useInboxClient();

  return (
    <div>
      <button type="button" onClick={openNewDraft}>
        Open new draft
      </button>
      <button
        type="button"
        onClick={() => {
          openReplyDraft(replyContext);
        }}
      >
        Open reply draft
      </button>
      <button
        type="button"
        onClick={() => {
          openReplyDraft(replyContext, "note");
        }}
      >
        Open note draft
      </button>
      <button type="button" onClick={minimizeComposer}>
        Minimize from context
      </button>
      <button type="button" onClick={expandComposer}>
        Expand from context
      </button>
      <button type="button" onClick={closeComposer}>
        Close from context
      </button>
      <output data-testid="composer-state">
        {composerPane.mode}:{composerView}
      </output>
    </div>
  );
}

function TestApp() {
  return (
    <InboxClientProvider
      composerAliases={composerAliases}
      currentActorId="user:operator"
    >
      <InboxKeyboardProvider>
        <InboxWorkspace>
          <section data-testid="underlying-conversation">
            Conversation remains visible
          </section>
          <ComposerControls />
        </InboxWorkspace>
      </InboxKeyboardProvider>
    </InboxClientProvider>
  );
}

async function mount(element: ReactElement): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  const session = {
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
  activeSession = session;
  return session;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected a clickable element.");
  }

  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function changeValue(element: Element | null, value: string) {
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    throw new Error("Expected an input or textarea.");
  }

  await act(async () => {
    const valueDescriptor = Object.getOwnPropertyDescriptor(element, "value");
    const prototypeValueDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement,
      "value",
    );

    if (
      prototypeValueDescriptor?.set &&
      prototypeValueDescriptor.set !== valueDescriptor?.set
    ) {
      prototypeValueDescriptor.set.call(element, value);
    } else if (valueDescriptor?.set) {
      valueDescriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function getByText(text: string): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
    (candidate) => candidate.textContent.trim() === text,
  );

  if (!element) {
    throw new Error(`Unable to find text: ${text}`);
  }

  return element;
}

function getStateText(): string {
  return (
    document.querySelector<HTMLOutputElement>("[data-testid='composer-state']")
      ?.textContent ?? ""
  );
}

function getInput(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label='${label}']`,
  );

  if (!input) {
    throw new Error(`Unable to find input: ${label}`);
  }

  return input;
}

function getTextarea(label: string): HTMLTextAreaElement {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label='${label}']`,
  );

  if (!textarea) {
    throw new Error(`Unable to find textarea: ${label}`);
  }

  return textarea;
}

async function attachFile(filename: string) {
  const fileInput =
    document.querySelector<HTMLInputElement>("input[type='file']");

  if (!fileInput) {
    throw new Error("Unable to find attachment input.");
  }

  const file = new File(["attachment-body"], filename, {
    type: "text/plain",
  });

  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [file],
  });

  await act(async () => {
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  });
}

describe("composer canonical modal", () => {
  it("opens new drafts in a Dialog over the existing workspace", async () => {
    await mount(<TestApp />);

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[role='region']")).toBeNull();

    await click(getByText("Open new draft"));

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(
      document.querySelector("[data-testid='underlying-conversation']"),
    ).not.toBeNull();
    expect(getStateText()).toBe("new-draft:modal");
    expect(document.body.textContent).toContain("New message");
  });

  it("opens reply and note entry points in the same modal state machine", async () => {
    await mount(<TestApp />);

    await click(getByText("Open reply draft"));
    expect(getStateText()).toBe("replying:modal");
    expect(document.body.textContent).toContain("Re: Trip logistics");
    expect(getInput("Recipient").value).toBe("Maya Lee");

    await click(document.querySelector("button[aria-label='Close composer']"));
    await click(getByText("Open note draft"));

    expect(getStateText()).toBe("replying:modal");
    expect(document.body.textContent).toContain("Note");
    expect(getTextarea("Internal note body").value).toBe("");
  });

  it("minimizes to a pill and expands back to the modal", async () => {
    await mount(<TestApp />);

    await click(getByText("Open new draft"));
    await click(
      document.querySelector("button[aria-label='Minimize composer']"),
    );

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[role='region']")).not.toBeNull();
    expect(getStateText()).toBe("new-draft:pill");

    await click(document.querySelector("button[aria-label='Expand composer']"));

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.querySelector("[role='region']")).toBeNull();
    expect(getStateText()).toBe("new-draft:modal");
  });

  it("preserves draft fields and attachments across minimize and expand", async () => {
    await mount(<TestApp />);

    await click(getByText("Open new draft"));
    await changeValue(getInput("Recipient"), "partner@example.org");
    await changeValue(getInput("Subject"), "Field kit");
    await changeValue(getTextarea("Message body"), "Please bring the kit.");
    await attachFile("field-kit.txt");
    await flushReact();

    expect(document.body.textContent).toContain("field-kit.txt");

    await click(
      document.querySelector("button[aria-label='Minimize composer']"),
    );
    await click(document.querySelector("button[aria-label='Expand composer']"));

    expect(getInput("Recipient").value).toBe("partner@example.org");
    expect(getInput("Subject").value).toBe("Field kit");
    expect(getTextarea("Message body").value).toBe("Please bring the kit.");
    expect(document.body.textContent).toContain("field-kit.txt");
  });

  it("closes from the modal header and from the minimized pill", async () => {
    await mount(<TestApp />);

    await click(getByText("Open new draft"));
    await click(document.querySelector("button[aria-label='Close composer']"));

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[role='region']")).toBeNull();
    expect(getStateText()).toBe("closed:closed");

    await click(getByText("Open new draft"));
    await click(
      document.querySelector("button[aria-label='Minimize composer']"),
    );
    await click(document.querySelector("button[aria-label='Close composer']"));

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[role='region']")).toBeNull();
    expect(getStateText()).toBe("closed:closed");
  });

  it("minimizes on Escape and overlay click instead of closing", async () => {
    await mount(<TestApp />);

    await click(getByText("Open new draft"));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      await Promise.resolve();
    });

    expect(getStateText()).toBe("new-draft:pill");
    expect(document.querySelector("[role='region']")).not.toBeNull();

    await click(document.querySelector("button[aria-label='Expand composer']"));
    await click(
      document.querySelector("button[aria-label='Composer overlay']"),
    );

    expect(getStateText()).toBe("new-draft:pill");
    expect(document.querySelector("[role='region']")).not.toBeNull();
  });
});
