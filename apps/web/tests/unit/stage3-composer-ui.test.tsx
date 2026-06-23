import { describe, expect, it } from "vitest";

import type { InboxComposerReplyContext } from "../../app/inbox/_lib/view-models";
import { resolveFloatingComposerLabel } from "../../app/inbox/_components/composer-floating-pill";
import { plaintextToComposerHtml } from "../../app/inbox/_components/composer-html";
import {
  formatContactRecipientLabel,
  reduceComposerPane,
  resolveDefaultSmsSenderId,
  resolveReplyInitialTab,
  resolveTypedEmailRecipient,
  isComposerSendDisabled,
  resolveComposerSendActionFlags,
  resolveDefaultAlias,
  resolveProjectAliasOverride,
  resolveSendAndSaveForAiAvailability,
  type ComposerPaneState,
} from "../../app/inbox/_lib/composer-ui";

const replyContext: InboxComposerReplyContext = {
  contactId: "contact-1",
  contactDisplayName: "Alice Smith",
  contactPrimaryPhone: "+14065550123",
  defaultChannel: "email",
  subject: "Re: Trip logistics",
  threadCursor: "event-1",
  threadId: "thread-1",
  inReplyToRfc822: "message-1",
  defaultAlias: "field@adventuresci.org",
};

describe("stage3 composer ui helpers", () => {
  it("opens a new draft pane and closes it again through the shared reducer", () => {
    const opened = reduceComposerPane(
      { mode: "closed" },
      {
        type: "open-new-draft",
      },
    );
    const closed = reduceComposerPane(opened, {
      type: "close",
    });

    expect(opened).toEqual({
      mode: "new-draft",
      initialTab: "email",
    } satisfies ComposerPaneState);
    expect(closed).toEqual({
      mode: "closed",
    } satisfies ComposerPaneState);
  });

  it("stores reply context when opening a reply draft", () => {
    const replying = reduceComposerPane(
      { mode: "closed" },
      {
        type: "open-reply",
        replyContext,
      },
    );

    expect(replying).toEqual({
      mode: "replying",
      replyContext,
      initialTab: "email",
    } satisfies ComposerPaneState);
  });

  it("defaults reply drafts to sms when the latest inbound channel is sms", () => {
    expect(
      resolveReplyInitialTab({
        replyContext: {
          ...replyContext,
          defaultChannel: "sms",
        },
      }),
    ).toBe("sms");

    expect(
      reduceComposerPane(
        { mode: "closed" },
        {
          type: "open-reply",
          replyContext: {
            ...replyContext,
            defaultChannel: "sms",
          },
        },
      ),
    ).toEqual({
      mode: "replying",
      replyContext: {
        ...replyContext,
        defaultChannel: "sms",
      },
      initialTab: "sms",
    } satisfies ComposerPaneState);
  });

  it("stores forward context when opening a forward draft", () => {
    const forwardContext = {
      originalEntryId: "entry-1",
      originalSubject: "Trip logistics",
      originalFromLabel: "Alice Smith <alice@example.com>",
      originalToLabel: "field@adventuresci.org",
      originalCcLabel: null,
      originalOccurredAtIso: "2026-05-09T20:42:00.000Z",
      originalBodyPlaintext: "Forward this along.",
      originalBodyHtml: null,
      defaultAlias: "field@adventuresci.org",
    } as const;

    const forwarding = reduceComposerPane(
      { mode: "closed" },
      {
        type: "open-forward",
        forwardContext,
      },
    );

    expect(forwarding).toEqual({
      mode: "forwarding",
      forwardContext,
      initialTab: "email",
    } satisfies ComposerPaneState);
  });

  it("derives minimized composer labels from the active composer pane", () => {
    expect(
      resolveFloatingComposerLabel({
        mode: "new-draft",
        initialTab: "email",
      }),
    ).toBe("New message");

    expect(
      resolveFloatingComposerLabel({
        mode: "replying",
        replyContext,
        initialTab: "email",
      }),
    ).toBe("Re: Trip logistics");

    expect(
      resolveFloatingComposerLabel({
        mode: "replying",
        replyContext,
        initialTab: "note",
      }),
    ).toBe("Note about Alice Smith");

    expect(
      resolveFloatingComposerLabel({
        mode: "forwarding",
        forwardContext: {
          originalEntryId: "entry-1",
          originalSubject: "Trip logistics",
          originalFromLabel: "Alice Smith <alice@example.com>",
          originalToLabel: "field@adventuresci.org",
          originalCcLabel: null,
          originalOccurredAtIso: "2026-05-09T20:42:00.000Z",
          originalBodyPlaintext: "Forward this along.",
          originalBodyHtml: null,
          defaultAlias: "field@adventuresci.org",
        },
        initialTab: "email",
      }),
    ).toBe("Fwd: Trip logistics");
  });

  it("accepts an unmatched valid email as an external recipient", () => {
    expect(
      resolveTypedEmailRecipient({
        query: "outside@example.com",
        results: [],
      }),
    ).toEqual({
      kind: "email",
      emailAddress: "outside@example.com",
    });

    expect(
      resolveTypedEmailRecipient({
        query: "alice@example.com",
        results: [
          {
            primaryEmail: "alice@example.com",
          },
        ],
      }),
    ).toBeNull();
  });

  it("formats contact recipients with their email when available", () => {
    expect(
      formatContactRecipientLabel({
        displayName: "Alice Smith",
        primaryEmail: "alice@example.com",
      }),
    ).toBe("Alice Smith (alice@example.com)");

    expect(
      formatContactRecipientLabel({
        displayName: "Alice Smith",
        primaryEmail: null,
      }),
    ).toBe("Alice Smith");
  });

  it("defaults aliases from the contact project and disables send for missing input", () => {
    expect(
      resolveDefaultAlias({
        recipient: {
          kind: "contact",
          primaryProjectName: "Coastal Survey",
        },
        aliases: [
          {
            id: "alias-1",
            alias: "coastal@adventuresci.org",
            projectId: "project-1",
            projectName: "Coastal Survey",
            signature: "Best,\nCoastal Survey",
            isAiReady: true,
            hasCachedContent: true,
          },
        ],
      }),
    ).toBe("coastal@adventuresci.org");

    expect(
      isComposerSendDisabled({
        activeTab: "email",
        recipient: null,
        selectedAlias: "coastal@adventuresci.org",
        subject: "Hello",
        body: "Body",
        isSending: false,
      }),
    ).toBe(true);

    expect(
      isComposerSendDisabled({
        activeTab: "email",
        recipient: {
          kind: "email",
        },
        selectedAlias: "coastal@adventuresci.org",
        subject: "Hello",
        body: "",
        isSending: false,
      }),
    ).toBe(true);

    expect(
      resolveComposerSendActionFlags({
        sendKind: "send",
      }),
    ).toEqual({
      saveAsKnowledge: false,
    });

    expect(
      resolveComposerSendActionFlags({
        sendKind: "send-and-save",
      }),
    ).toEqual({
      saveAsKnowledge: true,
    });
  });

  it("gates send-and-save availability by the selected alias project", () => {
    expect(
      resolveSendAndSaveForAiAvailability({
        selectedAlias: "coastal@adventuresci.org",
        aliases: [
          {
            id: "alias-1",
            alias: "coastal@adventuresci.org",
            projectId: "project-1",
            projectName: "Coastal Survey",
            signature: "Best,\nCoastal Survey",
            isAiReady: false,
            isAiConfigured: false,
          },
        ],
      }),
    ).toEqual({
      enabled: false,
      disabledReason: "AI is not configured for this project.",
    });

    expect(
      resolveSendAndSaveForAiAvailability({
        selectedAlias: "coastal@adventuresci.org",
        aliases: [
          {
            id: "alias-1",
            alias: "coastal@adventuresci.org",
            projectId: "project-1",
            projectName: "Coastal Survey",
            signature: "Best,\nCoastal Survey",
            isAiReady: false,
            isAiConfigured: false,
          },
          {
            id: "alias-2",
            alias: "backup@adventuresci.org",
            projectId: "project-1",
            projectName: "Coastal Survey",
            signature: "",
            isAiReady: true,
            isAiConfigured: true,
          },
        ],
      }),
    ).toEqual({
      enabled: true,
      disabledReason: null,
    });
  });

  it("resolves the default sms sender id when an active sender exists", () => {
    expect(
      resolveDefaultSmsSenderId({
        smsSenders: [
          {
            id: "sender-1",
            phoneE164: "+14062891988",
            displayName: "Adventure Scientists",
          },
        ],
      }),
    ).toBe("sender-1");

    expect(
      resolveDefaultSmsSenderId({
        smsSenders: [],
      }),
    ).toBeNull();
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

  it("resolves the project alias across direct and host project ids", () => {
    expect(
      resolveProjectAliasOverride({
        projectIds: ["project:beech", "host:forests", null],
        aliases: [
          {
            id: "alias-1",
            alias: "forests@adventuresci.org",
            projectId: "host:forests",
            projectName: "Beech & Butternut",
            signature: "Best,\nForests",
            isAiReady: true,
            hasCachedContent: true,
          },
        ],
      }),
    ).toBe("forests@adventuresci.org");
  });
});
