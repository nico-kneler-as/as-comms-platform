import type { ContactRecord, TimelineItem } from "@as-comms/contracts";
import { filterItemsAtOrAfterPlatformFullCaptureCutover } from "@/app/_lib/cutover";
import { listComposerDraftsAction } from "@/src/server/composer/drafts";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import type {
  InboxComposerReplyContext,
  InboxDraftListItemViewModel,
} from "@/app/inbox/_lib/view-models";

const PLACEHOLDER_BODY_PREVIEWS = new Set([
  "[Encrypted message — open in Gmail to read]",
  "[Message body could not be extracted — open in Gmail]",
]);

const REPLY_SUBJECT_PREFIX_PATTERN = /^\s*(?:(?:re|fwd?)\s*:\s*)+/i;

function normalizeInlineText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.replace(/\s+/gu, " ").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildReplySubject(subject: string | null): string {
  const normalizedSubject = normalizeInlineText(subject);

  if (normalizedSubject === null) {
    return "";
  }

  const trimmedSubject = normalizeInlineText(
    normalizedSubject.replace(REPLY_SUBJECT_PREFIX_PATTERN, ""),
  );

  return trimmedSubject === null ? "" : `Re: ${trimmedSubject}`;
}

function extractEmailAddresses(headerValue: string | null): readonly string[] {
  if (headerValue === null) {
    return [];
  }

  return Array.from(
    new Set(
      [...headerValue.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)]
        .map((match) => match[0].trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  );
}

function buildReplyContext(input: {
  readonly contact: ContactRecord;
  readonly timelineItems: readonly TimelineItem[];
  readonly defaultAlias: string | null;
  readonly preferredThreadCursor: string | null;
}): InboxComposerReplyContext {
  const visibleTimelineItems = filterItemsAtOrAfterPlatformFullCaptureCutover(
    input.timelineItems,
  );
  const inboundEmails = [...visibleTimelineItems]
    .reverse()
    .filter(
      (item): item is Extract<TimelineItem, { family: "one_to_one_email" }> =>
        item.family === "one_to_one_email" && item.direction === "inbound",
    );
  const latestInboundEmail = inboundEmails[0];
  const preferredInboundEmail =
    input.preferredThreadCursor === null
      ? null
      : (inboundEmails.find(
          (item) => item.canonicalEventId === input.preferredThreadCursor,
        ) ?? null);
  const latestQuotableInboundEmail = inboundEmails.find(
    (item) => !PLACEHOLDER_BODY_PREVIEWS.has((item.bodyPreview ?? "").trim()),
  );
  const replyAnchor = preferredInboundEmail ?? latestQuotableInboundEmail ?? null;

  if (latestInboundEmail === undefined) {
    return {
      contactId: input.contact.id,
      contactDisplayName: input.contact.displayName,
      contactPrimaryPhone: input.contact.primaryPhone,
      subject: "",
      threadCursor: null,
      threadId: null,
      inReplyToRfc822: null,
      defaultAlias: input.defaultAlias,
      cc: [],
    };
  }

  return {
    contactId: input.contact.id,
    contactDisplayName: input.contact.displayName,
    contactPrimaryPhone: input.contact.primaryPhone,
    subject: buildReplySubject((replyAnchor ?? latestInboundEmail).subject),
    threadCursor: replyAnchor?.canonicalEventId ?? null,
    threadId: (replyAnchor ?? latestInboundEmail).threadId ?? null,
    inReplyToRfc822: (replyAnchor ?? latestInboundEmail).rfc822MessageId ?? null,
    defaultAlias: input.defaultAlias,
    cc: extractEmailAddresses((replyAnchor ?? latestInboundEmail).ccHeader),
  };
}

function resolveRecipientDisplayName(input: {
  readonly contact: ContactRecord | null;
  readonly recipientEmail: string | null;
  readonly recipientPhone: string | null;
}): string | null {
  return (
    input.contact?.displayName ??
    input.recipientEmail ??
    input.recipientPhone ??
    null
  );
}

export async function getInboxDraftList(input: {
  readonly limit: number;
}): Promise<readonly InboxDraftListItemViewModel[]> {
  const result = await listComposerDraftsAction({ limit: input.limit });

  if (!result.ok) {
    console.error("[inbox/drafts] failed to list composer drafts", result);
    return [];
  }

  const runtime = await getStage1WebRuntime();
  const recipientContactIds = Array.from(
    new Set(
      result.data.drafts
        .map((draft) => draft.recipientContactId)
        .filter((contactId): contactId is string => contactId !== null),
    ),
  );
  const contacts = await Promise.all(
    recipientContactIds.map(async (contactId) => [
      contactId,
      await runtime.repositories.contacts.findById(contactId),
    ] as const),
  );
  const contactById = new Map(contacts);
  const timelineItemsByContactId = new Map(
    await Promise.all(
      recipientContactIds.map(async (contactId) => [
        contactId,
        await runtime.timelinePresentation.listTimelineItemsByContactId(contactId),
      ] as const),
    ),
  );

  return result.data.drafts
    .map((draft) => {
      const contact =
        draft.recipientContactId === null
          ? null
          : (contactById.get(draft.recipientContactId) ?? null);

      return {
        id: draft.id,
        paneMode: draft.paneMode === "new-draft" ? "new_draft" : draft.paneMode,
        channel: draft.channel,
        recipientContactId: draft.recipientContactId,
        recipientEmail: draft.recipientEmail,
        recipientPhone: draft.recipientPhone,
        recipientDisplayName: resolveRecipientDisplayName({
          contact,
          recipientEmail: draft.recipientEmail,
          recipientPhone: draft.recipientPhone,
        }),
        subject: draft.subject,
        bodyPlaintext: draft.bodyPlaintext,
        bodyHtml: draft.bodyHtml,
        selectedAlias: draft.selectedAlias,
        cc: draft.cc,
        bcc: draft.bcc,
        attachments: draft.attachments,
        aiDirective: draft.aiDirective,
        replyContext:
          draft.paneMode === "replying" && draft.recipientContactId !== null
            ? (() => {
                const contact = contactById.get(draft.recipientContactId) ?? null;
                const timelineItems =
                  timelineItemsByContactId.get(draft.recipientContactId) ?? [];

                if (contact === null) {
                  return null;
                }

                return buildReplyContext({
                  contact,
                  timelineItems,
                  defaultAlias: draft.selectedAlias,
                  preferredThreadCursor: draft.replyContextThreadCursor,
                });
              })()
            : null,
        forwardContext: draft.forwardContext,
        updatedAt: draft.updatedAt,
      } satisfies InboxDraftListItemViewModel;
    })
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    );
}
