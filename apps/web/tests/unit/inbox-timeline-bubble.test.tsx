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
