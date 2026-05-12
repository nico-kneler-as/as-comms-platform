import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";

Object.assign(globalThis, { React });

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", { "data-dialog": true }, children),
  DialogTrigger: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", { "data-dialog-trigger": true }, children),
  DialogContent: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", { "data-dialog-content": true }, children),
  DialogTitle: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", { "data-dialog-title": true }, children),
  DialogDescription: ({
    children,
  }: {
    readonly children?: React.ReactNode;
  }) => createElement("div", { "data-dialog-description": true }, children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", null, children),
  Tooltip: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", null, children),
  TooltipTrigger: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", null, children),
  TooltipContent: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/app/_lib/design-tokens-v2", () => ({
  SHADOW: { sm: "shadow-sm" },
  TRANSITION: {
    fast: "transition-colors",
    reduceMotion: "motion-reduce:transition-none",
  },
  TYPE: { micro: "text-xs" },
}));

vi.mock("../../app/inbox/_components/_autolink", () => ({
  autolinkText: (value: string) => value,
}));

vi.mock("../../app/inbox/_components/email-participant-header", () => ({
  EmailParticipantHeader: () => createElement("div", null, "participants"),
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: ({ initials }: { readonly initials: string }) =>
    createElement("div", null, initials),
}));

vi.mock("../../app/inbox/_components/icons", () => ({
  AdventureScientistsLogo: () => createElement("svg"),
  ArrowUpRightIcon: () => createElement("svg"),
  CornerUpLeftIcon: () => createElement("svg"),
  CornerUpRightIcon: () => createElement("svg"),
  FileDocIcon: () => createElement("svg"),
  LoaderIcon: () => createElement("svg"),
  MailIcon: () => createElement("svg"),
  PhoneIcon: () => createElement("svg"),
  RefreshCwIcon: () => createElement("svg"),
}));

import { MessageBubble } from "../../app/inbox/_components/inbox-timeline-bubble";
import type { InboxTimelineEntryViewModel } from "../../app/inbox/_lib/view-models";

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

function buildEntry(
  overrides: Partial<InboxTimelineEntryViewModel> = {},
): InboxTimelineEntryViewModel {
  return {
    id: "timeline:attachment-test",
    kind: "inbound-email",
    occurredAt: "2026-04-20T12:00:00.000Z",
    occurredAtLabel: "2h ago",
    actorLabel: "Sarah Martinez",
    subject: "Photo update",
    body: "See attached.",
    channel: "email",
    isUnread: false,
    isPreview: true,
    fromHeader: "Sarah Martinez <sarah@example.org>",
    toHeader: "Adventure Scientists <volunteers@example.org>",
    recipientLabel: null,
    ccHeader: null,
    mailbox: "volunteers@example.org",
    threadId: "thread-1",
    rfc822MessageId: "<message-1@example.org>",
    inReplyToRfc822: null,
    sendStatus: null,
    failedReason: null,
    failedDetail: null,
    attachmentCount: 0,
    attachments: [],
    campaignActivity: [],
    ...overrides,
  };
}

interface RenderSession {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly cleanup: () => Promise<void>;
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

async function mountBubble(
  entry: InboxTimelineEntryViewModel,
  direction: "inbound" | "outbound",
): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(MessageBubble, { entry, direction }));
    await Promise.resolve();
  });

  const cleanup = async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
    dom.window.close();
  };

  activeSession = { container, root, cleanup };
  return activeSession;
}

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
});

describe("MessageBubble attachments", () => {
  it("renders the body but no attachment chips when entry.attachments is empty", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry(),
        direction: "inbound",
      }),
    );

    // Body still renders.
    expect(markup).toContain("Photo update");
    expect(markup).toContain("See attached.");
    // No attachment chips, thumbnails, or proxy URLs at all.
    expect(markup).not.toContain("/api/attachments/");
    expect(markup).not.toContain("data-dialog-trigger");
    expect(markup).not.toContain("Download ");
  });

  it("renders image thumbnails and a download chip", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          attachmentCount: 3,
          attachments: [
            {
              id: "image-1",
              mimeType: "image/jpeg",
              filename: "field-photo.jpg",
              sizeBytes: 1234,
              proxyUrl: "/api/attachments/image-1",
            },
            {
              id: "image-2",
              mimeType: "image/png",
              filename: "map.png",
              sizeBytes: 5678,
              proxyUrl: "/api/attachments/image-2",
            },
            {
              id: "pdf-1",
              mimeType: "application/pdf",
              filename: "packet.pdf",
              sizeBytes: 91011,
              proxyUrl: "/api/attachments/pdf-1",
            },
          ],
        }),
        direction: "inbound",
      }),
    );

    expect(markup).toContain("/api/attachments/image-1");
    expect(markup).toContain("/api/attachments/image-2");
    expect(markup).toContain("Download packet.pdf");
    // formatBytes() rounds KB to whole numbers (composer convention).
    // 91011 / 1024 ≈ 88.88 → rounds to 89.
    expect(markup).toContain("89 KB");
  });

  it("falls back to Attachment when filename is null", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          attachmentCount: 1,
          attachments: [
            {
              id: "pdf-null",
              mimeType: "application/pdf",
              filename: null,
              sizeBytes: 2048,
              proxyUrl: "/api/attachments/pdf-null",
            },
          ],
        }),
        direction: "inbound",
      }),
    );

    expect(markup).toContain("Download Attachment");
    expect(markup).toContain(">Attachment<");
  });
});

