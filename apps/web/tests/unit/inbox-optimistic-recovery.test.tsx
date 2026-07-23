import { createRequire } from "node:module";
import React, { act, createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

import {
  InboxDetailTimelinePanel,
  OPTIMISTIC_MATCH_GRACE_MS,
  OPTIMISTIC_ORPHAN_TIMEOUT_MS,
  OPTIMISTIC_REFRESH_INTERVAL_MS,
  OPTIMISTIC_REFRESH_MAX_ATTEMPTS,
} from "../../app/inbox/_components/inbox-detail";
import {
  InboxClientProvider,
  useInboxClient,
} from "../../app/inbox/_components/inbox-client-provider";
import type {
  InboxDetailSummaryViewModel,
  InboxDetailTimelineViewModel,
  InboxTimelineEntryViewModel,
  OptimisticOutbound,
} from "../../app/inbox/_lib/view-models";

const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
  }),
}));

vi.mock("../../app/inbox/actions", () => ({
  archiveInboxContactAction: vi.fn(),
  clearInboxNeedsFollowUpAction: vi.fn(),
  markInboxNeedsFollowUpAction: vi.fn(),
  markInboxOpenedAction: vi.fn(),
  markInboxUnreadAction: vi.fn(),
  sendComposerAction: vi.fn(),
  unarchiveInboxContactAction: vi.fn(),
}));

vi.mock("../../app/inbox/_lib/client-api", () => ({
  fetchInboxTimelinePage: vi.fn(),
}));

vi.mock("../../app/inbox/_components/inbox-timeline", () => ({
  InboxTimeline: ({
    entries,
  }: {
    readonly entries: readonly InboxTimelineEntryViewModel[];
  }) =>
    createElement(
      "ul",
      { "data-testid": "timeline" },
      entries.map((entry) =>
        createElement(
          "li",
          {
            key: entry.id,
            "data-entry-id": entry.id,
            "data-send-status": entry.sendStatus ?? "none",
          },
          entry.sendStatus === "pending"
            ? "Sending..."
            : entry.sendStatus === "orphaned"
              ? "Send stalled before confirmation."
              : entry.sendStatus ?? "confirmed",
        ),
      ),
    ),
}));

vi.mock("../../app/inbox/_components/inbox-loading", () => ({
  TimelineSkeleton: () => createElement("div", null, "Loading timeline"),
}));

vi.mock("../../app/inbox/_components/inbox-freshness-poller", () => ({
  InboxFreshnessPoller: () => null,
}));

vi.mock("../../app/inbox/_components/inbox-composer", () => ({
  InboxComposerReplyBar: () => null,
}));

vi.mock("../../app/inbox/_components/inbox-contact-rail", () => ({
  InboxContactRail: () => null,
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: () => null,
}));

vi.mock("../../app/inbox/_components/icons", () => ({
  AlertTriangleIcon: () => null,
  ArchiveBoxIcon: () => null,
  ArchiveRestoreIcon: () => null,
  FlagIcon: () => null,
  MailOpenIcon: () => null,
  UserRoundIcon: () => null,
}));

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

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  const window = dom.window;
  const raf = (callback: FrameRequestCallback) =>
    window.setTimeout(() => {
      callback(0);
    }, 0);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = window.clearTimeout.bind(window);

  const entries = {
    document: window.document,
    Element: window.Element,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    navigator: window.navigator,
    self: window,
    window,
    requestAnimationFrame: raf,
    cancelAnimationFrame: window.cancelAnimationFrame,
  } as const;

  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

function buildEntry(
  overrides: Partial<InboxTimelineEntryViewModel> = {},
): InboxTimelineEntryViewModel {
  return {
    id: "timeline:real",
    kind: "outbound-email",
    occurredAt: "2026-07-23T12:00:05.000Z",
    occurredAtLabel: "Just now",
    actorLabel: "Operator",
    subject: "Status update",
    body: "Body",
    channel: "email",
    isUnread: false,
    isPreview: false,
    fromHeader: "operator@example.org",
    toHeader: "Volunteer",
    recipientLabel: "Volunteer",
    ccHeader: null,
    mailbox: "operator@example.org",
    threadId: null,
    rfc822MessageId: null,
    inReplyToRfc822: null,
    sendStatus: "confirmed",
    failedReason: null,
    failedDetail: null,
    attachmentCount: 0,
    attachments: [],
    campaignActivity: [],
    ...overrides,
  };
}

function buildOptimistic(
  overrides: Partial<OptimisticOutbound> = {},
): OptimisticOutbound {
  return {
    ...buildEntry({
      id: "optimistic:1",
      occurredAt: "2026-07-23T12:00:00.000Z",
      sendStatus: "pending",
    }),
    contactId: "contact-1",
    clientGeneratedId: "client-1",
    createdAt: Date.now(),
    settledAt: null,
    ...overrides,
  };
}

const contact = {
  contactId: "contact-1",
  displayName: "Alice Example",
  primaryPhone: null,
} as InboxDetailSummaryViewModel["contact"];

