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

vi.mock("../../app/inbox/_components/composer-send-from-chip", () => ({
  ComposerSendFromChip: () => createElement("div", null, "Alias picker"),
}));

vi.mock("../../app/inbox/_components/about-this-draft", () => ({
  AboutThisDraft: () => null,
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
  }: {
    readonly bodyPlaintext: string;
    readonly onChange: (value: {
      readonly bodyPlaintext: string;
      readonly bodyHtml: string;
    }) => void;
  }) =>
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
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("../../app/inbox/_components/icons", () => ({
  AlertCircleIcon: iconMock("AlertCircle"),
  ChevronDownIcon: iconMock("ChevronDown"),
  LoaderIcon: iconMock("Loader"),
  MailIcon: iconMock("Mail"),
  NoteIcon: iconMock("Note"),
  PaperclipIcon: iconMock("Paperclip"),
  SendIcon: iconMock("Send"),
  XIcon: iconMock("X"),
}));

import { ComposerEmailSurface } from "../../app/inbox/_components/composer-detail-surfaces";

type ComposerEmailSurfaceProps = React.ComponentProps<typeof ComposerEmailSurface>;

const baseProps: ComposerEmailSurfaceProps = {
  composerAliases: [
    {
      id: "alias-1",
      alias: "coastal@example.org",
      projectId: "project-1",
      projectName: "Coastal Survey",
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
  selectedAliasAiReady: true,
  selectedAliasProjectName: "Coastal Survey",
  aiWarningMessage: null,
  inlineError: null,
  canSendAndSaveForAi: true,
  sendAndSaveDisabledReason: null,
  isSendDisabled: false,
  isSending: false,
  isAboutOpen: false,
  onAboutOpenChange: vi.fn(),
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
  onOpenReprompt: vi.fn(),
  onCancelReprompt: vi.fn(),
  onApproveAi: vi.fn(),
  onRunAiDraft: vi.fn(),
  onRepromptTextChange: vi.fn(),
  onReprompt: vi.fn(),
  onAttachmentClick: vi.fn(),
  onAttachmentRemove: vi.fn(),
  onSaveDraft: vi.fn(),
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
});
