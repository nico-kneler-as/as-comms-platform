import React, {
  act,
  createElement,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

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
    Element: w.Element,
    Event: w.Event,
    HTMLElement: w.HTMLElement,
    HTMLButtonElement: w.HTMLButtonElement,
    HTMLInputElement: w.HTMLInputElement,
    HTMLTextAreaElement: w.HTMLTextAreaElement,
    KeyboardEvent: w.KeyboardEvent,
    MouseEvent: w.MouseEvent,
    MutationObserver: w.MutationObserver,
    Node: w.Node,
    navigator: w.navigator,
    self: w,
    window: w,
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
    value: w.getComputedStyle.bind(w),
    writable: true,
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const DropdownMenuContext = React.createContext<{
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children: ReactNode }) =>
    createElement(React.Fragment, null, children),
  TooltipProvider: ({ children }: { readonly children: ReactNode }) =>
    createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { readonly children: ReactNode }) =>
    createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { readonly children: ReactNode }) =>
    createElement("div", { role: "tooltip" }, children),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: ReactNode }) => {
    const [open, setOpen] = useState(false);

    return createElement(
      DropdownMenuContext.Provider,
      { value: { open, setOpen } },
      children,
    );
  },
  DropdownMenuTrigger: ({
    children,
  }: {
    readonly children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    readonly asChild?: boolean;
  }) => {
    const context = useContext(DropdownMenuContext);
    if (context === null) {
      throw new Error("Expected dropdown menu context.");
    }

    return React.cloneElement(children, {
      onClick: (event) => {
        children.props.onClick?.(event);
        context.setOpen(!context.open);
      },
    });
  },
  DropdownMenuContent: ({
    children,
  }: {
    readonly children: ReactNode;
  }) => {
    const context = useContext(DropdownMenuContext);
    if (!context?.open) {
      return null;
    }

    return createElement("div", { role: "menu" }, children);
  },
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }) => {
    const context = useContext(DropdownMenuContext);
    if (context === null) {
      throw new Error("Expected dropdown menu context.");
    }

    return createElement(
      "button",
      {
        ...props,
        role: "menuitem",
        type: "button",
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          onSelect?.(event);
          if (!event.defaultPrevented) {
            context.setOpen(false);
          }
        },
      },
      children,
    );
  },
}));

vi.mock("../../app/inbox/_components/composer-ai-draft-window", () => ({
  ComposerAiDraftWindow: () => createElement("div", null, "AI draft window"),
}));

vi.mock("../../app/inbox/_components/composer-recipient-picker", () => ({
  ComposerRecipientPicker: () =>
    createElement("div", null, "Recipient picker"),
}));

vi.mock("../../app/inbox/_components/composer-sms-recipient-picker", () => ({
  ComposerSmsRecipientPicker: () =>
    createElement("div", null, "SMS recipient picker"),
}));

vi.mock("../../app/inbox/_components/composer-send-from-chip", () => ({
  ComposerSendFromChip: () => createElement("div", null, "Alias picker"),
}));

vi.mock("../../app/inbox/_components/composer-send-from-phone-chip", () => ({
  SendFromPhoneChip: () => createElement("div", null, "Phone alias picker"),
}));

