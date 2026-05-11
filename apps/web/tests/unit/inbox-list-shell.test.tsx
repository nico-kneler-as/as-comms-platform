import { createRequire } from "node:module";
import React, { act, createElement, useEffect, type ReactNode } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxListViewModel } from "../../app/inbox/_lib/view-models";

const fetchInboxListPageMock = vi.hoisted(() => vi.fn());
const fetchInboxUnifiedSearchMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
const routerPrefetchMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => ({
  current: "",
}));

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
  useSearchParams: () => new URLSearchParams(searchParamsMock.current),
}));

vi.mock("../../app/inbox/_lib/client-api", () => ({
  fetchInboxListPage: fetchInboxListPageMock,
  fetchInboxUnifiedSearch: fetchInboxUnifiedSearchMock,
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("@/components/ui/dropdown-menu", () => {
  const RadioGroupContext = React.createContext<{
    readonly value: string;
    readonly onChange: (next: string) => void;
  } | null>(null);

  return {
    DropdownMenu: ({ children }: { readonly children?: React.ReactNode }) =>
      createElement("div", { "data-testid": "dropdown-menu" }, children),
    DropdownMenuTrigger: ({
      children,
    }: {
      readonly children?: React.ReactNode;
      readonly asChild?: boolean;
    }) => createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { readonly children?: React.ReactNode }) =>
      createElement("div", { role: "menu" }, children),
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange,
    }: {
      readonly children?: React.ReactNode;
      readonly value: string;
      readonly onValueChange: (value: string) => void;
    }) =>
      createElement(
        RadioGroupContext.Provider,
        { value: { value, onChange: onValueChange } },
        children,
      ),
    DropdownMenuRadioItem: ({
      children,
      value,
    }: {
      readonly children?: React.ReactNode;
      readonly value: string;
    }) => {
      const ctx = React.useContext(RadioGroupContext);
      return createElement(
        "button",
        {
          type: "button",
          role: "menuitemradio",
          onClick: () => ctx?.onChange(value),
        },
        children,
      );
    },
  };
});

