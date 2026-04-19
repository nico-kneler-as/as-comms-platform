import { afterEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

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
  },
}));

import { InboxTimeline } from "../../app/inbox/_components/inbox-timeline";

const baseEntry = {
  id: "timeline:auto-email-1",
  kind: "outbound-auto-email" as const,
  occurredAt: "2026-04-16T12:30:00.000Z",
  occurredAtLabel: "2h ago",
  actorLabel: "Salesforce Flow",
  subject: "Training details",
  body: "Thanks for signing up. Bring your field notebook.",
  channel: "email" as const,
  isUnread: false,
  isPreview: true,
};

describe("InboxTimeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps auto-email rows collapsed to the subject line by default", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [baseEntry],
        volunteerFirstName: "Alice",
      }),
    );

    expect(markup).toContain("Training details");
    expect(markup).not.toContain(
      "Thanks for signing up. Bring your field notebook.",
    );
  });
});