vi.mock("../../app/inbox/_components/composer-editor-surface", () => ({
  AttachmentRow: () => null,
  ComposerField: ({
    children,
    label,
  }: {
    readonly children: ReactNode;
    readonly label: string;
  }) =>
    createElement(
      "label",
      null,
      createElement("span", null, label),
      children,
    ),
  InlineErrorBanner: ({
    message,
  }: {
    readonly message: string;
  }) => createElement("div", null, message),
  RichTextComposerEditor: ({
    bodyPlaintext,
    onChange,
    topSlot,
    bottomSlot,
    toolbarFooter,
  }: {
    readonly bodyPlaintext: string;
    readonly onChange: (value: {
      readonly bodyPlaintext: string;
      readonly bodyHtml: string;
    }) => void;
    readonly topSlot?: ReactNode;
    readonly bottomSlot?: ReactNode;
    readonly toolbarFooter?: (input: {
      readonly activeCommands: ReadonlySet<string>;
      readonly onCommand: (command: string) => void;
    }) => ReactNode;
  }) =>
    createElement(
      React.Fragment,
      null,
      topSlot ?? null,
      createElement("textarea", {
        "aria-label": "Message body",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          onChange({
            bodyPlaintext: event.currentTarget.value,
            bodyHtml: `<p>${event.currentTarget.value}</p>`,
          });
        },
        value: bodyPlaintext,
      } satisfies TextareaHTMLAttributes<HTMLTextAreaElement>),
      bottomSlot ?? null,
      toolbarFooter
        ? toolbarFooter({
            activeCommands: new Set<string>(),
            onCommand: () => undefined,
          })
        : null,
    ),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("../../app/inbox/_components/icons", () => ({
  AlertCircleIcon: iconMock("AlertCircle"),
  ArrowLeftIcon: iconMock("ArrowLeft"),
  BoldIcon: iconMock("Bold"),
  BookOpenIcon: iconMock("BookOpen"),
  ChevronDownIcon: iconMock("ChevronDown"),
  ImageIcon: iconMock("Image"),
  ItalicIcon: iconMock("Italic"),
  LinkIcon: iconMock("Link"),
  ListIcon: iconMock("List"),
  ListOrderedIcon: iconMock("ListOrdered"),
  LoaderIcon: iconMock("Loader"),
  MailIcon: iconMock("Mail"),
  NoteIcon: iconMock("Note"),
  PaperclipIcon: iconMock("Paperclip"),
  QuoteIcon: iconMock("Quote"),
  SendIcon: iconMock("Send"),
  XIcon: iconMock("X"),
}));

import {
  ComposerEmailSurface,
  ComposerSmsSurface,
} from "../../app/inbox/_components/composer-detail-surfaces";

type ComposerEmailSurfaceProps = React.ComponentProps<typeof ComposerEmailSurface>;
type ComposerSmsSurfaceProps = React.ComponentProps<typeof ComposerSmsSurface>;

const baseProps: ComposerEmailSurfaceProps = {
  composerAliases: [
    {
      id: "alias-1",
      alias: "coastal@example.org",
      projectId: "project-1",
      projectName: "Coastal Survey",
      signature: "Best,\nCoastal Survey",
      isAiReady: true,
    },
  ],
  selectedAlias: "coastal@example.org",
  recipient: {
    kind: "email" as const,
    emailAddress: "volunteer@example.org",
  },
  ccRecipients: [],
  bccRecipients: [],
  showCc: false,
  showBcc: false,
  isReplying: false,
  subject: "Subject",
  body: "Body",
  attachments: [],
  aiDraft: {
    status: "idle",
    channel: "email",
    mode: null,
    responseMode: null,
    prompt: "",
    generatedText: "",
    errorMessage: null,
    grounding: [],
    warnings: [],
    costEstimateUsd: null,
    draftId: null,
    repromptIndex: 0,
    repromptChain: [],
    promptPreview: "",
    model: null,
    lastRequest: null,
  },
  aiDirective: "",
  repromptText: "",
  isGeneratingAi: false,
  runAiDraftDisabled: false,
  runAiDraftDisabledReason: null,
  selectedAliasHasCachedContent: true,
  selectedAliasProjectName: "Coastal Survey",
  selectedAliasSignature: "Best,\nCoastal Survey",
  aiWarningMessage: null,
  inlineError: null,
  canSendAndSaveForAi: true,
  sendAndSaveDisabledReason: null,
  isSendDisabled: false,
  isSending: false,
  onAliasChange: vi.fn(),
  onRecipientChange: vi.fn(),
  onCcChange: vi.fn(),
  onBccChange: vi.fn(),
  onToggleCc: vi.fn(),
  onToggleBcc: vi.fn(),
  onSubjectChange: vi.fn(),
  onBodyChange: vi.fn(),
  onClearErrors: vi.fn(),
  onAiDirectiveChange: vi.fn(),
  onAiEdited: vi.fn(),
  onDiscardAi: vi.fn(),
  onEditPromptAi: vi.fn(),
  onOpenReprompt: vi.fn(),
  onCancelReprompt: vi.fn(),
  onApproveAi: vi.fn(),
  onRunAiDraft: vi.fn(),
  onRunPolish: vi.fn(),
  polishDisabled: true,
  polishDisabledReason: "Type a message below to polish it.",
  onRepromptTextChange: vi.fn(),
  onReprompt: vi.fn(),
  onAttachmentClick: vi.fn(),
  onAttachmentRemove: vi.fn(),
  onSaveDraft: vi.fn(),
  onSend: vi.fn(),
  onCancel: vi.fn(),
};

const baseSmsProps: ComposerSmsSurfaceProps = {
  smsSenders: [
    {
      id: "sender-1",
      phoneE164: "+14065550142",
      displayName: "Whitebark Pine",
    },
  ],
  smsEnabled: true,
  selectedSenderId: "sender-1",
  recipient: {
    kind: "contact" as const,
    contactId: "contact-1",
    displayName: "Maya Lee",
    phoneE164: "+15555550100",
  },
  lockedRecipient: false,
  body: "SMS body",
  segmentMetrics: {
    encoding: "GSM-7",
    length: 8,
    remaining: 152,
    segments: 1,
    segmentCap: 160,
  },
  aiDraft: baseProps.aiDraft,
  aiDirective: "",
  repromptText: "",
  isGeneratingAi: false,
  runAiDraftDisabled: false,
  runAiDraftDisabledReason: null,
  selectedAliasHasCachedContent: true,
  selectedAliasProjectName: "Coastal Survey",
  canSendAndSaveForAi: true,
  sendAndSaveDisabledReason: null,
  sendDisabledReason: null,
  inlineError: null,
  isSending: false,
  onRecipientChange: vi.fn(),
  onBodyChange: vi.fn(),
  onAiDirectiveChange: vi.fn(),
  onAiEdited: vi.fn(),
  onDiscardAi: vi.fn(),
  onEditPromptAi: vi.fn(),
  onOpenReprompt: vi.fn(),
  onCancelReprompt: vi.fn(),
  onApproveAi: vi.fn(),
  onRunAiDraft: vi.fn(),
  onRunPolish: vi.fn(),
  polishDisabled: true,
  polishDisabledReason: "Type a message below to polish it.",
  onRepromptTextChange: vi.fn(),
  onReprompt: vi.fn(),
  onSend: vi.fn(),
  onCancel: vi.fn(),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(
  overrides: Partial<ComposerEmailSurfaceProps> = {},
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<ComposerEmailSurface {...baseProps} {...overrides} />);
    await Promise.resolve();
  });
}

