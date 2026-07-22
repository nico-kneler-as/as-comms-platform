import { createRequire } from "node:module";
import React, { act, createElement } from "react";

Object.assign(globalThis, { React });

import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  InboxDetailViewModel,
  InboxTimelineEntryViewModel,
} from "../../app/inbox/_lib/view-models";

const routerPushMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
const setTimelineLoadingMock = vi.hoisted(() => vi.fn());
const clearOptimisticForContactMock = vi.hoisted(() => vi.fn());
const removeOptimisticOutboundMock = vi.hoisted(() => vi.fn());
const openForwardDraftMock = vi.hoisted(() => vi.fn());
const openReplyDraftMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());
const markInboxNeedsFollowUpActionMock = vi.hoisted(() => vi.fn());
const clearInboxNeedsFollowUpActionMock = vi.hoisted(() => vi.fn());
const markInboxOpenedActionMock = vi.hoisted(() => vi.fn());
const markInboxUnreadActionMock = vi.hoisted(() => vi.fn());
const archiveInboxContactActionMock = vi.hoisted(() => vi.fn());
const unarchiveInboxContactActionMock = vi.hoisted(() => vi.fn());
const sendComposerActionMock = vi.hoisted(() => vi.fn());
const fetchInboxTimelinePageMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
}));

vi.mock("../../app/inbox/actions", () => ({
  archiveInboxContactAction: archiveInboxContactActionMock,
  clearInboxNeedsFollowUpAction: clearInboxNeedsFollowUpActionMock,
  markInboxNeedsFollowUpAction: markInboxNeedsFollowUpActionMock,
  markInboxOpenedAction: markInboxOpenedActionMock,
  markInboxUnreadAction: markInboxUnreadActionMock,
  sendComposerAction: sendComposerActionMock,
  unarchiveInboxContactAction: unarchiveInboxContactActionMock,
}));

vi.mock("../../app/inbox/_lib/client-api", () => ({
  fetchInboxTimelinePage: fetchInboxTimelinePageMock,
}));

vi.mock("../../app/inbox/_components/inbox-client-provider", () => ({
  useInboxClient: () => ({
    isTimelineLoading: false,
    setTimelineLoading: setTimelineLoadingMock,
    optimisticOutbounds: [],
    clearOptimisticForContact: clearOptimisticForContactMock,
    removeOptimisticOutbound: removeOptimisticOutboundMock,
    openForwardDraft: openForwardDraftMock,
    openReplyDraft: openReplyDraftMock,
    showToast: showToastMock,
    composerAliases: [],
  }),
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("../../app/inbox/_components/icons", () => ({
  AlertTriangleIcon: iconMock("AlertTriangleIcon"),
  ArchiveBoxIcon: iconMock("ArchiveBoxIcon"),
  ArchiveRestoreIcon: iconMock("ArchiveRestoreIcon"),
  FlagIcon: iconMock("FlagIcon"),
  MailOpenIcon: iconMock("MailOpenIcon"),
  UserRoundIcon: iconMock("UserRoundIcon"),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children: React.ReactNode }) =>
    createElement(React.Fragment, null, children),
  TooltipProvider: ({ children }: { readonly children: React.ReactNode }) =>
    createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { readonly children: React.ReactNode }) =>
    children,
  TooltipContent: ({ children }: { readonly children?: React.ReactNode }) =>
    createElement("div", { "data-tooltip-content": true }, children),
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: ({
    initials,
    className,
  }: {
    readonly initials: string;
    readonly className?: string;
  }) => createElement("div", { className, "data-avatar": initials }),
}));

vi.mock("../../app/inbox/_components/inbox-freshness-poller", () => ({
  InboxFreshnessPoller: () => null,
}));

vi.mock("../../app/inbox/_components/inbox-composer", () => ({
  InboxComposerReplyBar: () => null,
}));

vi.mock("../../app/inbox/_components/inbox-contact-rail", () => ({
  InboxContactRail: () =>
    createElement("div", { id: "inbox-contact-rail" }, "Volunteer rail"),
}));

