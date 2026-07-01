import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const addEventListenerMock = vi.hoisted(() => vi.fn());
const loadDesignMock = vi.hoisted(() => vi.fn());
const exportHtmlMock = vi.hoisted(() => vi.fn());
const exportPlainTextMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

vi.mock("lucide-react", () => ({
  AlertOctagon: () => null,
  AlertTriangle: () => null,
  Download: () => null,
  Info: () => null,
  RefreshCw: () => null,
  X: () => null,
}));

vi.mock("react-email-editor", () => {
  const MockEmailEditor = React.forwardRef(function MockEmailEditor(
    props: {
      readonly onLoad?: (editor: {
        addEventListener: typeof addEventListenerMock;
        exportHtml: typeof exportHtmlMock;
        exportPlainText: typeof exportPlainTextMock;
        loadDesign: typeof loadDesignMock;
      }) => void;
      readonly onReady?: (editor: {
        addEventListener: typeof addEventListenerMock;
        exportHtml: typeof exportHtmlMock;
        exportPlainText: typeof exportPlainTextMock;
        loadDesign: typeof loadDesignMock;
      }) => void;
    },
    ref: React.ForwardedRef<{
      editor: {
        addEventListener: typeof addEventListenerMock;
        exportHtml: typeof exportHtmlMock;
        exportPlainText: typeof exportPlainTextMock;
        loadDesign: typeof loadDesignMock;
      };
    }>,
  ) {
    const editor = React.useMemo(
      () => ({
        addEventListener: addEventListenerMock,
        exportHtml: exportHtmlMock,
        exportPlainText: exportPlainTextMock,
        loadDesign: loadDesignMock,
      }),
      [],
    );

    React.useImperativeHandle(ref, () => ({ editor }), [editor]);

    React.useEffect(() => {
      props.onLoad?.(editor);
      props.onReady?.(editor);
    }, [editor, props]);

    return <div data-email-editor="true" />;
  });

  return { default: MockEmailEditor };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ComponentProps<"button"> & { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

import { UnlayerHost } from "../../app/broadcasts/new/_components/unlayer-host";
import type { UnlayerHostHandle } from "../../app/broadcasts/new/_components/unlayer-host";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    },
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

let root: Root | null = null;
let domWindow: (Window & typeof globalThis & { close: () => void }) | null =
  null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts/new",
    pretendToBeVisual: true,
  });

  domWindow = dom.window;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteTextMock,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.Blob = dom.window.Blob;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  return container;
}

async function settleEditor() {
  await act(async () => {
    vi.runOnlyPendingTimers();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  addEventListenerMock.mockReset();
  loadDesignMock.mockReset();
  exportHtmlMock.mockReset();
  exportPlainTextMock.mockReset();
  clipboardWriteTextMock.mockReset();
  setupDom();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  root = null;
  document.body.innerHTML = "";
  domWindow?.close();
  domWindow = null;
});

describe("UnlayerHost", () => {
  it("exposes the current design json through the host handle", async () => {
    const rawDesign = {
      body: {
        rows: [
          {
            id: "row-custom",
            columns: [
              {
                contents: [
                  {
                    id: "text-custom",
                    type: "text",
                    values: { text: "<p>Hello</p>" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    exportHtmlMock.mockImplementation((callback: (data: unknown) => void) => {
      callback({ design: rawDesign, html: "<p>Hello</p>" });
    });
    exportPlainTextMock.mockImplementation(
      (callback: (data: { text: string }) => void) => {
        callback({ text: "Hello" });
      },
    );

    const onSave = vi.fn();
    const onReadyChange = vi.fn();
    const container = document.body.lastElementChild;
    const hostRef = React.createRef<UnlayerHostHandle>();

    if (!(container instanceof HTMLElement)) {
      throw new Error("Expected test container.");
    }

    act(() => {
      root?.render(
        <UnlayerHost
          ref={hostRef}
          savedDesign={null}
          onSave={onSave}
          onReadyChange={onReadyChange}
        />,
      );
    });

    await settleEditor();

    const exportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.includes("Export design (JSON)"),
    );

    expect(exportButton).toBeTruthy();
    if (!exportButton || !domWindow) {
      throw new Error("Expected export button and JSDOM window.");
    }

    expect(loadDesignMock).toHaveBeenCalled();

    const exportedDesign = (await hostRef.current?.getDesignJson()) as {
      readonly body?: { readonly rows?: readonly { readonly id?: string }[] };
    };

    expect(exportButton.textContent).toContain("Export design (JSON)");
    expect(exportedDesign.body?.rows?.map((row) => row.id)).toContain("row-custom");
  });
});
