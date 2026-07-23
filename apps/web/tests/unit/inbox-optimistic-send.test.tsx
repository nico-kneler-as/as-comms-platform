import { createRequire } from "node:module";
import React, { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

Object.assign(globalThis, { React });

import { InboxClientProvider, useInboxClient } from "../../app/inbox/_components/inbox-client-provider";
import type {
  InboxTimelineEntryViewModel,
  OptimisticOutbound,
} from "../../app/inbox/_lib/view-models";

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
  const w = dom.window;
  const entries = {
    document: w.document,
    Element: w.Element,
    Event: w.Event,
    HTMLElement: w.HTMLElement,
    Node: w.Node,
    navigator: w.navigator,
    self: w,
    window: w,
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
    id: "timeline:1",
    kind: "outbound-email",
    occurredAt: "2026-05-01T10:00:00.000Z",
    occurredAtLabel: "Just now",
    actorLabel: "Operator",
    subject: "Subject",
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
      sendStatus: "pending",
      occurredAt: "2026-05-01T10:00:01.000Z",
      occurredAtLabel: "Just now",
    }),
    contactId: "contact-1",
    clientGeneratedId: "client-1",
    createdAt: Date.now(),
    settledAt: null,
    ...overrides,
  };
}

function mergeTimeline(
  serverEntries: readonly InboxTimelineEntryViewModel[],
  optimisticOutbounds: readonly OptimisticOutbound[],
  activeContactId: string,
) {
  const activeOptimistic = optimisticOutbounds.filter(
    (entry) => entry.contactId === activeContactId,
  );

  const visibleOptimistic = activeOptimistic.filter(
    (entry) =>
      !(
        entry.settledAt !== null &&
        serverEntries.some(
          (serverEntry) =>
            serverEntry.kind === entry.kind &&
            serverEntry.subject === entry.subject &&
            serverEntry.mailbox === entry.mailbox &&
            serverEntry.occurredAt >= entry.occurredAt,
        )
      ),
  );

  return [...serverEntries, ...visibleOptimistic].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

type ClientApi = ReturnType<typeof useInboxClient>;

let latestClient: ClientApi | null = null;

function Harness({
  activeContactId,
  serverEntries,
}: {
  readonly activeContactId: string;
  readonly serverEntries: readonly InboxTimelineEntryViewModel[];
}) {
  const client = useInboxClient();
  latestClient = client;

  useEffect(() => {
    return () => {
      latestClient = null;
    };
  }, []);

  const mergedEntries = mergeTimeline(
    serverEntries,
    client.optimisticOutbounds,
    activeContactId,
  );

  return createElement(
    "div",
    null,
    createElement(
      "ul",
      { "data-testid": "timeline" },
      mergedEntries.map((entry) =>
        createElement(
          "li",
          {
            key: entry.id,
            "data-entry-id": entry.id,
            "data-send-status": entry.sendStatus ?? "none",
          },
          `${entry.subject ?? "(no subject)"}|${entry.sendStatus ?? "none"}`,
        ),
      ),
    ),
  );
}

interface RenderSession {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly rerender: (props: {
    readonly activeContactId: string;
    readonly serverEntries: readonly InboxTimelineEntryViewModel[];
  }) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

async function renderHarness(props: {
  readonly activeContactId: string;
  readonly serverEntries: readonly InboxTimelineEntryViewModel[];
}): Promise<RenderSession> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = async (nextProps: {
    readonly activeContactId: string;
    readonly serverEntries: readonly InboxTimelineEntryViewModel[];
  }) => {
    await act(async () => {
      root.render(
        createElement(
          InboxClientProvider,
          {
            composerAliases: [],
            initialDrafts: [],
            currentActorId: "user-1",
            operatorDisplayName: "Operator Name",
            children: createElement(Harness, nextProps),
          },
        ),
      );
      await Promise.resolve();
    });
  };

  await render(props);

  const cleanup = async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
  };

  activeSession = {
    container,
    root,
    rerender: render,
    cleanup,
  };

  return activeSession;
}

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
  latestClient = null;
});

describe("Inbox optimistic send provider", () => {
  it("shows an optimistic bubble after addOptimisticOutbound", async () => {
    const session = await renderHarness({
      activeContactId: "contact-1",
      serverEntries: [],
    });

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      await Promise.resolve();
    });

    expect(session.container.textContent).toContain("Subject|pending");
  });

  it("hides the settled optimistic bubble once the real entry arrives", async () => {
    const session = await renderHarness({
      activeContactId: "contact-1",
      serverEntries: [],
    });

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      latestClient?.markOptimisticSettled("client-1");
      await Promise.resolve();
    });

    await session.rerender({
      activeContactId: "contact-1",
      serverEntries: [
        buildEntry({
          id: "timeline:real",
          occurredAt: "2026-05-01T10:00:02.000Z",
        }),
      ],
    });

    const text = session.container.textContent;
    expect(text).toContain("Subject|confirmed");
    expect(text).not.toContain("Subject|pending");
  });

  it('keeps the bubble visible and failed after markOptimisticFailed', async () => {
    await renderHarness({
      activeContactId: "contact-1",
      serverEntries: [],
    });

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      latestClient?.markOptimisticFailed("client-1", "Mailbox unavailable");
      await Promise.resolve();
    });

    expect(latestClient?.optimisticOutbounds[0]?.sendStatus).toBe("failed");
  });

  it("clears optimistic outbounds for the previous contact", async () => {
    const session = await renderHarness({
      activeContactId: "contact-1",
      serverEntries: [],
    });

    await act(async () => {
      latestClient?.addOptimisticOutbound(buildOptimistic());
      latestClient?.clearOptimisticForContact("contact-1");
      await Promise.resolve();
    });

    await session.rerender({
      activeContactId: "contact-2",
      serverEntries: [],
    });

    expect(session.container.textContent).not.toContain("Subject|pending");
  });
});
