import { afterEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
    bodySerifSm: "text-[13.5px]",
    micro: "text-xs",
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

import {
  InboxTimeline,
  shouldHideAutomatedRowBody,
} from "../../app/inbox/_components/inbox-timeline";
import { classifySystemDivider } from "../../app/inbox/_components/inbox-timeline-system-divider";

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
  fromHeader: null,
  toHeader: null,
  ccHeader: null,
  mailbox: null,
  threadId: null,
  rfc822MessageId: null,
  inReplyToRfc822: null,
  sendStatus: null,
  failedReason: null,
  failedDetail: null,
  attachmentCount: 0,
  attachments: [],
  campaignActivity: [],
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
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("Training details");
    expect(markup).not.toContain(
      "Thanks for signing up. Bring your field notebook.",
    );
  });

  it("keeps campaign email rows collapsed to the resolved headline only", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:campaign-email-1",
            kind: "outbound-campaign-email" as const,
            subject: "Your Adventure Awaits",
            body: "Please review the latest field update.",
          },
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("Campaign");
    expect(markup).toContain("Your Adventure Awaits");
    expect(markup).not.toContain("Please review the latest field update.");
    expect(markup).not.toContain("rounded-full border px-2 py-1");
  });

  it("collapses consecutive automated and campaign rows into a count summary", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          baseEntry,
          {
            ...baseEntry,
            id: "timeline:auto-email-2",
            occurredAtLabel: "90m ago",
            subject: "Reminder details",
          },
          {
            ...baseEntry,
            id: "timeline:campaign-email-1",
            kind: "outbound-campaign-email" as const,
            occurredAtLabel: "1h ago",
            subject: "April field update",
          },
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("2 automated · 1 campaign");
    expect(markup).not.toContain("Training details");
    expect(markup).not.toContain("Reminder details");
    expect(markup).not.toContain("April field update");
  });

  it("does not collapse a single automated row", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [baseEntry],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("Training details");
    expect(markup).not.toContain("1 automated");
  });

  it("shows one consolidated campaign state while keeping the row in the purple campaign treatment", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:campaign-email-activity",
            kind: "outbound-campaign-email" as const,
            subject: "April field update",
            body: "Please bring your field notebook.",
            campaignActivity: [
              {
                activityType: "opened" as const,
                occurredAt: "2026-04-16T13:30:00.000Z",
                occurredAtLabel: "1h ago",
                label: "Opened 1h ago",
              },
              {
                activityType: "clicked" as const,
                occurredAt: "2026-04-16T13:45:00.000Z",
                occurredAtLabel: "45m ago",
                label: "Clicked 45m ago",
              },
            ],
          },
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain('data-campaign-state="clicked"');
    expect(markup).toContain("border-violet-200/70 bg-violet-50/30");
    expect(markup).not.toContain("Opened 1h ago");
    expect(markup).not.toContain("45m ago");
    expect(markup).not.toContain(">Sent<");
    expect(markup).toContain(">Clicked<");
  });

  it("renders lifecycle events as volunteer-side context rows with an icon-led label", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:lifecycle-applied",
            kind: "system-event" as const,
            actorLabel: "System",
            subject: null,
            body: "Applied to the Pacific Northwest expedition.",
            channel: null,
          },
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("APPLIED");
    expect(markup).toContain("Alice applied to the Pacific Northwest expedition.");
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
    ).toBe(true);
    expect(
      shouldHideAutomatedRowBody({
        isExpanded: false,
        kind: "outbound-auto-email",
        headline: null,
      }),
    ).toBe(false);
  });

  it("reveals an exact timestamp while keeping the relative label visible", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [baseEntry],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain(">2h ago<");
    expect(markup).toContain('title="Apr 16, 2026, 12:30 PM UTC"');
  });

  it("adds wrap-anywhere behavior to expanded timeline copy", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            kind: "outbound-email" as const,
            body: "https://example.org/really-long-link-without-natural-breakpoints",
            sendStatus: null,
            mailbox: "volunteers@example.org",
          },
        ],
        volunteerFirstName: "Alice",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("[overflow-wrap:anywhere]");
  });

  it("renders the compact participant header for one-to-one email entries", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:email-with-participants",
            kind: "outbound-email" as const,
            actorLabel: "You",
            subject: "Re: Update on Hex 43191",
            body: "Looping Samantha in here for coverage.",
            fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
            toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
            ccHeader:
              "Ricky Jones <ricky@adventurescientists.org>, Samantha Doe <samantha@adventurescientists.org>",
          },
        ],
        volunteerFirstName: "Shaina",
        currentOperatorUserId: "user:operator",
        // Reply button only renders when onReply is provided; supply a no-op
        // so the markup contains it for the assertion below.
        onReply: vi.fn(),
      }),
    );

    expect(markup).toContain("PNW Project");
    expect(markup).toContain("Shaina Dotson");
    expect(markup).toContain("+cc");
    expect(markup).toContain("Reply");
  });

  it("renders sanitized rich html bodies for email timeline entries", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:rich-email",
            kind: "inbound-email" as const,
            actorLabel: "Shaina Dotson",
            subject: "Rich update",
            body: '<h2>Heading</h2><p>Hello <strong>bold</strong> 🎉 <a href="https://example.org">link</a></p><blockquote>quoted</blockquote><img src="x" onerror="alert(1)"><script>alert(1)</script>',
            fromHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
            toHeader: "pnwbio@adventurescientists.org",
          },
        ],
        volunteerFirstName: "Shaina",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("<h2>Heading</h2>");
    expect(markup).toContain("<strong>bold</strong>");
    expect(markup).toContain("🎉");
    expect(markup).toContain("<blockquote>quoted</blockquote>");
    expect(markup).toContain('href="https://example.org"');
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("alert(1)");
  });

  it("uses recipient labels without falling back to unknown recipient", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:display-recipient",
            kind: "outbound-email" as const,
            actorLabel: "You",
            subject: "Display recipient",
            fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
            toHeader: "Display Name <email@example.com>",
          },
          {
            ...baseEntry,
            id: "timeline:bare-recipient",
            kind: "outbound-email" as const,
            actorLabel: "You",
            subject: "Bare recipient",
            fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
            toHeader: "email@example.com",
          },
          {
            ...baseEntry,
            id: "timeline:project-recipient",
            kind: "inbound-email" as const,
            actorLabel: "Volunteer",
            subject: "Project recipient",
            fromHeader: "Volunteer <volunteer@example.com>",
            toHeader: "",
            recipientLabel: "PNW Forest Biodiversity",
          },
          {
            ...baseEntry,
            id: "timeline:no-recipient",
            kind: "inbound-email" as const,
            actorLabel: "Volunteer",
            subject: "No recipient",
            fromHeader: "Volunteer <volunteer@example.com>",
            toHeader: null,
          },
        ],
        volunteerFirstName: "Volunteer",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain("Display Name");
    expect(markup).toContain("email@example.com");
    expect(markup).toContain("PNW Forest Biodiversity");
    expect(markup).not.toContain("Unknown recipient");
  });

  it("renders a header toggle for every one-to-one email bubble", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            id: "timeline:older-email",
            kind: "inbound-email" as const,
            actorLabel: "Shaina Dotson",
            subject: "Older message",
            body: "Older body.",
            fromHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
            toHeader: "PNW Project <pnwbio@adventurescientists.org>",
          },
          {
            ...baseEntry,
            id: "timeline:newer-email",
            kind: "outbound-email" as const,
            actorLabel: "You",
            subject: "Newer message",
            body: "Newer body.",
            fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
            toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
          },
        ],
        volunteerFirstName: "Shaina",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup.match(/Show full email headers/g)).toHaveLength(2);
    expect(markup).toContain("Older message");
    expect(markup).toContain("Newer message");
  });

  it("uses the Adventure Scientists mark for outbound message avatars", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxTimeline, {
        entries: [
          {
            ...baseEntry,
            kind: "outbound-email" as const,
            actorLabel: "Your Operator",
            fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
            toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
          },
        ],
        volunteerFirstName: "Shaina",
        currentOperatorUserId: "user:operator",
      }),
    );

    expect(markup).toContain('aria-label="Adventure Scientists"');
    expect(markup).not.toContain(">YO<");
  });

  it("classifies first-data system dividers into the emerald data category", () => {
    expect(
      classifySystemDivider("Submitted first batch from the field."),
    ).toMatchObject({
      label: "FIRST DATA",
      tone: "emerald",
    });
  });
});
