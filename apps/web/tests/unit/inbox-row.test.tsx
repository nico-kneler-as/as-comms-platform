import { createRequire } from "node:module";
import React, { act, type ReactNode } from "react";

Object.assign(globalThis, { React });

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxListItemViewModel } from "../../app/inbox/_lib/view-models";

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
    return <a href={href} {...anchorProps}>{children}</a>;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: routerPrefetchMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../app/inbox/_components/inbox-avatar", () => ({
  InboxAvatar: ({
    initials,
  }: {
    readonly initials: string;
  }) => <div data-testid="inbox-avatar">{initials}</div>,
}));

function iconMock(name: string) {
  return (props: Record<string, unknown>) => (
    <svg data-icon={name} {...props} />
  );
}

vi.mock("../../app/inbox/_components/icons", () => ({
  FlagIcon: iconMock("FlagIcon"),
  MailIcon: iconMock("MailIcon"),
  PhoneIcon: iconMock("PhoneIcon"),
}));

import { InboxRow } from "../../app/inbox/_components/inbox-row";

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
  readonly cleanup: () => void;
}

let activeSession: RenderSession | null = null;

const baseItem: InboxListItemViewModel = {
  contactId: "contact-1",
  displayName: "Alex Johnson",
  primaryEmail: "alex@example.com",
  initials: "AJ",
  avatarTone: "sky",
  latestSubject: "Latest subject",
  snippet: "Latest snippet",
  latestChannel: "email",
  projectLabel: "Beech & Butternut",
  projectSubLabel: null,
  additionalActiveProjectsCount: 0,
  volunteerStage: "active",
  bucket: "new",
  needsFollowUp: false,
  hasUnresolved: false,
  isArchived: false,
  isUnread: true,
  unreadCount: 1,
  isUnanswered: false,
  lastInboundAt: "2026-05-12T10:00:00.000Z",
  lastNonAliasMessageAt: "2026-05-12T10:00:00.000Z",
  lastOutboundAt: "2026-05-11T10:00:00.000Z",
  lastActivityAt: "2026-05-12T10:00:00.000Z",
  lastEventType: "communication.email.inbound",
  lastActivityLabel: "1h",
};

afterEach(() => {
  activeSession?.cleanup();
  activeSession = null;
  routerPrefetchMock.mockReset();
});

function renderRow(
  overrides: Partial<InboxListItemViewModel> = {},
): HTMLElement {
  const item = {
    ...baseItem,
    ...overrides,
  };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousNode = globalThis.Node;
  const previousMutationObserver = globalThis.MutationObserver;

  Object.defineProperties(globalThis, {
    window: {
      configurable: true,
      value: dom.window,
    },
    document: {
      configurable: true,
      value: dom.window.document,
    },
    navigator: {
      configurable: true,
      value: dom.window.navigator,
    },
    HTMLElement: {
      configurable: true,
      value: dom.window.HTMLElement,
    },
    Node: {
      configurable: true,
      value: dom.window.Node,
    },
    MutationObserver: {
      configurable: true,
      value: dom.window.MutationObserver,
    },
  });

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <ul>
        <InboxRow item={item} isActive={false} />
      </ul>,
    );
  });

  activeSession = {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      dom.window.close();
      Object.defineProperties(globalThis, {
        window: {
          configurable: true,
          value: previousWindow,
        },
        document: {
          configurable: true,
          value: previousDocument,
        },
        navigator: {
          configurable: true,
          value: previousNavigator,
        },
        HTMLElement: {
          configurable: true,
          value: previousHTMLElement,
        },
        Node: {
          configurable: true,
          value: previousNode,
        },
        MutationObserver: {
          configurable: true,
          value: previousMutationObserver,
        },
      });
    },
  };

  return container;
}

describe("InboxRow unread dot", () => {
  it("renders the unread dot when the unread row also has badges", () => {
    const container = renderRow();
    const dot = container.querySelector('[data-testid="inbox-row-unread-dot"]');
    const srOnlyLabel = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent === "Unread",
    );

    expect(dot).not.toBeNull();
    expect(container.textContent).toContain("Beech & Butternut");
    expect(srOnlyLabel?.className).toContain("sr-only");
  });

  it("renders the unread dot when the unread row has no badges", () => {
    const container = renderRow({
      isUnread: true,
      projectLabel: null,
      needsFollowUp: false,
      volunteerStage: "active",
      primaryEmail: "alex@example.com",
    });

    expect(
      container.querySelector('[data-testid="inbox-row-unread-dot"]'),
    ).not.toBeNull();
  });

  it("does not render the unread dot for read rows", () => {
    const container = renderRow({
      isUnread: false,
      bucket: "opened",
      unreadCount: 0,
    });

    expect(
      container.querySelector('[data-testid="inbox-row-unread-dot"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Unread");
  });
});
