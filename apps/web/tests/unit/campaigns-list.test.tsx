import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    readonly children: React.ReactNode;
    readonly href: string;
    readonly prefetch?: boolean;
    readonly [key: string]: unknown;
  }) => {
    void prefetch;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const replaceMock = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => "/broadcasts",
  useSearchParams: () => searchParamsValue,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <>{children}</>,
  DropdownMenuContent: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({
    children,
    onSelect,
  }: {
    readonly children: React.ReactNode;
    readonly onSelect?: (event: React.MouseEvent<HTMLDivElement>) => void;
  }) => <div onClick={onSelect}>{children}</div>,
}));

import { CampaignsList } from "../../app/broadcasts/_components/campaigns-list";

type CampaignListItem = React.ComponentProps<
  typeof CampaignsList
>["items"][number];

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    },
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

let root: Root | null = null;
let domWindow: (Window & typeof globalThis & { close: () => void }) | null =
  null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts",
    pretendToBeVisual: true,
  });

  domWindow = dom.window;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.Event = dom.window.Event;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
  } as typeof ResizeObserver;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  return container;
}

function renderList(
  container: HTMLElement,
  props: Partial<React.ComponentProps<typeof CampaignsList>> = {},
) {
  act(() => {
    root?.render(
      <CampaignsList
        items={[]}
        projectOptions={[]}
        selectedProjectIds={[]}
        tabs={[
          { id: "all", label: "All", count: 0 },
          { id: "drafts", label: "Drafts", count: 0 },
          { id: "scheduled", label: "Scheduled", count: 0 },
          { id: "sending", label: "Sending", count: 0 },
          { id: "complete", label: "Complete", count: 0 },
          { id: "cancelled", label: "Cancelled", count: 0 },
        ]}
        activeFilterId="all"
        searchQuery=""
        page={1}
        totalPages={1}
        totalCount={0}
        showNewCampaignCta
        {...props}
      />,
    );
  });

  return container.innerHTML;
}

function makeCampaignRow(index: number): CampaignListItem {
  return {
    runId: `postmark-${String(index + 1)}`,
    provider: "postmark",
    name: `Broadcast ${String(index + 1)}`,
    kind: "project",
    launchType: "normal_email",
    state: "complete",
    audienceType: "project",
    projectId: "project-1",
    projectName: "Forests",
    projectAlias: "forests",
    projectLabel: "Forests",
    sender: "forests@adventurescientists.org",
    subject: `Subject ${String(index + 1)}`,
    previewText: "Field update.",
    audienceSize: 100 + index,
    scheduledAt: null,
    startedAt: "2026-05-14T15:00:00.000Z",
    completedAt: "2026-05-14T15:25:00.000Z",
    cancelledAt: null,
    createdAt: "2026-05-14T14:30:00.000Z",
    updatedAt: "2026-05-14T15:25:00.000Z",
    selectedContactCount: 0,
    sentCount: 100 + index,
    openedCount: 42 + index,
  };
}

beforeEach(() => {
  replaceMock.mockReset();
  searchParamsValue = new URLSearchParams();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  domWindow?.close();
  domWindow = null;
});

