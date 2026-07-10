import { createRequire } from "node:module";

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const unlayerHostMock = vi.hoisted(() => vi.fn());
const prepareUploadedHtmlMock = vi.hoisted(() => vi.fn());

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  ArrowRight: () => null,
  Braces: () => null,
  Info: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: React.ReactNode;
    readonly href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    return (props: {
      readonly onReadyChange?: (ready: boolean) => void;
      readonly savedDesign: unknown;
    }) => {
      unlayerHostMock(props);
      return (
        <div
          data-unlayer-host="true"
          data-saved-design={JSON.stringify(props.savedDesign)}
        />
      );
    };
  },
}));

vi.mock("@as-comms/domain/html-import", () => ({
  prepareUploadedHtml: prepareUploadedHtmlMock,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    readonly children: React.ReactNode;
    readonly onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/app/inbox/_components/composer-toolbar", () => ({
  ComposerToolbar: () => <div data-toolbar="true" />,
}));

vi.mock("@/app/inbox/_components/composer-editor-surface", () => ({
  RichTextComposerEditor: ({
    bodyPlaintext,
    toolbarFooter,
  }: {
    readonly bodyPlaintext: string;
    readonly toolbarFooter?: (input: {
      readonly activeCommands: ReadonlySet<string>;
      readonly onCommand: (command: string) => void;
      readonly insertText: (value: string) => void;
    }) => React.ReactNode;
  }) => (
    <div>
      <div data-editor="true">{bodyPlaintext}</div>
      {toolbarFooter
        ? toolbarFooter({
            activeCommands: new Set<string>(),
            onCommand: () => undefined,
            insertText: () => undefined,
          })
        : null}
    </div>
  ),
}));

import { ComposeStep } from "../../app/broadcasts/new/_components/compose-step";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    },
  ) => {
    readonly window: Window & typeof globalThis;
  };
};

let root: Root | null = null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts/new",
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.File = dom.window.File;
  globalThis.Event = dom.window.Event;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.DOMParser = dom.window.DOMParser;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function renderComposeStep(
  overrides: Partial<React.ComponentProps<typeof ComposeStep>> = {},
) {
  if (root === null) {
    throw new Error("root not initialized");
  }

  const props: React.ComponentProps<typeof ComposeStep> = {
    ...baseProps,
    ...overrides,
  };

  act(() => {
    root?.render(<ComposeStep {...props} />);
  });

  return props;
}

function readReactProps(element: Element): Record<string, unknown> {
  const propsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  );

  if (propsKey === undefined) {
    throw new Error("React props handle not found on element.");
  }

  return ((element as unknown as Record<string, unknown>)[propsKey] ??
    {}) as Record<string, unknown>;
}

