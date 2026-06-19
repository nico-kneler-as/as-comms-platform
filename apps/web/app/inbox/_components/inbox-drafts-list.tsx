"use client";

import { useTransition } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { deleteComposerDraftAction } from "@/src/server/composer/drafts";
import { cn } from "@/lib/utils";

import { useInboxClient } from "./inbox-client-provider";
import {
  FileEditIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  TrashIcon,
} from "./icons";

function formatRelativeTime(timestamp: string): string {
  const target = new Date(timestamp).getTime();
  const now = Date.now();
  const deltaMs = Math.max(0, now - target);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < hour) {
    const minutes = Math.max(1, Math.floor(deltaMs / minute));
    return `${minutes.toString()}m ago`;
  }

  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return `${hours.toString()}h ago`;
  }

  const days = Math.floor(deltaMs / day);

  if (days === 1) {
    return "yesterday";
  }

  if (days < 7) {
    return `${days.toString()}d ago`;
  }

  if (days < 30) {
    return `${Math.floor(days / 7).toString()}w ago`;
  }

  if (days < 365) {
    return `${Math.floor(days / 30).toString()}mo ago`;
  }

  return `${Math.floor(days / 365).toString()}y ago`;
}

function buildPreview(bodyPlaintext: string): string {
  const normalized = bodyPlaintext.replace(/\s+/gu, " ").trim();
  return normalized.slice(0, 100);
}

function resolveRecipientLabel(input: {
  readonly recipientDisplayName: string | null;
  readonly recipientEmail: string | null;
  readonly recipientPhone: string | null;
}): string {
  return (
    input.recipientDisplayName ??
    input.recipientEmail ??
    input.recipientPhone ??
    "(no recipient)"
  );
}

export function InboxDraftsList() {
  const { drafts, openExistingDraft, removeDraft } = useInboxClient();

  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={<FileEditIcon className="size-6" />}
        title="No drafts"
        description="New drafts will appear here automatically as you type."
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100" data-testid="drafts-list">
      {drafts.map((draft) => (
        <InboxDraftRow
          key={draft.id}
          draft={draft}
          onOpen={() => {
            openExistingDraft(draft);
          }}
          onDiscardOptimistic={() => {
            removeDraft(draft.id);
          }}
        />
      ))}
    </ul>
  );
}

function InboxDraftRow({
  draft,
  onOpen,
  onDiscardOptimistic,
}: {
  readonly draft: ReturnType<typeof useInboxClient>["drafts"][number];
  readonly onOpen: () => void;
  readonly onDiscardOptimistic: () => void;
}) {
  const [isDiscarding, startDiscardTransition] = useTransition();
  const ChannelIcon =
    draft.channel === "email"
      ? MailIcon
      : draft.channel === "sms"
        ? PhoneIcon
        : NoteIcon;
  const channelLabel =
    draft.channel === "email"
      ? "Email"
      : draft.channel === "sms"
        ? "SMS"
        : "Note";
  const recipientLabel = resolveRecipientLabel({
    recipientDisplayName: draft.recipientDisplayName,
    recipientEmail: draft.recipientEmail,
    recipientPhone: draft.recipientPhone,
  });
  const subject = draft.subject.trim().length > 0 ? draft.subject : "(no subject)";
  const preview = buildPreview(draft.bodyPlaintext);

  return (
    <li
      className="group relative flex items-start gap-2 px-4 py-3 hover:bg-slate-50"
      data-testid={`draft-row:${draft.id}`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onOpen}
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13.5px] font-semibold text-slate-900">
            {recipientLabel}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            <ChannelIcon className="size-3" />
            {channelLabel}
          </span>
          {draft.selectedAlias ? (
            <span className="inline-flex shrink-0 items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
              {draft.selectedAlias}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px]">
          <p className="truncate font-medium text-slate-700">{subject}</p>
          {preview.length > 0 ? (
            <>
              <span className="text-slate-300">·</span>
              <p className="truncate text-slate-500">{preview}</p>
            </>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Last edited {formatRelativeTime(draft.updatedAt)}
        </p>
      </button>

      <button
        type="button"
        aria-label={`Discard draft ${subject}`}
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-700",
          "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          isDiscarding ? "pointer-events-none opacity-100" : "",
        )}
        onClick={() => {
          startDiscardTransition(() => {
            onDiscardOptimistic();
            void deleteComposerDraftAction({ id: draft.id });
          });
        }}
      >
        <TrashIcon className="size-3.5" />
      </button>
    </li>
  );
}
