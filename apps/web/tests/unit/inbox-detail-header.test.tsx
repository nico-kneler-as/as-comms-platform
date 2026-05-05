import { createRequire } from "node:module";
import React, { act, createElement } from "react";

Object.assign(globalThis, { React });

import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxDetailViewModel } from "../../app/inbox/_lib/view-models";

const routerPushMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
const setTimelineLoadingMock = vi.hoisted(() => vi.fn());
const clearOptimisticForContactMock = vi.hoisted(() => vi.fn());
const removeOptimisticOutboundMock = vi.hoisted(() => vi.fn());
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
    openReplyDraft: openReplyDraftMock,
    showToast: showToastMock,
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
  TooltipTrigger: ({ children }: { readonly children: React.ReactNode }) =>
    children,
  TooltipContent: () => null,
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

import { InboxDetail } from "../../app/inbox/_components/inbox-detail";

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
      pinnedNote: null,
      activeProjects: [
        {
          membershipId: "membership-1",
          projectId: "project-1",
          projectName: "Amazon Basin",
          signupYear: 2026,
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
      source: "membership",
    },
    initials: "RC",
    avatarTone: "sky",
    timeline: [],
    bucket: "opened",
    needsFollowUp: false,
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

    const markUnreadButton = findButtonByLabel(session.container, "Mark unread");
    const archiveButton = findButtonByLabel(
      session.container,
      "Archive conversation",
    );
    const volunteerButton = findButtonByLabel(
      session.container,
      "Volunteer details",
    );

    expect(markUnreadButton.dataset.inboxMarkUnread).toBe("true");
    expect(markUnreadButton.textContent).toBe("");
    expect(archiveButton.textContent).toBe("");
    expect(volunteerButton.textContent).toBe("");
    expect(
      session.container.querySelector('button[aria-label="Set reminder"]'),
    ).toBeNull();
    expect(session.container.textContent).not.toContain("Set Reminder");
    expect(session.container.textContent).not.toContain("Volunteer Details");
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
});
