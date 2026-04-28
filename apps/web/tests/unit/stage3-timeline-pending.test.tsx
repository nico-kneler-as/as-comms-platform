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

vi.mock("@/app/_lib/design-tokens-v2", () => ({
  FOCUS_RING:
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
  RADIUS: {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
  },
  SPACING: {
    section: "px-5 py-4",
  },
  SHADOW: {
    sm: "shadow-sm",
  },
  TYPE: {
    micro: "text-xs",
    bodySerifSm: "text-[13.5px]",
    label: "text-[10px]",
  },
  TRANSITION: {
    fast: "transition-colors",
    reduceMotion: "motion-reduce:transition-none",
  },
  TONE_CLASSES: {
    amber: {
      subtle: "bg-amber-50",
      text: "text-amber-700",
    },
    emerald: {
      subtle: "bg-emerald-50",
      text: "text-emerald-700",
    },
    sky: {
      subtle: "bg-sky-50",
      text: "text-sky-700",
    },
    slate: {
      subtle: "bg-slate-50",
      text: "text-slate-700",
    },
    violet: {
      subtle: "bg-violet-50",
      text: "text-violet-700",
    },
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
    fromHeader: null,
    toHeader: "volunteer@example.org",
    ccHeader: null,
    mailbox: "field@adventuresci.org",
    threadId: "gmail-thread-1",
    rfc822MessageId: null,
    inReplyToRfc822: "parent-message-id",
    sendStatus: "pending",
    failedReason: null,
    failedDetail: null,
    attachmentCount: 0,
    attachments: [],
    campaignActivity: [],
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

  it("renders the bounce-specific failure banner for bounced replies", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          buildEntry({
            sendStatus: "failed",
            failedReason: "bounce",
            failedDetail: "550 5.1.1 user unknown",
          }),
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
        onRetryPending: vi.fn(),
      }),
    );

    expect(markup).toContain(
      "Your last reply to this contact bounced"
    );
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