vi.mock("../../app/inbox/_components/inbox-loading", () => ({
  TimelineSkeleton: () => createElement("div", null, "Loading timeline"),
}));

vi.mock("../../app/inbox/_components/inbox-timeline", () => ({
  InboxTimeline: () => createElement("div", null, "Timeline"),
}));

import {
  InboxDetail,
  sortTimelineEntries,
} from "../../app/inbox/_components/inbox-detail";

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

interface RenderSession {
  readonly container: HTMLElement;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

function buildDetail(
  overrides: Partial<InboxDetailViewModel> = {},
): InboxDetailViewModel {
  return {
    contact: {
      contactId: "contact-1",
      displayName: "Riley Carter",
      volunteerId: "VOL-001",
      primaryEmail: "riley@example.org",
      primaryPhone: null,
      joinedAtLabel: "Joined Apr 2024",
      hasUnresolved: false,
      unresolvedCases: [],
      pinnedNote: null,
      activeProjects: [
        {
          membershipId: "membership-1",
          projectId: "project-1",
          projectName: "Amazon Basin",
          subDisplayName: null,
          isConnectedSub: false,
          hostProjectId: null,
          projectIsActive: true,
          status: "in-field",
          statusLabel: "Active",
          crmUrl: "/crm/contact-1",
          expeditionMemberUrl: null,
        },
      ],
      pastProjects: [],
      recentActivity: [],
    },
    projectionAvailable: true,
    conversationProject: {
      projectId: "project-1",
      projectName: "Amazon Basin",
      subProjectName: null,
      source: "membership",
    },
    initials: "RC",
    avatarTone: "sky",
    timeline: [],
    bucket: "opened",
    needsFollowUp: false,
    isSpam: false,
    isArchived: false,
    isUnread: false,
    smsEligible: false,
    composerReplyContext: null,
    timelinePage: {
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 0,
    },
    freshness: {
      inboxUpdatedAt: "2026-05-01T10:00:00.000Z",
      timelineUpdatedAt: "2026-05-01T10:00:00.000Z",
      timelineCount: 0,
    },
    ...overrides,
  };
}

function buildTimelineEntry(
  overrides: Partial<InboxTimelineEntryViewModel> = {},
): InboxTimelineEntryViewModel {
  return {
    id: "timeline:entry",
    kind: "inbound-email",
    occurredAt: "2026-07-22T16:00:00.000Z",
    occurredAtLabel: "Just now",
    actorLabel: "Volunteer",
    subject: "Question",
    body: "Can you send the field packet?",
    channel: "email",
    isUnread: false,
    isPreview: false,
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
    ...overrides,
  };
}

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
  Object.defineProperty(globalThis, "HTMLButtonElement", {
    configurable: true,
    value: window.HTMLButtonElement,
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
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

async function renderDetail(
  detail: InboxDetailViewModel,
): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox/contact-1",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <InboxDetail detail={detail} currentOperatorUserId="user-1" />,
    );
    await Promise.resolve();
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      dom.window.close();
    },
  };
}

function findButtonByLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (button === null) {
    throw new Error(`Button with label "${label}" was not found.`);
  }

  return button;
}

