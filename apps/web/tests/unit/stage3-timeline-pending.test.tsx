import { afterEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InboxTimelineEntryViewModel } from "../../app/inbox/_lib/view-models";

Object.assign(globalThis, { React });

vi.mock("../../app/inbox/actions", () => ({
  updateNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
}));

vi.mock("@/components/ui/divider-label", () => ({
  DividerLabel: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("span", null, children),
}));

vi.mock("@/app/_lib/design-tokens", () => ({
  RADIUS: {
    bubble: "rounded-2xl",
    md: "rounded-xl",
  },
  SHADOW: {
    sm: "shadow-sm",
  },
  TEXT: {
    bodySm: "text-sm",
    micro: "text-xs",
  },
  TONE: {
    amber: {
      subtle: "bg-amber-50",
    },
  },
  TRANSITION: {
    fast: "transition-colors",
    reduceMotion: "motion-reduce:transition-none",
  },
}));

import { InboxTimeline } from "../../app/inbox/_components/inbox-timeline";

function buildEntry(
  overrides: Partial<InboxTimelineEntryViewModel> = {},
): InboxTimelineEntryViewModel {
  return {
    id: "pending-outbound:pending-1",
    kind: "outbound-email",
    occurredAt: "2026-04-21T16:00:00.000Z",
    occurredAtLabel: "Just now",
    actorLabel: "Operator",
    subject: "Checking in",
    body: "Wanted to follow up before Friday.",
    channel: "email",
    isUnread: false,
    isPreview: false,
    mailbox: "field@adventuresci.org",
    threadId: "gmail-thread-1",
    rfc822MessageId: null,
    inReplyToRfc822: "parent-message-id",
    sendStatus: "pending",
    attachmentCount: 0,
    ...overrides,
  };
}

describe("stage3 pending timeline rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders pending outbound rows in a sending state", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [buildEntry()],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("Sending...");
    expect(markup).toContain("Checking in");
  });

  it("renders a retry affordance for failed outbound rows", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [buildEntry({ sendStatus: "failed" })],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
        onRetryPending: vi.fn(),
      }),
    );

    expect(markup).toContain("Send failed.");
    expect(markup).toContain("Retry");
  });

  it("disables retry when the failed row had attachments", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          buildEntry({
            sendStatus: "failed",
            attachmentCount: 2,
          }),
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
        onRetryPending: vi.fn(),
      }),
    );

    expect(markup).toContain("Retry");
    expect(markup).toContain("disabled");
  });
});