function buildTimelineViewModel(
  timeline: readonly InboxTimelineEntryViewModel[],
): InboxDetailTimelineViewModel {
  return {
    timeline,
    timelinePage: {
      hasMore: false,
      nextCursor: null,
      hasHiddenEarlierHistory: false,
      total: timeline.length,
    },
  };
}

type ClientApi = ReturnType<typeof useInboxClient>;

let latestClient: ClientApi | null = null;

function ClientCapture() {
  const client = useInboxClient();
  latestClient = client;

  useEffect(() => {
    return () => {
      latestClient = null;
    };
  }, []);

  return null;
}

interface RenderSession {
  readonly container: HTMLElement;
  readonly rerender: (
    timeline: readonly InboxTimelineEntryViewModel[],
  ) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

async function renderHarness(
  timeline: readonly InboxTimelineEntryViewModel[] = [],
): Promise<RenderSession> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = async (nextTimeline: readonly InboxTimelineEntryViewModel[]) => {
    await act(async () => {
      root.render(
        createElement(
          InboxClientProvider,
          {
            composerAliases: [],
            initialDrafts: [],
            currentActorId: "user-1",
            operatorDisplayName: "Operator",
            children: createElement(
              Fragment,
              null,
              createElement(ClientCapture),
              createElement(InboxDetailTimelinePanel, {
                contact,
                composerReplyContext: null,
                initialTimeline: buildTimelineViewModel(nextTimeline),
                currentOperatorUserId: "user-1",
              }),
            ),
          },
        ),
      );
      await Promise.resolve();
    });
  };

  await render(timeline);

  const cleanup = async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
  };

  activeSession = {
    container,
    rerender: render,
    cleanup,
  };

  return activeSession;
}

async function flushTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function pendingCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-send-status="pending"]').length;
}

function orphanedCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-send-status="orphaned"]').length;
}

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
  latestClient = null;
  routerRefreshMock.mockReset();
  vi.useRealTimers();
});

describe("Inbox optimistic recovery", () => {
  it("removes an unsettled optimistic entry when a matching real entry appears after grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const session = await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    await flushTimers(OPTIMISTIC_MATCH_GRACE_MS + 1);
    await session.rerender([buildEntry()]);

    expect(pendingCount(session.container)).toBe(0);
    expect(latestClient?.optimisticOutbounds).toHaveLength(0);
  });

  it("keeps an unsettled match during grace, then removes it after grace elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const session = await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    await flushTimers(OPTIMISTIC_MATCH_GRACE_MS - 5_000);
    await session.rerender([buildEntry()]);

    expect(pendingCount(session.container)).toBe(1);
    expect(latestClient?.optimisticOutbounds).toHaveLength(1);

    await flushTimers(5_001);

    expect(pendingCount(session.container)).toBe(0);
    expect(latestClient?.optimisticOutbounds).toHaveLength(0);
  });

  it("preserves existing settled-match cleanup behavior", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const session = await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      latestClient?.markOptimisticSettled("client-1");
      await Promise.resolve();
    });

    await session.rerender([buildEntry()]);

    expect(pendingCount(session.container)).toBe(0);
    expect(latestClient?.optimisticOutbounds).toHaveLength(0);
  });

  it("marks an unmatched optimistic entry orphaned after the timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const session = await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    await flushTimers(OPTIMISTIC_ORPHAN_TIMEOUT_MS + 1);

    expect(orphanedCount(session.container)).toBe(1);
    expect(session.container.textContent).toContain(
      "Send stalled before confirmation.",
    );
    expect(session.container.textContent).not.toContain("Sending...");
    expect(latestClient?.optimisticOutbounds[0]?.sendStatus).toBe("orphaned");
  });

  it("caps the refresh loop after the configured number of attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    for (let attempt = 1; attempt <= OPTIMISTIC_REFRESH_MAX_ATTEMPTS; attempt += 1) {
      await flushTimers(OPTIMISTIC_REFRESH_INTERVAL_MS);
      expect(routerRefreshMock).toHaveBeenCalledTimes(attempt);
    }

    await flushTimers(OPTIMISTIC_REFRESH_INTERVAL_MS * 2);

    expect(routerRefreshMock).toHaveBeenCalledTimes(
      OPTIMISTIC_REFRESH_MAX_ATTEMPTS,
    );
  });

  it("stops refreshing once the ghost entry is removed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const session = await renderHarness();

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    await flushTimers(OPTIMISTIC_REFRESH_INTERVAL_MS + 1);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);

    await session.rerender([buildEntry()]);
    await flushTimers(OPTIMISTIC_MATCH_GRACE_MS + 1);
    const refreshCountAtRemoval = routerRefreshMock.mock.calls.length;

    await flushTimers(OPTIMISTIC_REFRESH_INTERVAL_MS * 2);

    expect(latestClient?.optimisticOutbounds).toHaveLength(0);
    expect(routerRefreshMock).toHaveBeenCalledTimes(refreshCountAtRemoval);
  });
});
