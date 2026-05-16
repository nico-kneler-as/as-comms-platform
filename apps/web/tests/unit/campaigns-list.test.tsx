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
    return <a href={href} {...props}>{children}</a>;
  },
}));

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => "/campaigns",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { readonly children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <div>{children}</div>,
}));

import { CampaignsList } from "../../app/campaigns/_components/campaigns-list";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    }
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

let root: Root | null = null;
let domWindow: (Window & typeof globalThis & { close: () => void }) | null = null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/campaigns",
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

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
        totalCount={0}
        showNewCampaignCta
        {...props}
      />,
    );
  });

  return container.innerHTML;
}

beforeEach(() => {
  replaceMock.mockReset();
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

describe("CampaignsList snapshots", () => {
  it("matches the empty state snapshot", () => {
    const container = setupDom();
    const html = renderList(container);

    expect(html).toMatchSnapshot();
  });

  it("matches the mixed-provider list snapshot", () => {
    const container = setupDom();
    const rows = [
      {
        runId: "postmark-1",
        provider: "postmark",
        kind: "project",
        launchType: "normal_email",
        state: "draft",
        projectId: "project-1",
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
      },
      {
        runId: "postmark-2",
        provider: "postmark",
        kind: "project",
        launchType: "normal_email",
        state: "scheduled",
        projectId: "project-2",
        projectLabel: "Killer Whales",
        sender: "whales@adventurescientists.org",
        subject: "Volunteer dispatch",
        previewText: "Field logistics and launch reminders.",
        audienceSize: 86,
        scheduledAt: "2026-05-20T18:00:00.000Z",
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-15T11:00:00.000Z",
        updatedAt: "2026-05-15T11:30:00.000Z",
      },
      {
        runId: "postmark-3",
        provider: "postmark",
        kind: "project",
        launchType: "normal_email",
        state: "complete",
        projectId: "project-1",
        projectLabel: "Forests",
        sender: "forests@adventurescientists.org",
        subject: "Trailhead update",
        previewText: "Quick note before your next survey day.",
        audienceSize: 240,
        scheduledAt: null,
        startedAt: "2026-05-14T15:00:00.000Z",
        completedAt: "2026-05-14T15:25:00.000Z",
        cancelledAt: null,
        createdAt: "2026-05-14T14:30:00.000Z",
        updatedAt: "2026-05-14T15:25:00.000Z",
      },
      {
        runId: "mailchimp-1",
        provider: "mailchimp",
        kind: "newsletter",
        launchType: "html_email",
        state: "complete",
        projectId: null,
        projectLabel: null,
        sender: "",
        subject: "April newsletter",
        previewText: "Field stories from across the network.",
        audienceSize: null,
        scheduledAt: null,
        startedAt: "2026-04-10T12:00:00.000Z",
        completedAt: "2026-04-10T12:45:00.000Z",
        cancelledAt: null,
        createdAt: "2026-04-10T12:00:00.000Z",
        updatedAt: "2026-04-10T13:00:00.000Z",
      },
      {
        runId: "mailchimp-2",
        provider: "mailchimp",
        kind: "newsletter",
        launchType: "html_email",
        state: "complete",
        projectId: null,
        projectLabel: null,
        sender: "",
        subject: "May newsletter",
        previewText: "What volunteers need to know this month.",
        audienceSize: null,
        scheduledAt: null,
        startedAt: "2026-05-01T12:00:00.000Z",
        completedAt: "2026-05-01T12:30:00.000Z",
        cancelledAt: null,
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:35:00.000Z",
      },
      {
        runId: "mailchimp-3",
        provider: "mailchimp",
        kind: "newsletter",
        launchType: "html_email",
        state: "complete",
        projectId: null,
        projectLabel: null,
        sender: "",
        subject: "Winter highlights",
        previewText: "Historic archive import row.",
        audienceSize: null,
        scheduledAt: null,
        startedAt: "2026-02-03T09:00:00.000Z",
        completedAt: "2026-02-03T09:25:00.000Z",
        cancelledAt: null,
        createdAt: "2026-02-03T09:00:00.000Z",
        updatedAt: "2026-02-03T09:30:00.000Z",
      },
    ] as const;

    const html = renderList(container, {
      items: rows,
      projectOptions: [
        { id: "project-1", label: "Forests" },
        { id: "project-2", label: "Killer Whales" },
      ],
      tabs: [
        { id: "all", label: "All", count: 6 },
        { id: "drafts", label: "Drafts", count: 1 },
        { id: "scheduled", label: "Scheduled", count: 1 },
        { id: "sending", label: "Sending", count: 0 },
        { id: "complete", label: "Complete", count: 4 },
        { id: "cancelled", label: "Cancelled", count: 0 },
      ],
      totalCount: 6,
    });

    expect(html).toMatchSnapshot();
  });
});