describe("MessageBubble metadata and polish", () => {
  it("uses the shared gutter grid and full-width 560px email cap instead of padded rows", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          kind: "outbound-email",
          actorLabel: "You",
        }),
        direction: "outbound",
      }),
    );

    expect(markup).toContain("col-span-3 grid");
    expect(markup).toContain("grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]");
    expect(markup).toContain("col-start-2 min-w-0 flex justify-end");
    expect(markup.match(/w-full max-w-\[560px\]/g)).toHaveLength(2);
    expect(markup).not.toContain("w-fit");
    expect(markup).not.toContain("max-w-[640px]");
    expect(markup).not.toContain("pl-16");
    expect(markup).not.toContain("pr-16");
  });

  it("uses the shared 560px width for sms bubbles too", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          channel: "sms",
          kind: "inbound-sms",
          subject: null,
          fromHeader: null,
          toHeader: null,
          body: "SMS body",
        }),
        direction: "inbound",
      }),
    );

    expect(markup.match(/w-full max-w-\[560px\]/g)).toHaveLength(2);
    expect(markup).not.toContain("w-fit");
    expect(markup).not.toContain("max-w-[640px]");
  });

  it("hides the inbound metadata row for email bubbles", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          channel: "email",
          actorLabel: "Sarah Martinez",
        }),
        direction: "inbound",
      }),
    );

    expect(markup).toContain("participants");
    expect(markup).not.toContain("Sarah Martinez");
  });

  it("keeps the inbound metadata row for sms bubbles", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          channel: "sms",
          kind: "inbound-sms",
          subject: null,
          fromHeader: null,
          toHeader: null,
          body: "SMS body",
        }),
        direction: "inbound",
      }),
    );

    expect(markup).toContain("Sarah Martinez");
    expect(markup).toContain("SMS body");
  });

  it("renders forward and reply footer actions when both callbacks are provided", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry(),
        direction: "inbound",
        onForward: vi.fn(),
        onReply: vi.fn(),
      }),
    );

    expect(markup).toContain("Forward");
    expect(markup).toContain("Reply");
    expect(markup).toContain("group-hover:opacity-100");
  });

  it("renders the outbound brand avatar as dark-on-light without a ring", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry({
          kind: "outbound-email",
        }),
        direction: "outbound",
      }),
    );

    expect(markup).toContain("bg-white text-slate-900");
    expect(markup).not.toContain("ring-1");
  });
});

describe("MessageBubble read more", () => {
  it("clamps long plain-text bodies and expands permanently for the mount lifetime", async () => {
    const longBody = "Long message ".repeat(90);
    const session = await mountBubble(
      buildEntry({
        channel: "sms",
        kind: "inbound-sms",
        subject: null,
        fromHeader: null,
        toHeader: null,
        body: longBody,
      }),
      "inbound",
    );

    expect(session.container.textContent).toContain("Read more");
    expect(session.container.innerHTML).toContain("line-clamp-[10]");

    const button = session.container.querySelector("button");
    expect(button?.textContent).toBe("Read more");

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(session.container.textContent).not.toContain("Read more");
    expect(session.container.innerHTML).not.toContain("line-clamp-[10]");

    await act(async () => {
      window.dispatchEvent(new window.Event("blur"));
      window.dispatchEvent(new window.Event("scroll"));
      await Promise.resolve();
    });

    expect(session.container.textContent).not.toContain("Read more");
    expect(session.container.innerHTML).not.toContain("line-clamp-[10]");
  });

  it("renders unread long bodies fully expanded with no read-more affordance", async () => {
    const session = await mountBubble(
      buildEntry({
        body: "Unread body ".repeat(90),
        isUnread: true,
      }),
      "inbound",
    );

    expect(session.container.textContent).not.toContain("Read more");
    expect(session.container.innerHTML).not.toContain("line-clamp-[10]");
  });

  it("applies the same clamp behavior to sanitized html bodies", async () => {
    const session = await mountBubble(
      buildEntry({
        body: `<p>${"HTML body ".repeat(120)}</p>`,
      }),
      "inbound",
    );

    expect(session.container.textContent).toContain("Read more");
    expect(session.container.innerHTML).toContain("line-clamp-[10]");
  });
});
