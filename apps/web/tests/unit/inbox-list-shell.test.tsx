import { createRequire } from "node:module";
import React, { act, createElement, useEffect, type ReactNode } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxListViewModel } from "../../app/inbox/_lib/view-models";

const fetchInboxListPageMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
const routerPrefetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
    readonly prefetch?: boolean;
    readonly [key: string]: unknown;
  }) => {
    const { prefetch, ...anchorProps } = props;
    void prefetch;
    return createElement("a", { href, ...anchorProps }, children);
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({
    prefetch: routerPrefetchMock,
    replace: routerReplaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../app/inbox/_lib/client-api", () => ({
  fetchInboxListPage: fetchInboxListPageMock,
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("../../app/inbox/_components/icons", () => ({
  FlagIcon: iconMock("FlagIcon"),
  FilterIcon: iconMock("FilterIcon"),
  InboxIcon: iconMock("InboxIcon"),
  LoaderIcon: iconMock("LoaderIcon"),
  MailIcon: iconMock("MailIcon"),
  MailOpenIcon: iconMock("MailOpenIcon"),
  PencilIcon: iconMock("PencilIcon"),
  PhoneIcon: iconMock("PhoneIcon"),
  SearchIcon: iconMock("SearchIcon"),
  SearchXIcon: iconMock("SearchXIcon"),
  SendIcon: iconMock("SendIcon"),
  XIcon: iconMock("XIcon"),
}));

import {
  InboxClientProvider,
  useInboxClient,
} from "../../app/inbox/_components/inbox-client-provider";
import { InboxList } from "../../app/inbox/_components/inbox-list";

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
  readonly root: Root;
  readonly rerender: (input?: SearchProbeState) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

interface SearchProbeState {
  readonly query: string;
  readonly isQueueLoading: boolean;
}

function SearchStateProbe({ query, isQueueLoading }: SearchProbeState) {
  const { setSearchQuery, setQueueLoading } = useInboxClient();

  useEffect(() => {
    setSearchQuery(query);
    setQueueLoading(isQueueLoading);
  }, [isQueueLoading, query, setQueueLoading, setSearchQuery]);

  return null;
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
  Object.defineProperty(globalThis, "HTMLInputElement", {
    configurable: true,
    value: window.HTMLInputElement,
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

function buildList(
  overrides: Partial<InboxListViewModel> = {},
): InboxListViewModel {
  return {
    items: [
      {
        contactId: "contact-1",
        displayName: "Riley Carter",
        initials: "RC",
        avatarTone: "sky",
        latestSubject: "Re: Field report",
        snippet: "Thanks for the quick update.",
        latestChannel: "email",
        projectLabel: "Amazon Basin",
        additionalActiveProjectsCount: 0,
        volunteerStage: "active",
        bucket: "new",
        needsFollowUp: false,
        hasUnresolved: false,
        isUnread: true,
        unreadCount: 1,
        isUnanswered: true,
        lastInboundAt: "2026-04-20T16:00:00.000Z",
        lastNonAliasMessageAt: "2026-04-20T16:00:00.000Z",
        lastOutboundAt: null,
        lastActivityAt: "2026-04-20T16:00:00.000Z",
        lastEventType: "communication.email.inbound",
        lastActivityLabel: "1h ago",
      },
    ],
    filters: [
      { id: "all", label: "All", count: 1289, hint: null },
      { id: "unread", label: "Unread", count: 3, hint: null },
      { id: "follow-up", label: "Needs Follow-Up", count: 2, hint: null },
      { id: "sent", label: "Sent", count: 7, hint: null },
    ],
    totals: {
      all: 1289,
      unread: 3,
      followUp: 2,
      unresolved: 0,
      sent: 7,
    },
    activeProjects: [
      {
        id: "project-1",
        name: "Amazon Basin",
      },
    ],
    selectedProjectId: null,
    page: {
      hasMore: false,
      nextCursor: null,
      total: 1,
    },
    freshness: {
      latestUpdatedAt: "2026-04-20T16:00:00.000Z",
      total: 1,
    },
    ...overrides,
  };
}

async function mountInboxList(
  initialList: InboxListViewModel = buildList(),
  searchProbe?: SearchProbeState,
): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderList = (nextSearchProbe?: SearchProbeState) => {
    root.render(
      <InboxClientProvider composerAliases={[]} currentActorId="user-1">
        {nextSearchProbe ? <SearchStateProbe {...nextSearchProbe} /> : null}
        <InboxList initialList={initialList} />
      </InboxClientProvider>,
    );
  };

  await act(async () => {
    renderList(searchProbe);
    await Promise.resolve();
  });

  return {
    container,
    root,
    rerender: async (nextSearchProbe) => {
      await act(async () => {
        renderList(nextSearchProbe);
        await Promise.resolve();
      });
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      dom.window.close();
    },
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

function findButtonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent.includes(text),
  );
  if (button === undefined) {
    throw new Error(`Button containing text "${text}" was not found.`);
  }
  return button;
}

describe("Inbox list shell", () => {
  afterEach(async () => {
    if (activeSession !== null) {
      await activeSession.cleanup();
      activeSession = null;
    }

    vi.clearAllMocks();
  });

  it("keeps filters hidden by default and exposes open and active button states", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    expect(session.container.textContent).not.toContain("State");

    const filterButton = findButtonByLabel(session.container, "Filters");
    expect(filterButton.getAttribute("aria-expanded")).toBe("false");
    expect(filterButton.className).toContain("text-slate-500");

    act(() => {
      filterButton.click();
    });

    expect(filterButton.getAttribute("aria-expanded")).toBe("true");
    expect(filterButton.className).toContain("bg-slate-900");
    expect(session.container.textContent).toContain("State");
    expect(session.container.textContent).toContain("Project");
    expect(session.container.textContent).not.toContain("Unresolved");
    expect(
      session.container.querySelector("[data-icon='InboxIcon']"),
    ).not.toBeNull();
    expect(
      session.container.querySelector("[data-icon='MailOpenIcon']"),
    ).not.toBeNull();
    expect(
      session.container.querySelector("[data-icon='FlagIcon']"),
    ).not.toBeNull();
    expect(
      session.container.querySelector("[data-icon='SendIcon']"),
    ).not.toBeNull();

    await act(async () => {
      findButtonByText(session.container, "Unread").click();
      await Promise.resolve();
    });
    await flushReact();

    act(() => {
      filterButton.click();
    });

    expect(filterButton.getAttribute("aria-expanded")).toBe("false");
    expect(filterButton.className).toContain("bg-slate-100");
    expect(
      filterButton.querySelector("[data-filter-active-indicator='true']"),
    ).not.toBeNull();
    expect(session.container.textContent).not.toContain("Project");
  });

  it("replaces the clear-search control with a spinner while search is loading", async () => {
    fetchInboxListPageMock.mockReturnValue(new Promise(() => undefined));
    activeSession = await mountInboxList(buildList(), {
      query: "basin",
      isQueueLoading: true,
    });
    await flushReact();

    expect(
      activeSession.container.querySelector(
        "[role='status'][aria-label='Search loading']",
      ),
    ).not.toBeNull();
    expect(
      activeSession.container.querySelector("button[aria-label='Clear search']"),
    ).toBeNull();

    await activeSession.rerender({
      query: "basin",
      isQueueLoading: false,
    });
    await flushReact();

    expect(
      activeSession.container.querySelector(
        "[role='status'][aria-label='Search loading']",
      ),
    ).toBeNull();
    expect(
      activeSession.container.querySelector("button[aria-label='Clear search']"),
    ).not.toBeNull();
  });

  it("shows search skeleton rows only once the query reaches three characters", async () => {
    fetchInboxListPageMock.mockReturnValue(new Promise(() => undefined));
    activeSession = await mountInboxList(buildList(), {
      query: "am",
      isQueueLoading: true,
    });
    await flushReact();

    expect(
      activeSession.container.querySelector(
        "[role='status'][aria-label='Searching inbox']",
      ),
    ).toBeNull();
    expect(activeSession.container.textContent).toContain("Riley Carter");

    await activeSession.rerender({
      query: "ama",
      isQueueLoading: true,
    });
    await flushReact();

    expect(
      activeSession.container.querySelector(
        "[role='status'][aria-label='Searching inbox']",
      ),
    ).not.toBeNull();
    expect(activeSession.container.textContent).not.toContain("Riley Carter");

    await activeSession.rerender({
      query: "",
      isQueueLoading: false,
    });
    await flushReact();

    expect(
      activeSession.container.querySelector(
        "[role='status'][aria-label='Searching inbox']",
      ),
    ).toBeNull();
    expect(activeSession.container.textContent).toContain("Riley Carter");
  });

  it("renders the primary project chip with an inline +N indicator", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    const baseItem = buildList().items[0];

    if (baseItem === undefined) {
      throw new Error("Expected an inbox list fixture item");
    }

    activeSession = await mountInboxList(
      buildList({
        items: [
          {
            ...baseItem,
            additionalActiveProjectsCount: 2,
          },
        ],
      }),
    );

    const row = activeSession.container.querySelector("[data-inbox-row='true']");

    expect(row?.textContent).toContain("Amazon Basin");
    expect(row?.textContent).toContain("+2");
  });
});