async function mountSms(
  overrides: Partial<ComposerSmsSurfaceProps> = {},
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<ComposerSmsSurface {...baseSmsProps} {...overrides} />);
    await Promise.resolve();
  });
}

async function click(target: Element | null): Promise<void> {
  if (!(target instanceof HTMLElement)) {
    throw new Error("Expected HTMLElement.");
  }

  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent.includes(name),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button: ${name}`);
  }

  return button;
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
  vi.clearAllMocks();
});

describe("composer send menu", () => {
  it("shows the grounded knowledge label when project knowledge is cached", async () => {
    await mount({
      selectedAliasHasCachedContent: true,
    });

    expect(document.body.textContent).toContain("Coastal Survey Knowledge Base");
    expect(document.body.textContent).not.toContain("Without Knowledge Base");
  });

  it("shows the soft knowledge indicator when project knowledge is not cached", async () => {
    await mount({
      selectedAliasHasCachedContent: false,
    });

    expect(document.body.textContent).toContain("Without Knowledge Base");
    expect(document.body.textContent).not.toContain("Coastal Survey Knowledge Base");
  });

  it("renders the selected alias signature below the editor and hides empty signatures", async () => {
    await mount({
      selectedAliasSignature: "Best,\nCoastal Survey",
    });

    const signature = document.querySelector(".whitespace-pre-line");
    expect(signature?.textContent).toBe("Best,\nCoastal Survey");

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    container?.remove();
    root = null;
    container = null;

    await mount({
      selectedAliasSignature: "",
    });

    expect(document.querySelector(".whitespace-pre-line")).toBeNull();
  });

  it("renders send options for send-and-save and save draft", async () => {
    const onSend = vi.fn();
    const onSaveDraft = vi.fn();

    await mount({
      onSend,
      onSaveDraft,
    });

    await click(document.querySelector("button[aria-label='Send options']"));

    expect(document.body.textContent).toContain("Send and save for AI");
    expect(document.body.textContent).toContain("Save draft");

    await click(getButton("Save draft"));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);

    await click(document.querySelector("button[aria-label='Send options']"));
    await click(getButton("Send and save for AI"));
    expect(onSend).toHaveBeenCalledWith("send-and-save");

    await click(getButton("Send"));
    expect(onSend).toHaveBeenCalledWith("send");
  });

  it("keeps send-and-save disabled when AI is not configured for the project", async () => {
    const onSend = vi.fn();

    await mount({
      canSendAndSaveForAi: false,
      sendAndSaveDisabledReason: "AI is not configured for this project.",
      onSend,
    });

    await click(document.querySelector("button[aria-label='Send options']"));

    const disabledItem = getButton("Send and save for AI");
    expect(disabledItem.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain(
      "AI is not configured for this project.",
    );

    await click(disabledItem);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not show SMS segment metrics in the default composer footer", async () => {
    await mountSms();

    expect(document.body.textContent).toContain("Add MMS");
    expect(document.body.textContent).toContain("Shorten links");
    expect(document.body.textContent).toContain("8/160");
    expect(document.body.textContent).not.toContain("segments");
    expect(document.body.textContent).not.toContain("GSM-7");
    expect(document.body.textContent).not.toContain("remaining");
    expect(document.body.textContent).not.toContain("Est.");
    expect(document.querySelector("button[aria-label='SMS send options']")).not.toBeNull();
  });

  it("shows an extended SMS character counter after 160 encoded characters", async () => {
    await mountSms({
      body: "a".repeat(161),
      segmentMetrics: {
        encoding: "GSM-7",
        length: 161,
        remaining: 145,
        segments: 2,
        segmentCap: 153,
      },
    });

    expect(document.body.textContent).toContain("161/320");
  });
});