describe("broadcasts list snapshots", () => {
  it("matches the empty state snapshot", () => {
    const container = setupDom();
    const html = renderList(container);

    expect(html).toMatchSnapshot();
  });

  it("matches the broadcast list snapshot", () => {
    const container = setupDom();
    const rows = [
      {
        runId: "postmark-1",
        provider: "postmark",
        name: null,
        kind: "project",
        launchType: "normal_email",
        state: "draft",
        audienceType: "project",
        projectId: "project-1",
        projectName: "Forests",
        projectAlias: "forests",
        projectLabel: "Forests",
        sender: "forests@adventurescientists.org",
        subject: "",
        previewText: null,
        audienceSize: 112,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-15T10:00:00.000Z",
        updatedAt: "2026-05-15T10:00:00.000Z",
        selectedContactCount: 0,
        sentCount: null,
        openedCount: null,
      },
      {
        runId: "postmark-2",
        provider: "postmark",
        name: "Volunteer dispatch",
        kind: "project",
        launchType: "normal_email",
        state: "scheduled",
        audienceType: "project",
        projectId: "project-2",
        projectName: "Killer Whales",
        projectAlias: "whales",
        projectLabel: "Whales",
        sender: "whales@adventurescientists.org",
        subject: "Volunteer dispatch subject",
        previewText: "Field logistics and launch reminders.",
        audienceSize: 86,
        scheduledAt: "2026-05-20T18:00:00.000Z",
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-15T11:00:00.000Z",
        updatedAt: "2026-05-15T11:30:00.000Z",
        selectedContactCount: 0,
        sentCount: 0,
        openedCount: 0,
      },
      {
        runId: "postmark-3",
        provider: "postmark",
        name: "Field bulletin",
        kind: "newsletter",
        launchType: "html_email",
        state: "sending",
        audienceType: "newsletter",
        projectId: null,
        projectName: null,
        projectAlias: null,
        projectLabel: null,
        sender: "hello@adventurescientists.org",
        subject: "May field bulletin",
        previewText: "Broadcast update.",
        audienceSize: 240,
        scheduledAt: null,
        startedAt: "2026-05-14T15:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-14T14:30:00.000Z",
        updatedAt: "2026-05-14T15:05:00.000Z",
        selectedContactCount: 0,
        sentCount: 128,
        openedCount: 0,
      },
      {
        runId: "postmark-4",
        provider: "postmark",
        name: "Trailhead update",
        kind: "project",
        launchType: "normal_email",
        state: "complete",
        audienceType: "specific",
        projectId: "project-1",
        projectName: "Forests",
        projectAlias: "forests",
        projectLabel: "Forests",
        sender: "forests@adventurescientists.org",
        subject: "Quick note before your next survey day.",
        previewText: "Quick note before your next survey day.",
        audienceSize: 240,
        scheduledAt: null,
        startedAt: "2026-05-14T15:00:00.000Z",
        completedAt: "2026-05-14T15:25:00.000Z",
        cancelledAt: null,
        createdAt: "2026-05-14T14:30:00.000Z",
        updatedAt: "2026-05-14T15:25:00.000Z",
        selectedContactCount: 18,
        sentCount: 240,
        openedCount: 124,
      },
      {
        runId: "postmark-5",
        provider: "postmark",
        name: "Route closed update",
        kind: "project",
        launchType: "normal_email",
        state: "cancelled",
        audienceType: "project",
        projectId: "project-1",
        projectName: "Forests",
        projectAlias: "forests",
        projectLabel: "Forests",
        sender: "forests@adventurescientists.org",
        subject: "Storm delay update",
        previewText: "Storm delay update.",
        audienceSize: 240,
        scheduledAt: null,
        startedAt: "2026-04-10T12:00:00.000Z",
        completedAt: null,
        cancelledAt: "2026-04-10T12:45:00.000Z",
        createdAt: "2026-04-10T12:00:00.000Z",
        updatedAt: "2026-04-10T13:00:00.000Z",
        selectedContactCount: 0,
        sentCount: 61,
        openedCount: 12,
      },
    ] as const;

    const html = renderList(container, {
      items: rows,
      projectOptions: [
        { id: "project-1", label: "Forests" },
        { id: "project-2", label: "Killer Whales" },
      ],
      tabs: [
        { id: "all", label: "All", count: 5 },
        { id: "drafts", label: "Drafts", count: 1 },
        { id: "scheduled", label: "Scheduled", count: 1 },
        { id: "sending", label: "Sending", count: 1 },
        { id: "complete", label: "Complete", count: 1 },
        { id: "cancelled", label: "Cancelled", count: 1 },
      ],
      totalCount: 5,
    });

    expect(html).toMatchSnapshot();
  });

  it("renders centered pagination links with the current page selected", () => {
    const container = setupDom();
    searchParamsValue = new URLSearchParams(
      "state=scheduled&projectId=project-1&q=whale&page=2",
    );

    renderList(container, {
      items: Array.from({ length: 25 }, (_, index) => makeCampaignRow(index)),
      activeFilterId: "scheduled",
      selectedProjectIds: ["project-1"],
      searchQuery: "whale",
      page: 2,
      totalPages: 4,
      totalCount: 100,
    });

    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe(
      "2",
    );
    expect(
      new URL(
        container
          .querySelector('a[aria-label="Go to next page"]')
          ?.getAttribute("href") ?? "",
        "http://localhost",
      ).searchParams.toString(),
    ).toBe("state=scheduled&q=whale&page=3&projectId=project-1");
    expect(
      new URL(
        container
          .querySelector('a[aria-label="Go to previous page"]')
          ?.getAttribute("href") ?? "",
        "http://localhost",
      ).searchParams.toString(),
    ).toBe("state=scheduled&q=whale&projectId=project-1");
  });

  it("links a draft row to the compose wizard, not the run-detail report", () => {
    const container = setupDom();

    renderList(container, {
      items: [
        { ...makeCampaignRow(0), runId: "draft-1", name: null, state: "draft" },
        { ...makeCampaignRow(1), runId: "sent-1", state: "complete" },
      ],
      totalCount: 2,
    });

    expect(
      container
        .querySelector('a[data-campaign-state="draft"]')
        ?.getAttribute("href"),
    ).toBe("/broadcasts/new?runId=draft-1");
    expect(
      container
        .querySelector('a[data-campaign-state="complete"]')
        ?.getAttribute("href"),
    ).toBe("/broadcasts/sent-1");
  });

  it("does not navigate when the active state tab is selected again", () => {
    const container = setupDom();

    renderList(container, {
      items: [makeCampaignRow(0)],
      tabs: [
        { id: "all", label: "All", count: 1 },
        { id: "drafts", label: "Drafts", count: 0 },
        { id: "scheduled", label: "Scheduled", count: 0 },
        { id: "sending", label: "Sending", count: 0 },
        { id: "complete", label: "Complete", count: 1 },
        { id: "cancelled", label: "Cancelled", count: 0 },
      ],
      totalCount: 1,
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-campaign-tab="all"]')
        ?.click();
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("drops the page param when changing state tabs", () => {
    const container = setupDom();
    searchParamsValue = new URLSearchParams("page=3");

    renderList(container, {
      items: [makeCampaignRow(0)],
      tabs: [
        { id: "all", label: "All", count: 1 },
        { id: "drafts", label: "Drafts", count: 0 },
        { id: "scheduled", label: "Scheduled", count: 0 },
        { id: "sending", label: "Sending", count: 0 },
        { id: "complete", label: "Complete", count: 1 },
        { id: "cancelled", label: "Cancelled", count: 0 },
      ],
      totalCount: 1,
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      "[data-campaign-search]",
    );
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Expected broadcast search input to render.");
    }

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "whale");
      searchInput.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "whale",
          inputType: "insertText",
        }),
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-campaign-tab="complete"]')
        ?.click();
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/broadcasts?state=complete&q=whale",
      { scroll: false },
    );
  });

  it("drops the page param when changing project filters", () => {
    const container = setupDom();
    searchParamsValue = new URLSearchParams("page=3");

    renderList(container, {
      items: [makeCampaignRow(0)],
      projectOptions: [{ id: "project-kelp", label: "Kelp Forests" }],
      tabs: [
        { id: "all", label: "All", count: 1 },
        { id: "drafts", label: "Drafts", count: 0 },
        { id: "scheduled", label: "Scheduled", count: 0 },
        { id: "sending", label: "Sending", count: 0 },
        { id: "complete", label: "Complete", count: 1 },
        { id: "cancelled", label: "Cancelled", count: 0 },
      ],
      totalCount: 1,
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      "[data-campaign-search]",
    );
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Expected broadcast search input to render.");
    }

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "whale");
      searchInput.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "whale",
          inputType: "insertText",
        }),
      );
    });

    const projectOption = Array.from(
      container.querySelectorAll("button + div > div"),
    ).find((element) => element.textContent === "Kelp Forests");
    if (!(projectOption instanceof HTMLElement)) {
      throw new Error("Expected Forests project option to render.");
    }

    act(() => {
      projectOption.click();
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/broadcasts?projectId=project-kelp&q=whale",
      { scroll: false },
    );
  });
});