describe("sortTimelineEntries", () => {
  it("keeps the incident timeline strictly chronological across fixed permutations", () => {
    const incidentEntries = [
      buildTimelineEntry({
        id: "timeline:received-training",
        kind: "system-event",
        occurredAt: "2026-07-22T12:00:00.000Z",
        body: "Received training for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
      buildTimelineEntry({
        id: "timeline:inbound-1559",
        kind: "inbound-email",
        occurredAt: "2026-07-22T15:59:00.000Z",
        subject: "Question before training",
        body: "I have a question before training.",
      }),
      buildTimelineEntry({
        id: "timeline:outbound-1632",
        kind: "outbound-email",
        occurredAt: "2026-07-22T16:32:00.000Z",
        actorLabel: "You",
        subject: "Re: Question before training",
        body: "Here are the details.",
      }),
      buildTimelineEntry({
        id: "timeline:inbound-1645",
        kind: "inbound-email",
        occurredAt: "2026-07-22T16:45:00.000Z",
        subject: "Thanks",
        body: "Thanks for the quick reply.",
      }),
      buildTimelineEntry({
        id: "timeline:signed-up",
        kind: "system-event",
        occurredAt: "2026-07-22T16:46:23.000Z",
        body: "Signed up for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
      buildTimelineEntry({
        id: "timeline:auto-1655",
        kind: "outbound-auto-email",
        occurredAt: "2026-07-22T16:55:00.000Z",
        actorLabel: "Salesforce Flow",
        subject: "Automated follow-up",
        body: "Automated follow-up",
        channel: "email",
        isPreview: true,
      }),
    ] as const;
    const permutations = [
      [0, 1, 2, 3, 4, 5],
      [4, 2, 0, 5, 1, 3],
      [5, 3, 1, 4, 2, 0],
      [1, 4, 3, 0, 5, 2],
    ] as const;
    const expectedOrder = [
      "timeline:received-training",
      "timeline:inbound-1559",
      "timeline:outbound-1632",
      "timeline:inbound-1645",
      "timeline:signed-up",
      "timeline:auto-1655",
    ];

    for (const permutation of permutations) {
      const sorted = sortTimelineEntries(
        permutation.map((index) => incidentEntries[index]),
      );

      expect(sorted.map((entry) => entry.id)).toEqual(expectedOrder);
    }
  });

  it("reorders adjacent same-day lifecycle runs by journey order", () => {
    const sorted = sortTimelineEntries([
      buildTimelineEntry({
        id: "timeline:training",
        kind: "system-event",
        occurredAt: "2026-07-22T12:00:00.000Z",
        body: "Received training for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
      buildTimelineEntry({
        id: "timeline:signed-up",
        kind: "system-event",
        occurredAt: "2026-07-22T12:00:00.000Z",
        body: "Signed up for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
      buildTimelineEntry({
        id: "timeline:completed-training",
        kind: "system-event",
        occurredAt: "2026-07-22T12:00:00.000Z",
        body: "Completed training for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "timeline:signed-up",
      "timeline:training",
      "timeline:completed-training",
    ]);
  });

  it("does not reorder lifecycle chips across emails or across UTC days", () => {
    const sorted = sortTimelineEntries([
      buildTimelineEntry({
        id: "timeline:day-one-training",
        kind: "system-event",
        occurredAt: "2026-07-21T12:00:00.000Z",
        body: "Received training for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
      buildTimelineEntry({
        id: "timeline:email-gap",
        kind: "inbound-email",
        occurredAt: "2026-07-22T15:59:00.000Z",
        subject: "Checking timing",
        body: "Checking timing.",
      }),
      buildTimelineEntry({
        id: "timeline:day-two-signed-up",
        kind: "system-event",
        occurredAt: "2026-07-22T16:46:23.000Z",
        body: "Signed up for Helio Basin",
        subject: null,
        actorLabel: "System",
        channel: null,
      }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "timeline:day-one-training",
      "timeline:email-gap",
      "timeline:day-two-signed-up",
    ]);
  });
});

describe("Inbox detail header", () => {
  afterEach(async () => {
    if (activeSession !== null) {
      await activeSession.cleanup();
      activeSession = null;
    }

    vi.clearAllMocks();
  });

  it("renders icon-only action buttons and removes the reminder affordance", async () => {
    activeSession = await renderDetail(buildDetail());
    const session = activeSession;

    const followUpButton = findButtonByLabel(
      session.container,
      "Needs Follow-Up",
    );
    const markUnreadButton = findButtonByLabel(session.container, "Mark unread");
    const archiveButton = findButtonByLabel(
      session.container,
      "Archive conversation",
    );
    const volunteerButton = findButtonByLabel(
      session.container,
      "Volunteer details",
    );

    expect(followUpButton.dataset.inboxFollowUpToggle).toBe("true");
    expect(followUpButton.getAttribute("title")).toBeNull();
    expect(followUpButton.disabled).toBe(false);
    expect(markUnreadButton.dataset.inboxMarkUnread).toBe("true");
    expect(markUnreadButton.textContent).toBe("");
    expect(archiveButton.textContent).toBe("");
    expect(volunteerButton.textContent).toBe("");
    expect(
      session.container.querySelector('button[aria-label="Set reminder"]'),
    ).toBeNull();
    expect(session.container.textContent).not.toContain("Set Reminder");
    expect(session.container.textContent).not.toContain("Volunteer Details");
    expect(session.container.textContent).toContain("Needs Follow-Up");
  });

  it("uses the archived header label and hides the volunteer trigger once the rail opens", async () => {
    activeSession = await renderDetail(
      buildDetail({
        isArchived: true,
      }),
    );
    const session = activeSession;

    expect(
      session.container.querySelector('button[aria-label="Archive conversation"]'),
    ).toBeNull();
    expect(
      session.container.querySelector('button[aria-label="Move back to inbox"]'),
    ).not.toBeNull();

    await act(async () => {
      findButtonByLabel(session.container, "Volunteer details").click();
      await Promise.resolve();
    });

    expect(
      session.container.querySelector('button[aria-label="Volunteer details"]'),
    ).toBeNull();
  });

  it("updates the follow-up tooltip copy from the current optimistic state", async () => {
    activeSession = await renderDetail(
      buildDetail({
        needsFollowUp: true,
      }),
    );
    const session = activeSession;

    expect(session.container.textContent).toContain("Pending — click to clear");
    expect(
      session.container.querySelector(
        '[data-tooltip-content="true"]',
      )?.textContent,
    ).toContain("Pending — click to clear");
  });

  // Connected-projects host/sub label: when the contact's primary
  // membership is a connected sub, the header chip's primary text is the
  // host's name and a small "via {sub}" line appears next to it.
  it("renders the host name with 'via {sub}' for a connected sub-project membership", async () => {
    activeSession = await renderDetail(
      buildDetail({
        contact: {
          ...buildDetail().contact,
          activeProjects: [
            {
              membershipId: "membership:beech",
              projectId: "project:beech",
              projectName: "Beech & Butternut",
              subDisplayName: "Saving American Beech",
              isConnectedSub: true,
              hostProjectId: "host:forests",
              projectIsActive: true,
              status: "in-field",
              statusLabel: "Active",
              crmUrl: "/crm/project/beech",
              expeditionMemberUrl: null,
            },
          ],
        },
      }),
    );

    expect(activeSession.container.textContent).toContain(
      "Beech & Butternut",
    );
    expect(activeSession.container.textContent).toContain(
      "via Saving American Beech",
    );
  });

  // When the contact has no active membership but the conversation
  // resolved (via SF event context) to a connected sub, the fallback chip
  // still shows the host name with the via-line.
  it("renders the host name with 'via {sub}' when the conversation fallback is a connected sub", async () => {
    activeSession = await renderDetail(
      buildDetail({
        contact: {
          ...buildDetail().contact,
          activeProjects: [],
        },
        conversationProject: {
          projectId: "project:beech",
          projectName: "Beech & Butternut",
          subProjectName: "Saving American Beech",
          source: "conversation",
        },
      }),
    );

    expect(activeSession.container.textContent).toContain(
      "Beech & Butternut",
    );
    expect(activeSession.container.textContent).toContain(
      "via Saving American Beech",
    );
  });

  it("does not render 'via …' when the project is standalone", async () => {
    activeSession = await renderDetail(buildDetail());

    expect(activeSession.container.textContent).toContain("Amazon Basin");
    expect(activeSession.container.textContent).not.toContain("via ");
  });

  it("renders a Spam badge in the header when the conversation is spam-flagged", async () => {
    activeSession = await renderDetail(
      buildDetail({
        isSpam: true,
      }),
    );

    expect(activeSession.container.textContent).toContain("Spam");
  });

  it("renders unresolved case details, stacked cases, and a chip tooltip", async () => {
    const detail = buildDetail();

    activeSession = await renderDetail(
      buildDetail({
        contact: {
          ...detail.contact,
          hasUnresolved: true,
          unresolvedCases: [
            {
              kind: "identity",
              reasonLabel: "Possible duplicate contact",
              explanation: "This email may already belong to another contact.",
              otherContacts: [
                {
                  displayName: "Christine Very",
                  email: "cml4355@gmail.com",
                },
                {
                  displayName: "Erin Turner",
                  email: null,
                },
              ],
              moreCount: 2,
              openedAtLabel: "2 hours ago",
            },
            {
              kind: "routing",
              reasonLabel: "Needs review",
              explanation: "Project routing could not be determined.",
              otherContacts: [],
              moreCount: 0,
              openedAtLabel: "1 hour ago",
            },
          ],
        },
      }),
    );

    expect(activeSession.container.textContent).toContain(
      "Possible duplicate contact",
    );
    expect(activeSession.container.textContent).toContain(
      "This email may already belong to another contact.",
    );
    expect(activeSession.container.textContent).toContain(
      "Matches: Christine Very (cml4355@gmail.com) · Erin Turner +2 more",
    );
    expect(activeSession.container.textContent).toContain("Needs review");
    expect(activeSession.container.textContent).toContain(
      "Project routing could not be determined.",
    );
    expect(
      activeSession.container.querySelector(
        'span[title="Possible duplicate contact · Needs review"]',
      ),
    ).not.toBeNull();
  });

  it("falls back to the static unresolved banner line when no case details are available", async () => {
    const detail = buildDetail();

    activeSession = await renderDetail(
      buildDetail({
        contact: {
          ...detail.contact,
          hasUnresolved: true,
          unresolvedCases: [],
        },
      }),
    );

    expect(activeSession.container.textContent).toContain(
      "Unresolved items need attention",
    );
  });

  it("keeps the follow-up toggle clickable while a request is in flight and queues the latest intent", async () => {
    let resolveMark:
      | ((value: { ok: true; data: null; requestId: string }) => void)
      | null = null;
    let resolveClear:
      | ((value: { ok: true; data: null; requestId: string }) => void)
      | null = null;

    markInboxNeedsFollowUpActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    clearInboxNeedsFollowUpActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClear = resolve;
        }),
    );

    activeSession = await renderDetail(buildDetail());
    const session = activeSession;
    const followUpButton = findButtonByLabel(
      session.container,
      "Needs Follow-Up",
    );

    await act(async () => {
      followUpButton.click();
      await Promise.resolve();
    });

    expect(followUpButton.disabled).toBe(false);
    expect(followUpButton.getAttribute("aria-pressed")).toBe("true");
    expect(markInboxNeedsFollowUpActionMock).toHaveBeenCalledTimes(1);
    expect(clearInboxNeedsFollowUpActionMock).not.toHaveBeenCalled();

    await act(async () => {
      followUpButton.click();
      await Promise.resolve();
    });

    expect(followUpButton.disabled).toBe(false);
    expect(followUpButton.getAttribute("aria-pressed")).toBe("false");
    expect(markInboxNeedsFollowUpActionMock).toHaveBeenCalledTimes(1);
    expect(clearInboxNeedsFollowUpActionMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveMark?.({ ok: true, data: null, requestId: "req-mark" });
      await Promise.resolve();
    });

    expect(clearInboxNeedsFollowUpActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveClear?.({ ok: true, data: null, requestId: "req-clear" });
      await Promise.resolve();
    });

    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    expect(followUpButton.getAttribute("aria-pressed")).toBe("false");
  });
});