const baseProps: React.ComponentProps<typeof ComposeStep> = {
  launchType: "normal_email",
  subject: "",
  preheader: "",
  bodyPlaintext: "",
  bodyHtml: "",
  savedDesign: null,
  selectedAliasSignature: "",
  frozen: false,
  onSubjectChange: () => undefined,
  onPreheaderChange: () => undefined,
  onBodyChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

beforeEach(() => {
  prepareUploadedHtmlMock.mockReset();
  unlayerHostMock.mockClear();
  setupDom();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  document.body.innerHTML = "";
  root = null;
});

describe("ComposeStep snapshots", () => {
  it("renders the compact compose state without inline preview", () => {
    const markup = renderToStaticMarkup(<ComposeStep {...baseProps} />);

    expect(markup).toMatchSnapshot();
    expect(markup).toContain("Write your email");
    expect(markup).not.toContain("Live Preview");
    expect(markup).not.toContain("Next sample contact");
  });

  it("rehydrates the upload textarea from persisted bodyHtml on mount", () => {
    const uploaded =
      "<!doctype html><html><body><p>Corals survey CTA</p></body></html>";
    const markup = renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="html_email"
        savedDesign={null}
        bodyHtml={uploaded}
      />,
    );

    // Upload-mode paste box is seeded with the persisted HTML (was empty before
    // the fix — the "lost file" symptom when returning to this step).
    expect(markup).toContain("campaign-html-paste");
    expect(markup).toContain("&lt;p&gt;Corals survey CTA&lt;/p&gt;");
    expect(markup).toContain("{{firstName}}");
    expect(markup).toContain("{{projectName}}");
    expect(markup).toContain("{{aliasEmail}}");
  });

  it("renders populated subject and body controls", () => {
    expect(
      renderToStaticMarkup(
        <ComposeStep
          {...baseProps}
          subject="Gear pickup for {{firstName}}"
          preheader="Everything you need for tomorrow."
          bodyPlaintext={
            "Hi {{firstName}},\n\nSee you at the warehouse.\n\nBest,\nAS"
          }
        />,
      ),
    ).toMatchSnapshot();
  });

  it("renders the markdown composer for normal_email", () => {
    const markup = renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="normal_email"
        bodyPlaintext="Hi"
      />,
    );

    expect(markup).toContain('data-editor="true"');
    expect(markup).not.toContain('data-unlayer-host="true"');
  });

  it("renders the SMS composer without email-only fields", () => {
    const markup = renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="sms"
        bodyPlaintext="Hi {{firstName}}"
      />,
    );

    expect(markup).toContain("Write your SMS");
    // Merge tokens are insertable chips, not typed hint text.
    expect(markup).toContain("Insert:");
    expect(markup).toContain("{{email}}");
    expect(markup).toContain("Reply STOP to opt out");
    expect(markup).toContain("GSM-7");
    expect(markup).toContain("chars");
    expect(markup).not.toContain('id="campaign-subject"');
    expect(markup).not.toContain('id="campaign-preheader"');
  });

  it("gates SMS continue on a non-empty body only", () => {
    const emptyMarkup = renderToStaticMarkup(
      <ComposeStep {...baseProps} launchType="sms" bodyPlaintext="   " />,
    );
    const validMarkup = renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="sms"
        bodyPlaintext="Hello there"
      />,
    );

    expect(emptyMarkup).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
    expect(validMarkup).not.toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
  });

  it("renders the Unlayer host, merge tags, and media-library link for html_email", () => {
    const markup = renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="html_email"
        subject="Newsletter"
        bodyPlaintext="Fallback text"
        bodyHtml="<p>Fallback text</p>"
      />,
    );

    expect(markup).toContain('data-unlayer-host="true"');
    expect(markup).toContain("Design in editor");
    expect(markup).toContain("Upload HTML");
    expect(markup).toContain("{{firstName}}");
    expect(markup).toContain("{{projectName}}");
    expect(markup).toContain("{{aliasEmail}}");
    expect(markup).toContain('href="/broadcasts/media"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("passes savedDesign through to the Unlayer host", () => {
    const savedDesign = { body: { rows: [{ id: "row-1" }] } };

    renderToStaticMarkup(
      <ComposeStep
        {...baseProps}
        launchType="html_email"
        subject="Newsletter"
        bodyPlaintext="Fallback text"
        bodyHtml="<p>Fallback text</p>"
        savedDesign={savedDesign}
      />,
    );

    expect(unlayerHostMock).toHaveBeenCalled();
    expect(unlayerHostMock.mock.lastCall?.[0]).toMatchObject({ savedDesign });
  });
});

