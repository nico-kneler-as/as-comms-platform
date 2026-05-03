import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPOSER_DRAFT_STATE,
  reduceComposerDraft,
} from "../../app/inbox/_hooks/composer-draft-reducer";
import type { ComposerPaneState } from "../../app/inbox/_lib/composer-ui";

const aliases = [
  {
    id: "alias-1",
    alias: "forest@adventuresci.org",
    projectId: "project-1",
    projectName: "Forest",
    isAiReady: true,
    isAiConfigured: true,
    hasCachedContent: true,
  },
] as const;

describe("composer draft reducer", () => {
  it("resets reply mode from reply context", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "RESET_TO_PANE_MODE",
      composerPane: {
        mode: "replying",
        initialTab: "note",
        replyContext: {
          contactId: "contact-1",
          contactDisplayName: "Ada Lovelace",
          subject: "Re: Forest dates",
          defaultAlias: "forest@adventuresci.org",
          threadId: "thread-1",
          threadCursor: "cursor-1",
          inReplyToRfc822: "<message@example.org>",
          cc: ["forest@adventuresci.org", "partner@example.org"],
        },
      },
      replyContext: {
        contactId: "contact-1",
        contactDisplayName: "Ada Lovelace",
        subject: "Re: Forest dates",
        defaultAlias: "forest@adventuresci.org",
        threadId: "thread-1",
        threadCursor: "cursor-1",
        inReplyToRfc822: "<message@example.org>",
        cc: ["forest@adventuresci.org", "partner@example.org"],
      },
    });

    expect(state).toMatchObject({
      activeTab: "note",
      subject: "Re: Forest dates",
      selectedAlias: "forest@adventuresci.org",
      showCc: true,
      cc: [{ kind: "email", emailAddress: "partner@example.org" }],
      body: "",
      attachments: [],
    });
    expect(state.recipient).toMatchObject({
      kind: "contact",
      contactId: "contact-1",
    });
  });

  it("recomputes the alias when a net-new recipient changes", () => {
    const state = reduceComposerDraft(
      {
        ...INITIAL_COMPOSER_DRAFT_STATE,
        selectedAlias: "old@adventuresci.org",
      },
      {
        type: "SET_RECIPIENT",
        isReplying: false,
        aliases,
        recipient: {
          kind: "contact",
          contactId: "contact-1",
          displayName: "Ada Lovelace",
          primaryEmail: "ada@example.org",
          primaryProjectName: "Forest",
          salesforceContactId: "sf-1",
        },
      },
    );

    expect(state.selectedAlias).toBe("forest@adventuresci.org");
  });

  it("hydrates stored drafts with attachments marked for reupload", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "HYDRATE_FROM_STORED_DRAFT",
      draft: {
        subject: "Hello",
        bodyPlaintext: "Body",
        bodyHtml: "<p>Body</p>",
        selectedAlias: "forest@adventuresci.org",
        cc: ["cc@example.org"],
        bcc: ["bcc@example.org"],
        attachments: [
          {
            filename: "map.pdf",
            size: 1024,
            contentType: "application/pdf",
          },
        ],
        updatedAt: 1,
      },
    });

    expect(state).toMatchObject({
      subject: "Hello",
      body: "Body",
      showCc: true,
      showBcc: true,
      selectedAlias: "forest@adventuresci.org",
    });
    expect(state.attachments).toEqual([
      {
        id: "draft:map.pdf:1024:0",
        filename: "map.pdf",
        size: 1024,
        contentType: "application/pdf",
        contentBase64: null,
      },
    ]);
  });

  it("applies AI approval and clears tab-scoped errors on tab switch", () => {
    const approved = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "APPLY_AI_APPROVAL",
      approvedText: "Generated reply",
    });

    expect(approved.body).toBe("Generated reply");
    expect(approved.bodyHtml).toBe("<p>Generated reply</p>");

    const switched = reduceComposerDraft(
      {
        ...approved,
        inlineError: { message: "Wrong tab", retryable: false },
        fieldErrors: [{ field: "body", message: "Wrong tab" }],
      },
      { type: "SET_ACTIVE_TAB", tab: "note" },
    );

    expect(switched.activeTab).toBe("note");
    expect(switched.inlineError).toBeNull();
    expect(switched.fieldErrors).toEqual([]);
  });

  it("returns initial state when the pane closes", () => {
    const closedPane: ComposerPaneState = { mode: "closed" };

    expect(
      reduceComposerDraft(
        {
          ...INITIAL_COMPOSER_DRAFT_STATE,
          body: "Unsaved",
        },
        {
          type: "RESET_TO_PANE_MODE",
          composerPane: closedPane,
          replyContext: null,
        },
      ),
    ).toEqual(INITIAL_COMPOSER_DRAFT_STATE);
  });
});
