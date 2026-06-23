import { createRequire } from "node:module";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InboxClientProvider, useInboxClient } from "../../app/inbox/_components/inbox-client-provider";
import { InboxDraftsList } from "../../app/inbox/_components/inbox-drafts-list";
import type { InboxDraftListItemViewModel } from "../../app/inbox/_lib/view-models";

Object.assign(globalThis, { React });

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: { readonly url?: string },
  ) => {
    readonly window: Window & typeof globalThis;
  };
};

const deleteComposerDraftActionMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    data: { deletedCount: 1 },
  }),
);

function iconMock(name: string) {
  return (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });
}

vi.mock("lucide-react", () => ({
  FilePen: iconMock("FilePen"),
  Mail: iconMock("Mail"),
  Phone: iconMock("Phone"),
  FileText: iconMock("FileText"),
  Trash2: iconMock("Trash2"),
}));

vi.mock("@/src/server/composer/drafts", () => ({
  deleteComposerDraftAction: deleteComposerDraftActionMock,
}));

function DraftProbe() {
  const { composerPane, pendingExistingDraft } = useInboxClient();

  return (
    <output data-testid="draft-probe">
      {composerPane.mode}:{pendingExistingDraft?.id ?? "none"}
    </output>
  );
}

const drafts: readonly InboxDraftListItemViewModel[] = [
  {
    id: "draft-email",
    paneMode: "new_draft",
    channel: "email",
    recipientContactId: "contact-1",
    recipientEmail: "maya@example.org",
    recipientPhone: null,
    recipientDisplayName: "Maya Lee",
    subject: "Trip logistics",
    bodyPlaintext: "Email body preview for the first draft.",
    bodyHtml: "<p>Email body preview for the first draft.</p>",
    selectedAlias: "forests@adventurescientists.org",
    cc: [],
    bcc: [],
    attachments: [],
    aiDirective: "",
    replyContext: null,
    forwardContext: null,
    updatedAt: "2026-06-19T10:00:00.000Z",
  },
  {
    id: "draft-sms",
    paneMode: "replying",
    channel: "sms",
    recipientContactId: "contact-2",
    recipientEmail: null,
    recipientPhone: "+14065550123",
    recipientDisplayName: "Alex Stone",
    subject: "",
    bodyPlaintext: "SMS body preview for the second draft.",
    bodyHtml: "",
    selectedAlias: null,
    cc: [],
    bcc: [],
    attachments: [],
    aiDirective: "",
    replyContext: {
      contactId: "contact-2",
      contactDisplayName: "Alex Stone",
      contactPrimaryPhone: "+14065550123",
      defaultChannel: "sms",
      subject: "Re: Trail question",
      threadCursor: "event-2",
      threadId: "thread-2",
      inReplyToRfc822: "message-2",
      defaultAlias: "forests@adventurescientists.org",
      cc: [],
    },
    forwardContext: null,
    updatedAt: "2026-06-19T11:00:00.000Z",
  },
  {
    id: "draft-note",
    paneMode: "replying",
    channel: "note",
    recipientContactId: "contact-3",
    recipientEmail: null,
    recipientPhone: null,
    recipientDisplayName: "Robin North",
    subject: "",
    bodyPlaintext: "Note body preview for the third draft.",
    bodyHtml: "",
    selectedAlias: null,
    cc: [],
    bcc: [],
    attachments: [],
    aiDirective: "",
    replyContext: {
      contactId: "contact-3",
      contactDisplayName: "Robin North",
      contactPrimaryPhone: null,
      defaultChannel: "email",
      subject: "",
      threadCursor: null,
      threadId: null,
      inReplyToRfc822: null,
      defaultAlias: null,
      cc: [],
    },
    forwardContext: null,
    updatedAt: "2026-06-19T12:00:00.000Z",
  },
];

interface Session {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly cleanup: () => Promise<void>;
}

let activeSession: Session | null = null;

async function mount(inputDrafts: readonly InboxDraftListItemViewModel[]): Promise<Session> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <InboxClientProvider
        composerAliases={[]}
        initialDrafts={inputDrafts}
        currentActorId="user-1"
      >
        <DraftProbe />
        <InboxDraftsList />
      </InboxClientProvider>,
    );
    await Promise.resolve();
  });

  const session = {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      dom.window.close();
    },
  };
  activeSession = session;
  return session;
}

afterEach(async () => {
  deleteComposerDraftActionMock.mockClear();
  await activeSession?.cleanup();
  activeSession = null;
});

describe("inbox drafts list", () => {
  it("renders the empty state when there are no drafts", async () => {
    const session = await mount([]);

    expect(session.container.textContent).toContain("No drafts");
    expect(session.container.textContent).toContain(
      "New drafts will appear here automatically as you type.",
    );
  });

  it("renders email, sms, and note draft rows", async () => {
    const session = await mount(drafts);

    expect(session.container.textContent).toContain("Maya Lee");
    expect(session.container.textContent).toContain("forests@adventurescientists.org");
    expect(session.container.textContent).toContain("Trip logistics");
    expect(session.container.textContent).toContain(
      "Email body preview for the first draft.",
    );
    expect(session.container.textContent).toContain("SMS");
    expect(session.container.textContent).toContain("Alex Stone");
    expect(session.container.textContent).toContain("Note");
    expect(session.container.textContent).toContain("Robin North");
  });

  it("opens the matching draft and switches the pane to the recorded mode", async () => {
    const session = await mount(drafts);
    const row = session.container.querySelector<HTMLElement>(
      "[data-testid='draft-row:draft-note'] button",
    );

    if (row === null) {
      throw new Error("draft row button not found");
    }

    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(
      session.container.querySelector("[data-testid='draft-probe']")?.textContent,
    ).toBe("replying:draft-note");
  });

  it("discards a draft row after calling deleteComposerDraftAction", async () => {
    const session = await mount(drafts);
    const discardButton = session.container.querySelector<HTMLButtonElement>(
      "[data-testid='draft-row:draft-note'] [aria-label='Discard draft (no subject)']",
    );

    if (discardButton === null) {
      throw new Error("discard button not found");
    }

    await act(async () => {
      discardButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteComposerDraftActionMock).toHaveBeenCalledWith({ id: "draft-note" });
    expect(session.container.textContent).not.toContain("Robin North");
  });
});