describe("ComposeStep HTML upload mode", () => {
  it("switches from the editor to the upload UI", () => {
    renderComposeStep({
      launchType: "html_email",
      subject: "Newsletter",
      bodyPlaintext: "Fallback text",
      bodyHtml: "<p>Fallback text</p>",
    });

    expect(document.body.innerHTML).toContain('data-unlayer-host="true"');

    const uploadTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Upload HTML",
    );
    if (!(uploadTab instanceof HTMLButtonElement)) {
      throw new Error("Upload HTML toggle not found");
    }

    act(() => {
      uploadTab.click();
    });

    expect(document.body.innerHTML).not.toContain('data-unlayer-host="true"');
    expect(
      document.querySelector('input[type="file"][accept=".html,text/html"]'),
    ).not.toBeNull();
    expect(
      document.querySelector("textarea#campaign-html-paste"),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("{{firstName}}");
    expect(document.body.textContent).toContain("{{projectName}}");
    expect(document.body.textContent).toContain("{{aliasEmail}}");
  });

  it("processes pasted html through prepareUploadedHtml, shows warnings, and clears design json", () => {
    const onBodyChange = vi.fn();
    prepareUploadedHtmlMock.mockReturnValue({
      html: "<!doctype html><html><body><p>Converted</p></body></html>",
      warnings: ["Keep an eye on merge tags.", "Remove the old footer."],
    });

    renderComposeStep({
      launchType: "html_email",
      subject: "Newsletter",
      bodyPlaintext: "",
      bodyHtml: "",
      onBodyChange,
    });

    const uploadTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Upload HTML",
    );
    if (!(uploadTab instanceof HTMLButtonElement)) {
      throw new Error("Upload HTML toggle not found");
    }

    act(() => {
      uploadTab.click();
    });

    const textarea = document.querySelector("textarea#campaign-html-paste");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("HTML paste textarea not found");
    }

    const textareaProps = readReactProps(textarea);
    if (typeof textareaProps.onChange !== "function") {
      throw new Error("Textarea onChange handler not found");
    }

    act(() => {
      (
        textareaProps.onChange as (event: {
          readonly currentTarget: { readonly value: string };
        }) => void
      )({
        currentTarget: {
          value: "<html><body><p>Raw upload</p></body></html>",
        },
      });
    });

    expect(prepareUploadedHtmlMock).toHaveBeenCalledWith(
      "<html><body><p>Raw upload</p></body></html>",
    );
    expect(onBodyChange).toHaveBeenCalledWith({
      bodyDesignJson: null,
      bodyPlaintext: "Converted",
      bodyHtml: "<!doctype html><html><body><p>Converted</p></body></html>",
    });
    expect(document.body.textContent).toContain("Import warnings");
    expect(document.body.textContent).toContain("Keep an eye on merge tags.");
    expect(document.body.textContent).toContain("Remove the old footer.");
  });

  it("processes uploaded files through prepareUploadedHtml", async () => {
    const onBodyChange = vi.fn();
    prepareUploadedHtmlMock.mockReturnValue({
      html: "<html><body><p>Uploaded from file</p></body></html>",
      warnings: [],
    });

    renderComposeStep({
      launchType: "html_email",
      subject: "Newsletter",
      bodyPlaintext: "",
      bodyHtml: "",
      onBodyChange,
    });

    const uploadTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Upload HTML",
    );
    if (!(uploadTab instanceof HTMLButtonElement)) {
      throw new Error("Upload HTML toggle not found");
    }

    act(() => {
      uploadTab.click();
    });

    const fileInput = document.querySelector(
      'input[type="file"]#campaign-html-file',
    );
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("HTML file input not found");
    }

    const file = new File(["ignored"], "newsletter.html", {
      type: "text/html",
    });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () =>
        Promise.resolve("<html><body><p>File upload</p></body></html>"),
    });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(prepareUploadedHtmlMock).toHaveBeenCalledWith(
      "<html><body><p>File upload</p></body></html>",
    );
    expect(onBodyChange).toHaveBeenCalledWith({
      bodyDesignJson: null,
      bodyPlaintext: "Uploaded from file",
      bodyHtml: "<html><body><p>Uploaded from file</p></body></html>",
    });
    const textarea = document.querySelector("textarea#campaign-html-paste");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("HTML paste textarea not found after file upload");
    }

    expect(textarea.value).toBe(
      "<html><body><p>Uploaded from file</p></body></html>",
    );
  });
});
