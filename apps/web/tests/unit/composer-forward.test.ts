import { describe, expect, it } from "vitest";

import { buildForwardContextFromEntry } from "../../app/inbox/_lib/composer-forward";
import type {
  InboxComposerAliasOption,
  InboxTimelineEntryViewModel,
} from "../../app/inbox/_lib/view-models";

const composerAliases: readonly InboxComposerAliasOption[] = [
  {
    id: "alias-forests",
    alias: "forests@adventurescientists.org",
    projectId: "project-forests",
    projectName: "Forests",
    signature: "Thanks,\nForests",
    isAiReady: true,
    isAiConfigured: true,
    hasCachedContent: true,
  },
  {
    id: "alias-volunteers",
    alias: "volunteers@adventurescientists.org",
    projectId: "project-volunteers",
    projectName: "Volunteers",
    signature: "Thanks,\nVolunteers",
    isAiReady: true,
    isAiConfigured: true,
    hasCachedContent: true,
  },
];

function buildEntry(
  overrides: Partial<InboxTimelineEntryViewModel> = {},
): InboxTimelineEntryViewModel {
  return {
    id: "entry-1",
    kind: "inbound-email",
    occurredAt: "2026-05-12T12:00:00.000Z",
    occurredAtLabel: "1m ago",
    actorLabel: "Original Sender",
    subject: "Forward me",
    body: "Body",
    channel: "email",
    isUnread: false,
    isPreview: true,
    fromHeader: "Original Sender <sender@example.org>",
    toHeader: "forests@adventurescientists.org",
    recipientLabel: null,
    ccHeader: null,
    mailbox: "forests@adventurescientists.org",
    threadId: "thread-1",
    rfc822MessageId: "<message-1@example.org>",
    inReplyToRfc822: null,
    sendStatus: null,
    failedReason: null,
    failedDetail: null,
    attachmentCount: 0,
    attachments: [],
    campaignActivity: [],
    ...overrides,
  };
}

describe("buildForwardContextFromEntry", () => {
  it("defaults the alias from the original recipient header before the host-aware fallback", () => {
    const context = buildForwardContextFromEntry({
      entry: buildEntry({
        toHeader: "forests@adventurescientists.org",
      }),
      composerAliases,
      defaultAlias: "volunteers@adventurescientists.org",
    });

    expect(context?.defaultAlias).toBe("forests@adventurescientists.org");
  });
});
