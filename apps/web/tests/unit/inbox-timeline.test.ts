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

import {
  InboxTimeline,
  shouldHideAutomatedRowBody,
} from "../../app/inbox/_components/inbox-timeline";

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

  it("keeps campaign email body text visible when the row is collapsed", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:campaign-email-1",
            kind: "outbound-campaign-email" as const,
            subject: null,
            body: "Please review the latest field update.",
          },
        ],
        volunteerFirstName: "Alice",
      }),
    );

    expect(markup).toContain("Campaign Email");
    expect(markup).toContain("Please review the latest field update.");
  });

  it("only hides automated email body text while a subject-bearing row is collapsed", () => {
    expect(
      shouldHideAutomatedRowBody({
        isExpanded: false,
        kind: "outbound-auto-email",
        headline: "Training details",
      }),
    ).toBe(true);
    expect(
      shouldHideAutomatedRowBody({
        isExpanded: true,
        kind: "outbound-auto-email",
        headline: "Training details",
      }),
    ).toBe(false);
    expect(
      shouldHideAutomatedRowBody({
        isExpanded: false,
        kind: "outbound-campaign-email",
        headline: "April field update",
      }),
    ).toBe(false);
    expect(
      shouldHideAutomatedRowBody({
        isExpanded: false,
        kind: "outbound-auto-email",
        headline: null,
      }),
    ).toBe(false);
  });
});
