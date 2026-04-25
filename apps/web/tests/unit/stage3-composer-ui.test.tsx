import { describe, expect, it } from "vitest";

import type { InboxComposerReplyContext } from "../../app/inbox/_lib/view-models";
import { plaintextToComposerHtml } from "../../app/inbox/_components/composer-html";
import {
  formatContactRecipientLabel,
  reduceComposerPane,
  resolveTypedEmailRecipient,
  isComposerSendDisabled,
  resolveDefaultAlias,
  type ComposerPaneState
} from "../../app/inbox/_lib/composer-ui";

const replyContext: InboxComposerReplyContext = {
  contactId: "contact-1",
  contactDisplayName: "Alice Smith",
  subject: "Re: Trip logistics",
  threadCursor: "event-1",
  threadId: "thread-1",
  inReplyToRfc822: "message-1",
  defaultAlias: "field@adventuresci.org"
};

describe("stage3 composer ui helpers", () => {
  it("opens a new draft pane and closes it again through the shared reducer", () => {
    const opened = reduceComposerPane(
      { mode: "closed" },
      {
        type: "open-new-draft"
      }
    );
    const closed = reduceComposerPane(opened, {
      type: "close"
    });

    expect(opened).toEqual({
      mode: "new-draft"
    } satisfies ComposerPaneState);
    expect(closed).toEqual({
      mode: "closed"
    } satisfies ComposerPaneState);
  });

  it("stores reply context when opening a reply draft", () => {
    const replying = reduceComposerPane(
      { mode: "closed" },
      {
        type: "open-reply",
        replyContext
      }
    );

    expect(replying).toEqual({
      mode: "replying",
      replyContext
    } satisfies ComposerPaneState);
  });

  it("accepts an unmatched valid email as an external recipient", () => {
    expect(
      resolveTypedEmailRecipient({
        query: "outside@example.com",
        results: []
      })
    ).toEqual({
      kind: "email",
      emailAddress: "outside@example.com"
    });

    expect(
      resolveTypedEmailRecipient({
        query: "alice@example.com",
        results: [
          {
            primaryEmail: "alice@example.com"
          }
        ]
      })
    ).toBeNull();
  });

  it("formats contact recipients with their email when available", () => {
    expect(
      formatContactRecipientLabel({
        displayName: "Alice Smith",
        primaryEmail: "alice@example.com"
      })
    ).toBe("Alice Smith (alice@example.com)");

    expect(
      formatContactRecipientLabel({
        displayName: "Alice Smith",
        primaryEmail: null
      })
    ).toBe("Alice Smith");
  });

  it("defaults aliases from the contact project and disables send for missing input", () => {
    expect(
      resolveDefaultAlias({
        recipient: {
          kind: "contact",
          primaryProjectName: "Coastal Survey"
        },
        aliases: [
          {
            id: "alias-1",
            alias: "coastal@adventuresci.org",
            projectId: "project-1",
            projectName: "Coastal Survey",
            isAiReady: true
          }
        ]
      })
    ).toBe("coastal@adventuresci.org");

    expect(
      isComposerSendDisabled({
        activeTab: "email",
        recipient: null,
        selectedAlias: "coastal@adventuresci.org",
        subject: "Hello",
        body: "Body",
        isSending: false
      })
    ).toBe(true);

    expect(
      isComposerSendDisabled({
        activeTab: "email",
        recipient: {
          kind: "email"
        },
        selectedAlias: "coastal@adventuresci.org",
        subject: "Hello",
        body: "",
        isSending: false
      })
    ).toBe(true);
  });

  it("converts AI draft plaintext into safe composer HTML paragraphs and line breaks", () => {
    expect(
      plaintextToComposerHtml(
        `Hi Lily,\n\nThanks for reaching out.\nSecond line\n\n<script>alert("xss")</script>\n`,
      ),
    ).toBe(
      "<p>Hi Lily,</p><p>Thanks for reaching out.<br>Second line</p><p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>",
    );
  });
});
