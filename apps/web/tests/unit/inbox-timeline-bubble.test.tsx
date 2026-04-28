import { describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
  FileDocIcon: () => createElement("svg"),
  LoaderIcon: () => createElement("svg"),
  MailIcon: () => createElement("svg"),
  PhoneIcon: () => createElement("svg"),
  RefreshCwIcon: () => createElement("svg"),
}));

import { MessageBubble } from "../../app/inbox/_components/inbox-timeline-bubble";
import type { InboxTimelineEntryViewModel } from "../../app/inbox/_lib/view-models";

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

describe("MessageBubble attachments", () => {
  it("matches the no-attachment render", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, {
        entry: buildEntry(),
        direction: "inbound",
      }),
    );

    expect(markup).toMatchInlineSnapshot(
      "\"<link rel=\\\"preload\\\" as=\\\"image\\\" href=\\\"\\\"/><li class=\\\"flex w-full flex-col items-start pr-16\\\"><div class=\\\"flex w-full items-start gap-2.5 justify-start\\\"><div class=\\\"mt-2 shrink-0\\\"><div>SM</div></div><div class=\\\"min-w-0 w-full max-w-[640px] overflow-hidden rounded-xl shadow-sm border border-slate-200 bg-white\\\"><div>participants</div><div class=\\\"px-4 py-3\\\"><p class=\\\"mb-1.5 text-balance text-[14px] font-semibold text-slate-900 break-words [overflow-wrap:anywhere]\\\">Photo update</p><p class=\\\"whitespace-pre-wrap text-pretty text-[14px] leading-relaxed text-slate-700 break-words [overflow-wrap:anywhere]\\\">See attached.</p></div></div></div><div class=\\\"mt-1.5 flex items-center gap-1.5 px-1 text-xs\\\"><svg></svg><span class=\\\"font-medium text-slate-500\\\">Sarah Martinez</span></div></li>\"",
    );
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
    expect(markup).toContain("88.9 KB");
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
