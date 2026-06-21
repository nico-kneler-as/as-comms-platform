import { createRequire } from "node:module";
import { act, createElement } from "react";
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

vi.mock("../../app/inbox/actions", () => ({
  draftWithAiAction: vi.fn(),
}));

import { draftWithAiAction } from "../../app/inbox/actions";
import {
  useToolbarPolish,
  type PolishPhase,
} from "../../app/inbox/_hooks/use-toolbar-polish";
import {
  INITIAL_COMPOSER_DRAFT_STATE,
  type ComposerDraftAction,
  type ComposerDraftState,
} from "../../app/inbox/_hooks/composer-draft-reducer";

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
    HTMLDivElement: w.HTMLDivElement,
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

function setup(input?: { readonly state?: Partial<ComposerDraftState> }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const dispatch = vi.fn((action: ComposerDraftAction) => {
    switch (action.type) {
      case "SET_BODY":
        currentState = {
          ...currentState,
          body: action.body,
          bodyHtml: action.bodyHtml,
        };
        break;
      case "SET_SMS_BODY":
        currentState = {
          ...currentState,
          smsBody: action.body,
        };
        break;
      default:
        break;
    }
  });
  const setComposerErrors = vi.fn();
  let currentState: ComposerDraftState = {
    ...INITIAL_COMPOSER_DRAFT_STATE,
    activeTab: "email",
    body: "Original email body",
    bodyHtml: "<p>Original email body</p>",
    smsBody: "Original SMS body",
    recipient: {
      kind: "contact",
      contactId: "contact-1",
      displayName: "Ada Lovelace",
      primaryEmail: "ada@example.org",
      primaryProjectName: "Forest",
      salesforceContactId: "sf-1",
    },
    smsRecipient: {
      kind: "contact",
      contactId: "contact-sms-1",
      displayName: "Maya Lee",
      phoneE164: "+14065550123",
    },
    ...input?.state,
  };
  const controls: {
    phase: PolishPhase;
    disabled: boolean;
    runPolish: () => void;
    undo: () => void;
  } = {
    phase: "idle",
    disabled: true,
    runPolish: () => undefined,
    undo: () => undefined,
  };

  function Harness() {
    const hook = useToolbarPolish({
      state: currentState,
      dispatch,
      selectedAliasRecord: {
        id: "alias-1",
        alias: "forest@adventuresci.org",
        projectId: "project-1",
        projectName: "Forest",
        signature: "Best,\nForest Team",
        isAiReady: true,
        isAiConfigured: true,
        hasCachedContent: true,
      },
      selectedAliasAiConfigured: true,
      replyContext: {
        contactId: "contact-1",
        contactDisplayName: "Ada Lovelace",
        contactPrimaryPhone: "+14065550123",
        subject: "Re: Forest dates",
        threadCursor: "thread-cursor-1",
        threadId: "thread-1",
        inReplyToRfc822: "<message@example.org>",
        defaultAlias: "forest@adventuresci.org",
        cc: [],
      },
      composerPaneMode: "replying",
      setComposerErrors,
      startAiTransition: (callback) => {
        void callback();
      },
    });

    controls.phase = hook.phase;
    controls.disabled = hook.isPolishDisabled;
    controls.runPolish = hook.runPolish;
    controls.undo = hook.undo;
    return null;
  }

  const render = () => {
    act(() => {
      root.render(createElement(Harness));
    });
  };

  render();

  return {
    dispatch,
    setComposerErrors,
    getPhase: () => controls.phase,
    getDisabled: () => controls.disabled,
    runPolish: async () => {
      act(() => {
        controls.runPolish();
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    undo: () => {
      act(() => {
        controls.undo();
      });
    },
    rerender(nextState: Partial<ComposerDraftState>) {
      currentState = { ...currentState, ...nextState };
      render();
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useToolbarPolish", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("runPolish is a no-op when body is empty", async () => {
    const harness = setup({ state: { body: "   " } });

    await harness.runPolish();

    expect(draftWithAiAction).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("dispatches a polish-mode request and applies the polished email body", async () => {
    vi.mocked(draftWithAiAction).mockResolvedValue({
      ok: true,
      data: { draft: "Polished email body" },
    } as never);
    const harness = setup();

    await harness.runPolish();

    expect(draftWithAiAction).toHaveBeenCalledWith({
      contactId: "contact-1",
      projectId: "project-1",
      intent: "reply",
      threadCursor: "thread-cursor-1",
      channel: "email",
      mode: "polish",
      operatorBody: "Original email body",
      operatorPrompt: null,
    });
    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "SET_BODY",
      body: "Polished email body",
      bodyHtml: "<p>Polished email body</p>",
    });
    expect(harness.getPhase()).toBe("done");
    harness.unmount();
  });

  it("returns to idle when the operator edits the polished body", async () => {
    vi.mocked(draftWithAiAction).mockResolvedValue({
      ok: true,
      data: { draft: "Polished email body" },
    } as never);
    const harness = setup();

    await harness.runPolish();
    harness.rerender({ body: "Operator changed it" });

    expect(harness.getPhase()).toBe("idle");
    harness.unmount();
  });

  it("undo restores the previous email body", async () => {
    vi.mocked(draftWithAiAction).mockResolvedValue({
      ok: true,
      data: { draft: "Polished email body" },
    } as never);
    const harness = setup();

    await harness.runPolish();
    harness.undo();

    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "SET_BODY",
      body: "Original email body",
      bodyHtml: "<p>Original email body</p>",
    });
    expect(harness.getPhase()).toBe("idle");
    harness.unmount();
  });

  it("surfaces errors and leaves the body untouched", async () => {
    vi.mocked(draftWithAiAction).mockResolvedValue({
      ok: false,
      message: "Polish failed",
    } as never);
    const harness = setup();

    await harness.runPolish();

    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "SET_INLINE_ERROR",
      error: {
        message: "Polish failed",
        retryable: false,
      },
    });
    expect(harness.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SET_BODY",
        body: "Polished email body",
      }),
    );
    expect(harness.getPhase()).toBe("idle");
    harness.unmount();
  });

  it("uses sms body for polish and undo restores sms body", async () => {
    vi.mocked(draftWithAiAction).mockResolvedValue({
      ok: true,
      data: { draft: "Polished sms body" },
    } as never);
    const harness = setup({
      state: {
        activeTab: "sms",
      },
    });

    await harness.runPolish();

    expect(draftWithAiAction).toHaveBeenCalledWith({
      contactId: "contact-sms-1",
      projectId: "project-1",
      intent: "reply",
      threadCursor: "thread-cursor-1",
      channel: "sms",
      mode: "polish",
      operatorBody: "Original SMS body",
      operatorPrompt: null,
    });
    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "SET_SMS_BODY",
      body: "Polished sms body",
    });

    harness.undo();

    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "SET_SMS_BODY",
      body: "Original SMS body",
    });
    harness.unmount();
  });
});