vi.mock("../../app/inbox/_components/icons", () => ({
  ArchiveBoxIcon: iconMock("ArchiveBoxIcon"),
  ChevronDownIcon: iconMock("ChevronDownIcon"),
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
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value:
      (window as unknown as { PointerEvent?: typeof PointerEvent })
        .PointerEvent ?? window.MouseEvent,
  });
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: window.Element,
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
        primaryEmail: "riley@example.org",
        initials: "RC",
        avatarTone: "sky",
        latestSubject: "Re: Field report",
        snippet: "Thanks for the quick update.",
        latestChannel: "email",
        projectLabel: "Amazon Basin",
        projectSubLabel: null,
        additionalActiveProjectsCount: 0,
        volunteerStage: "active",
        bucket: "new",
        needsFollowUp: false,
        hasUnresolved: false,
        isArchived: false,
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
      { id: "inbox", label: "Inbox", count: null, hint: null },
      { id: "unread", label: "Unread", count: 3, hint: null },
      { id: "follow-up", label: "Pending", count: 2, hint: null },
      { id: "archived", label: "Archived", count: null, hint: null },
      { id: "sent", label: "Sent", count: null, hint: null },
    ],
    totals: {
      inbox: 1289,
      unread: 3,
      followUp: 2,
      sent: 7,
      archived: 1,
    },
    activeProjects: [
      {
        id: "project-1",
        name: "Amazon Basin",
        alias: "Amazon Basin",
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

function buildPnwProjectList(
  overrides: Partial<InboxListViewModel> = {},
): InboxListViewModel {
  return buildList({
    activeProjects: [
      {
        id: "project-pnw",
        name: "Pacific Northwest Biodiversity Survey",
        alias: "PNW Biodiversity",
      },
    ],
    selectedProjectId: "project-pnw",
    ...overrides,
  });
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
    searchParamsMock.current = "";
  });

  it("renders Inbox with the unread count when no filter is active", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();

    const heading = activeSession.container.querySelector("h1");
    expect(heading?.textContent).toBe("Inbox (3)");
  });

  it("renders the selected project alias in the header with the unread count", async () => {
    const projectList = buildPnwProjectList();
    fetchInboxListPageMock.mockResolvedValue(projectList);
    activeSession = await mountInboxList(projectList);

    const heading = activeSession.container.querySelector("h1");
    expect(heading?.textContent).toBe("PNW Biodiversity (3)");
  });

  it("falls back old filter=all URLs to inbox", async () => {
    searchParamsMock.current = "filter=all";
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    await flushReact();

    expect(routerReplaceMock).toHaveBeenCalledWith("/inbox?filter=inbox", {
      scroll: false,
    });
    expect(activeSession.container.querySelector("h1")?.textContent).toBe(
      "Inbox (3)",
    );
  });

  it("joins the selected project and state filter with a middot", async () => {
    const projectList = buildPnwProjectList();
    fetchInboxListPageMock.mockResolvedValue(projectList);
    activeSession = await mountInboxList(projectList);
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(session.container, "Unread").click();
      await Promise.resolve();
    });
    await flushReact();

    const heading = session.container.querySelector("h1");
    expect(heading?.textContent).toBe("PNW Biodiversity · Unread (3)");
  });

  it("renders the active state label when only a state filter is active", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(session.container, "Pending").click();
      await Promise.resolve();
    });
    await flushReact();

    const heading = session.container.querySelector("h1");
    expect(heading?.textContent).toBe("Pending");
  });

  it("renders Results when search is active", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockReturnValue(new Promise(() => undefined));
    activeSession = await mountInboxList(buildList(), {
      query: "basin",
      isQueueLoading: true,
    });
    await flushReact();

    const heading = activeSession.container.querySelector("h1");
    expect(heading?.textContent).toBe("Results");
  });

  it("renders the project count for multiple project ids in the URL", async () => {
    searchParamsMock.current = "projectId=project-pnw&projectId=project-whitebark";
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList(
      buildList({
        activeProjects: [
          {
            id: "project-pnw",
            name: "Pacific Northwest Biodiversity Survey",
            alias: "PNW Biodiversity",
          },
          {
            id: "project-whitebark",
            name: "Tracking Whitebark Pine",
            alias: "Whitebark",
          },
        ],
      }),
    );

    const heading = activeSession.container.querySelector("h1");
    expect(heading?.textContent).toBe("2 projects (3)");
  });

  it("renders Filtered when more than two facets are active", async () => {
    searchParamsMock.current =
      "projectId=project-pnw&projectId=project-whitebark";
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList(
      buildList({
        activeProjects: [
          {
            id: "project-pnw",
            name: "Pacific Northwest Biodiversity Survey",
            alias: "PNW Biodiversity",
          },
          {
            id: "project-whitebark",
            name: "Tracking Whitebark Pine",
            alias: "Whitebark",
          },
        ],
      }),
    );
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(session.container, "Unread").click();
      await Promise.resolve();
    });
    await flushReact();

    const heading = session.container.querySelector("h1");
    expect(heading?.textContent).toBe("Filtered (3)");
  });

  it("omits the unread count from the title when no unread emails remain", async () => {
    const listWithZeroUnread = buildList({
      totals: {
        inbox: 1289,
        unread: 0,
        followUp: 2,
        sent: 7,
        archived: 1,
      },
    });
    fetchInboxListPageMock.mockResolvedValue(listWithZeroUnread);
    activeSession = await mountInboxList(listWithZeroUnread);

    const heading = activeSession.container.querySelector("h1");
    expect(heading?.textContent).toBe("Inbox");
  });

  it("keeps filters hidden by default and exposes open and active button states", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    expect(session.container.textContent).not.toContain("State");

    const filterButton = findButtonByLabel(session.container, "Filters");
    expect(filterButton.getAttribute("aria-expanded")).toBe("false");
    expect(filterButton.className).toContain("text-slate-900");

    act(() => {
      filterButton.click();
    });

    expect(filterButton.getAttribute("aria-expanded")).toBe("true");
    expect(filterButton.className).toContain("bg-[#253746]");
    expect(session.container.textContent).toContain("State");
    expect(session.container.textContent).toContain("All projects");
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

    expect(filterButton.getAttribute("aria-expanded")).toBe("false");
    expect(filterButton.className).toContain("bg-slate-100");
    expect(
      filterButton.querySelector("[data-filter-active-indicator='true']"),
    ).not.toBeNull();
    expect(session.container.textContent).not.toContain("All projects");
  });

  it("collapses the filter pane when a pointerdown fires outside it", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    const filterButton = findButtonByLabel(session.container, "Filters");
    act(() => {
      filterButton.click();
    });
    expect(filterButton.getAttribute("aria-expanded")).toBe("true");

    // pointerdown on document.body — outside the filter pane and the toggle.
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await flushReact();

    expect(filterButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the filter pane open when pointerdown fires inside it", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    const filterButton = findButtonByLabel(session.container, "Filters");
    act(() => {
      filterButton.click();
    });
    expect(filterButton.getAttribute("aria-expanded")).toBe("true");

    const filterPane = session.container.querySelector(
      "[data-inbox-filter-pane='true']",
    );
    if (filterPane === null) {
      throw new Error("filter pane not rendered");
    }

    await act(async () => {
      filterPane.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await flushReact();

    expect(filterButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the filter pane open when pointerdown fires on a Radix portal menu", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    const filterButton = findButtonByLabel(session.container, "Filters");
    act(() => {
      filterButton.click();
    });
    expect(filterButton.getAttribute("aria-expanded")).toBe("true");

    // Simulate a Radix-portaled menu rendered outside the filter pane.
    const portalMenu = document.createElement("div");
    portalMenu.setAttribute("role", "menu");
    document.body.appendChild(portalMenu);

    try {
      await act(async () => {
        portalMenu.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        await Promise.resolve();
      });
      await flushReact();

      expect(filterButton.getAttribute("aria-expanded")).toBe("true");
    } finally {
      document.body.removeChild(portalMenu);
    }
  });

  it("keeps the filter panel open when a project is selected from the dropdown", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildPnwProjectList());
    activeSession = await mountInboxList(buildPnwProjectList());
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(session.container, "All projects").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(document.body, "PNW Biodiversity").click();
      await Promise.resolve();
    });
    await flushReact();

    expect(findButtonByLabel(session.container, "Filters").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("keeps the current typed search query when project changes update the URL", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildPnwProjectList());
    activeSession = await mountInboxList(buildPnwProjectList(), {
      query: "darrel",
      isQueueLoading: false,
    });
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(session.container, "All projects").click();
      await Promise.resolve();
    });

    await act(async () => {
      findButtonByText(document.body, "PNW Biodiversity").click();
      await Promise.resolve();
    });

    expect(routerReplaceMock).toHaveBeenLastCalledWith(
      "/inbox?q=darrel&projectId=project-pnw",
      { scroll: false },
    );
    expect(
      session.container.querySelector<HTMLInputElement>(
        "[data-inbox-search-input='true']",
      )?.value,
    ).toBe("darrel");
  });

  it("replaces the clear-search control with a spinner while search is loading", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockReturnValue(new Promise(() => undefined));
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
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockReturnValue(new Promise(() => undefined));
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

  it("does not write below-threshold search text into the URL", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList(buildList(), {
      query: "da",
      isQueueLoading: false,
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    expect(routerReplaceMock).not.toHaveBeenCalledWith(
      "/inbox?q=da",
      expect.anything(),
    );
  });

  it("renders the primary project chip without the overflow count badge", async () => {
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
    expect(row?.textContent).not.toContain("+2");
  });

  // Connected-projects host/sub label: a Beech-only volunteer's row chip
  // shows "Beech & Butternut · via Saving American Beech" rather than just
  // "Beech" — same source of truth (the resolver's resolvedPrimaryProject)
  // that the conversation header uses.
  it("renders the host name with 'via {sub}' on the inbox row chip when the project is a connected sub", async () => {
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
            projectLabel: "Beech & Butternut",
            projectSubLabel: "Saving American Beech",
          },
        ],
      }),
    );

    const row = activeSession.container.querySelector(
      "[data-inbox-row='true']",
    );

    expect(row?.textContent).toContain("Beech & Butternut");
    expect(row?.textContent).toContain("via Saving American Beech");
  });

  it("renders only the project label on the inbox row chip when the project is standalone", async () => {
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
            projectLabel: "Whitebark Pines",
            projectSubLabel: null,
          },
        ],
      }),
    );

    const row = activeSession.container.querySelector(
      "[data-inbox-row='true']",
    );

    expect(row?.textContent).toContain("Whitebark Pines");
    expect(row?.textContent).not.toContain("via ");
  });

  it("renders staff-origin non-volunteer rows with an AS chip", async () => {
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
            contactId: "contact:email:admin@adventurescientists.org",
            displayName: "admin@adventurescientists.org",
            primaryEmail: "admin@adventurescientists.org",
            initials: "AD",
            projectLabel: null,
            volunteerStage: "non-volunteer",
          },
        ],
      }),
    );

    const row = activeSession.container.querySelector("[data-inbox-row='true']");

    expect(row?.textContent).toContain("AS");
    expect(row?.textContent).not.toContain("Amazon Basin");
    expect(row?.innerHTML).toContain("bg-emerald-50");
    expect(row?.innerHTML).not.toContain("External");
  });

  it("keeps genuine non-volunteer external rows on the External chip", async () => {
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
            contactId: "contact:email:partner@example.org",
            displayName: "Pat Partner",
            primaryEmail: "partner@example.org",
            initials: "PP",
            projectLabel: null,
            volunteerStage: "non-volunteer",
          },
        ],
      }),
    );

    const row = activeSession.container.querySelector("[data-inbox-row='true']");

    expect(row?.textContent).toContain("External");
    expect(row?.innerHTML).toContain("bg-amber-50");
    expect(row?.innerHTML).not.toContain(">AS<");
  });

  it("does NOT render an 'All contacts' left-rail entry (unified search replaces the dedicated route)", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    activeSession = await mountInboxList();
    const session = activeSession;

    await act(async () => {
      findButtonByLabel(session.container, "Filters").click();
      await Promise.resolve();
    });

    expect(session.container.textContent).not.toContain("All contacts");
    expect(
      session.container.querySelector('a[href="/inbox/all-contacts"]'),
    ).toBeNull();
  });

  it("renders the Volunteers and Contacts section labels when both sections have results", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockResolvedValue({
      query: "Eli",
      volunteers: [
        {
          contactId: "contact:eliza",
          displayName: "Eliza Tate",
          initials: "ET",
          avatarTone: "violet",
          primaryEmail: "eliza.tate@example.org",
          primaryPhone: null,
          projectLabel: "Pollinator Watch",
          hasMembership: true,
          hasProjection: false,
          lastActivityAt: "2026-04-22T12:00:00.000Z",
          lastActivityLabel: "1d ago",
          latestSubject: null,
          snippet: null,
          latestChannel: null,
          lastEventType: null,
        },
      ],
      contacts: [
        {
          contactId: "contact:elias",
          displayName: "elias.partner@example.org",
          initials: "EP",
          avatarTone: "amber",
          primaryEmail: "elias.partner@example.org",
          primaryPhone: null,
          projectLabel: null,
          hasMembership: false,
          hasProjection: false,
          lastActivityAt: null,
          lastActivityLabel: "",
          latestSubject: null,
          snippet: null,
          latestChannel: null,
          lastEventType: null,
        },
      ],
      totals: { volunteers: 1, contacts: 1 },
    });

    activeSession = await mountInboxList(buildList(), {
      query: "Eli",
      isQueueLoading: false,
    });
    await flushReact();

    expect(activeSession.container.textContent).toContain("Eliza Tate");
    expect(activeSession.container.textContent).toContain(
      "elias.partner@example.org",
    );
    // Section labels render when both sections are non-empty.
    const volunteersSection = activeSession.container.querySelector(
      'section[aria-label="Volunteers"]',
    );
    const contactsSection = activeSession.container.querySelector(
      'section[aria-label="Contacts"]',
    );
    expect(volunteersSection).not.toBeNull();
    expect(contactsSection).not.toBeNull();
    expect(volunteersSection?.textContent).toContain("Volunteers");
    expect(contactsSection?.textContent).toContain("Contacts");
  });

  it("renders volunteer rows in full-row format and contact rows in compact single-line format", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockResolvedValue({
      query: "Eli",
      volunteers: [
        {
          contactId: "contact:eliza",
          displayName: "Eliza Tate",
          initials: "ET",
          avatarTone: "violet",
          primaryEmail: "eliza.tate@example.org",
          primaryPhone: null,
          projectLabel: "Pollinator Watch",
          hasMembership: true,
          hasProjection: true,
          lastActivityAt: "2026-04-22T12:00:00.000Z",
          lastActivityLabel: "1d ago",
          latestSubject: "Re: question",
          snippet: "Thanks for the update.",
          latestChannel: "email",
          lastEventType: "communication.email.inbound",
        },
      ],
      contacts: [
        {
          contactId: "contact:emailonly",
          displayName: "elias.partner@example.org",
          initials: "EP",
          avatarTone: "amber",
          primaryEmail: "elias.partner@example.org",
          primaryPhone: null,
          projectLabel: null,
          hasMembership: false,
          hasProjection: false,
          lastActivityAt: null,
          lastActivityLabel: "",
          latestSubject: null,
          snippet: null,
          latestChannel: null,
          lastEventType: null,
        },
        {
          contactId: "contact:named",
          displayName: "Maya Patel",
          initials: "MP",
          avatarTone: "sky",
          primaryEmail: "maya.patel@example.org",
          primaryPhone: null,
          projectLabel: null,
          hasMembership: false,
          hasProjection: false,
          lastActivityAt: null,
          lastActivityLabel: "",
          latestSubject: null,
          snippet: null,
          latestChannel: null,
          lastEventType: null,
        },
      ],
      totals: { volunteers: 1, contacts: 2 },
    });

    activeSession = await mountInboxList(buildList(), {
      query: "Eli",
      isQueueLoading: false,
    });
    await flushReact();

    // Volunteer row uses the full-row format — the snippet line should be
    // rendered (snippet text appears).
    expect(activeSession.container.textContent).toContain("Thanks for the update.");
    // Volunteer row shows a time-ago label.
    expect(activeSession.container.textContent).toContain("1d ago");

    // Contact rows use the compact format — both must carry the compact
    // attribute marker we exposed on the row.
    const compactRows = activeSession.container.querySelectorAll(
      "[data-inbox-search-row-compact='true']",
    );
    expect(compactRows.length).toBe(2);

    // Email-only contact: rendered text is just the email (no separator).
    const emailOnlyRow = activeSession.container.querySelector(
      "[data-contact-id='contact:emailonly']",
    );
    expect((emailOnlyRow?.textContent ?? "").trim()).toBe(
      "elias.partner@example.org",
    );
    expect(emailOnlyRow?.textContent ?? "").not.toContain(" · ");

    // Named contact: rendered text is "Name · email".
    const namedRow = activeSession.container.querySelector(
      "[data-contact-id='contact:named']",
    );
    expect(namedRow?.textContent ?? "").toContain("Maya Patel");
    expect(namedRow?.textContent ?? "").toContain(" · ");
    expect(namedRow?.textContent ?? "").toContain("maya.patel@example.org");
  });

  it("does not render a body-match section or any <mark> highlights", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockResolvedValue({
      query: "Eli",
      volunteers: [
        {
          contactId: "contact:eliza",
          displayName: "Eliza Tate",
          initials: "ET",
          avatarTone: "violet",
          primaryEmail: "eliza.tate@example.org",
          primaryPhone: null,
          projectLabel: "Pollinator Watch",
          hasMembership: true,
          hasProjection: true,
          lastActivityAt: "2026-04-22T12:00:00.000Z",
          lastActivityLabel: "1d ago",
          latestSubject: "Re: question",
          snippet: "Thanks Eli for the update.",
          latestChannel: "email",
          lastEventType: "communication.email.inbound",
        },
      ],
      contacts: [],
      totals: { volunteers: 1, contacts: 0 },
    });

    activeSession = await mountInboxList(buildList(), {
      query: "Eli",
      isQueueLoading: false,
    });
    await flushReact();

    // The body-match section was named "Message matches" — should not
    // appear at all.
    expect(activeSession.container.textContent).not.toContain("Message matches");
    // No <mark> element should be rendered (we dropped highlighting).
    expect(activeSession.container.querySelector("mark")).toBeNull();
  });

  it("returns to the folder-filtered list when the search is cleared", async () => {
    fetchInboxListPageMock.mockResolvedValue(buildList());
    fetchInboxUnifiedSearchMock.mockResolvedValue({
      query: "Eli",
      volunteers: [
        {
          contactId: "contact:eliza",
          displayName: "Eliza Tate",
          initials: "ET",
          avatarTone: "violet",
          primaryEmail: "eliza.tate@example.org",
          primaryPhone: null,
          projectLabel: null,
          hasMembership: true,
          hasProjection: false,
          lastActivityAt: "2026-04-22T12:00:00.000Z",
          lastActivityLabel: "1d ago",
          latestSubject: null,
          snippet: null,
          latestChannel: null,
          lastEventType: null,
        },
      ],
      contacts: [],
      totals: { volunteers: 1, contacts: 0 },
    });

    activeSession = await mountInboxList(buildList(), {
      query: "Eli",
      isQueueLoading: false,
    });
    await flushReact();

    expect(activeSession.container.textContent).toContain("Eliza Tate");

    await activeSession.rerender({ query: "", isQueueLoading: false });
    await flushReact();

    expect(activeSession.container.textContent).not.toContain("Eliza Tate");
    expect(activeSession.container.textContent).toContain("Riley Carter");
  });

  it("surfaces the HTTP status in the refresh-failed banner", async () => {
    const fetchError = Object.assign(new Error("Request failed with status 502."), {
      name: "InboxFetchError",
      status: 502,
    });
    fetchInboxListPageMock.mockRejectedValue(fetchError);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    activeSession = await mountInboxList(buildPnwProjectList());
    await flushReact();

    expect(activeSession.container.textContent).toContain("HTTP 502");
    expect(activeSession.container.textContent).toContain(
      "Keeping the last loaded rows.",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "inbox.refresh.failed",
      expect.objectContaining({
        status: 502,
        name: "InboxFetchError",
      }),
    );

    warnSpy.mockRestore();
  });

  it("labels TypeError network failures in the refresh-failed banner", async () => {
    const networkError = new TypeError("Failed to fetch");
    fetchInboxListPageMock.mockRejectedValue(networkError);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    activeSession = await mountInboxList(buildPnwProjectList());
    await flushReact();

    expect(activeSession.container.textContent).toContain("network error");
    expect(activeSession.container.textContent).toContain(
      "Keeping the last loaded rows.",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "inbox.refresh.failed",
      expect.objectContaining({
        status: null,
        name: "TypeError",
      }),
    );

    warnSpy.mockRestore();
  });

  it("suppresses AbortError silently — no banner, no console warn", async () => {
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";
    fetchInboxListPageMock.mockRejectedValue(abortError);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    activeSession = await mountInboxList(buildPnwProjectList());
    await flushReact();

    expect(activeSession.container.textContent).not.toContain(
      "Inbox refresh failed",
    );
    expect(activeSession.container.textContent).not.toContain("HTTP");
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
