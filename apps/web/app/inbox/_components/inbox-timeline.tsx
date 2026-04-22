"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import { deleteNoteAction, updateNoteAction } from "../actions";
import { getInternalNoteValidationError } from "@/src/lib/internal-note-validation";
import {
  ChevronRightIcon,
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  RefreshCwIcon,
} from "./icons";
import { DividerLabel } from "@/components/ui/divider-label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  RADIUS,
  SHADOW,
  TEXT,
  TONE,
  TRANSITION,
} from "@/app/_lib/design-tokens";

interface TimelineProps {
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly volunteerFirstName: string;
  readonly currentOperatorUserId: string;
  readonly hasMore?: boolean;
  readonly isLoadingOlder?: boolean;
  readonly onLoadOlder?: () => void;
  readonly retryingEntryId?: string | null;
  readonly onRetryPending?: (entryId: string) => void;
}

export function InboxTimeline({
  entries,
  volunteerFirstName,
  currentOperatorUserId,
  hasMore = false,
  isLoadingOlder = false,
  onLoadOlder,
  retryingEntryId = null,
  onRetryPending,
}: TimelineProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[6rem] items-center justify-center py-10 text-center text-sm text-slate-400">
        No timeline entries yet.
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {hasMore && onLoadOlder ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isLoadingOlder}
            onClick={onLoadOlder}
            className={cn(
              "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600",
              "transition-[color,background-color,transform] duration-150 ease-out",
              "active:scale-[0.96] disabled:active:scale-100",
              TRANSITION.reduceMotion,
              "hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {isLoadingOlder
              ? "Loading older activity..."
              : "Load older activity"}
          </button>
        </div>
      ) : null}

      <ol className="flex flex-col gap-4">
        {entries.map((entry) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            volunteerFirstName={volunteerFirstName}
            currentOperatorUserId={currentOperatorUserId}
            isExpanded={expanded.has(entry.id)}
            retryingEntryId={retryingEntryId}
            onRetryPending={onRetryPending}
            onToggle={() => {
              toggle(entry.id);
            }}
          />
        ))}
      </ol>
    </div>
  );
}

interface EntryProps {
  readonly entry: InboxTimelineEntryViewModel;
  readonly volunteerFirstName: string;
  readonly currentOperatorUserId: string;
  readonly isExpanded: boolean;
  readonly retryingEntryId: string | null;
  readonly onRetryPending: ((entryId: string) => void) | undefined;
  readonly onToggle: () => void;
}

function TimelineEntry({
  entry,
  volunteerFirstName,
  currentOperatorUserId,
  isExpanded,
  retryingEntryId,
  onRetryPending,
  onToggle,
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
      return <InboundBubble entry={entry} />;
    case "outbound":
      return (
        <OutboundBubble
          entry={entry}
          isRetrying={retryingEntryId === entry.id}
          onRetryPending={onRetryPending}
        />
      );
    case "automated":
    case "campaign":
    case "activity":
      return (
        <AutomatedRow
          entry={entry}
          role={role}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "note":
      return (
        <NoteEntry
          entry={entry}
          currentOperatorUserId={currentOperatorUserId}
        />
      );
    case "system":
      return (
        <SystemDivider entry={entry} volunteerFirstName={volunteerFirstName} />
      );
  }
}

function InboundBubble({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const body = bodyTextForEntry(entry);

  return (
    <li className="flex w-full flex-col items-start">
      <div
        className={`w-full max-w-2xl ${RADIUS.bubble} rounded-bl-sm border border-slate-200 bg-white px-4 py-3 ${SHADOW.sm}`}
      >
        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-900">
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p className={`whitespace-pre-wrap text-pretty ${TEXT.bodySm}`}>
            {autolinkText(body, "text-sky-600")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <ChannelIcon className="h-3 w-3" />
        <span className="font-medium text-slate-500">{entry.actorLabel}</span>
        <span>·</span>
        <span>{entry.occurredAtLabel}</span>
        {entry.isUnread ? (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"
            aria-label="Unread"
          />
        ) : null}
      </div>
    </li>
  );
}

function OutboundBubble({
  entry,
  isRetrying,
  onRetryPending,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly isRetrying: boolean;
  readonly onRetryPending: ((entryId: string) => void) | undefined;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const body = bodyTextForEntry(entry);
  const canRetry =
    (entry.sendStatus === "failed" || entry.sendStatus === "orphaned") &&
    entry.attachmentCount === 0 &&
    onRetryPending !== undefined;
  const retryDisabledReason =
    entry.attachmentCount > 0
      ? "Re-attach files and send as a new message"
      : null;

  return (
    <li className="flex w-full flex-col items-end">
      <div
        className={`w-full max-w-2xl ${RADIUS.bubble} rounded-br-sm bg-slate-800 px-4 py-3 ${SHADOW.sm}`}
      >
        {entry.sendStatus === "pending" ? (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-slate-100">
            <LoaderIcon className="size-3 animate-spin" />
            Sending...
          </div>
        ) : null}

        {entry.sendStatus === "failed" || entry.sendStatus === "orphaned" ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            <span>
              {entry.sendStatus === "failed"
                ? "Send failed."
                : "Send stalled before confirmation."}
            </span>
            {retryDisabledReason ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-500"
                    >
                      <RefreshCwIcon className="size-3" />
                      Retry
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{retryDisabledReason}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <button
                type="button"
                disabled={!canRetry || isRetrying}
                onClick={() => {
                  if (canRetry) {
                    onRetryPending(entry.id);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isRetrying ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3" />
                )}
                Retry
              </button>
            )}
          </div>
        ) : null}

        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-100">
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-slate-200">
            {autolinkText(body, "text-sky-300")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <span>{entry.occurredAtLabel}</span>
        <span>·</span>
        <ChannelIcon className="h-3 w-3" />
      </div>
    </li>
  );
}

function AutomatedRow({
  entry,
  role,
  isExpanded,
  onToggle,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly role: "automated" | "campaign" | "activity";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const isEmail = entry.channel === "email";
  const label =
    role === "activity"
      ? isEmail
        ? "Email Activity"
        : "SMS Activity"
      : role === "automated"
        ? isEmail
          ? "Automated Email"
          : "Automated SMS"
        : isEmail
          ? "Campaign Email"
          : "Campaign SMS";
  const headline = entry.subject;
  const body = bodyTextForEntry(entry);
  const hideCollapsedBody = shouldHideAutomatedRowBody({
    isExpanded,
    kind: entry.kind,
    headline,
  });

  return (
    <li className="flex w-full flex-col items-end">
      <div className="mb-1 flex w-full max-w-2xl items-center justify-between px-1">
        <span className={TEXT.micro}>{label}</span>
      </div>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={cn(
          `group flex w-full max-w-2xl items-center gap-3 ${RADIUS.md} border border-dashed border-slate-300 bg-white px-4 py-2.5 text-left`,
          "transition-[color,background-color,transform] duration-150 ease-out",
          "active:scale-[0.96]",
          TRANSITION.reduceMotion,
          "hover:bg-slate-50",
        )}
      >
        <div className="min-w-0 flex-1">
          {headline ? (
            <p className="text-pretty text-[13px] font-medium leading-snug text-slate-700">
              {headline}
            </p>
          ) : null}
          {!hideCollapsedBody && body.length > 0 ? (
            <p
              className={cn(
                "text-[13px] leading-relaxed text-slate-600",
                headline && "mt-1.5",
                isExpanded ? "whitespace-pre-wrap text-pretty" : "line-clamp-1",
              )}
            >
              {isExpanded ? autolinkText(body, "text-sky-600") : body}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-slate-400">
            {entry.occurredAtLabel}
          </span>
          <ChevronRightIcon
            className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </button>
    </li>
  );
}

export function shouldHideAutomatedRowBody(input: {
  readonly isExpanded: boolean;
  readonly kind: InboxTimelineEntryKind;
  readonly headline: string | null;
}): boolean {
  return (
    !input.isExpanded &&
    input.kind === "outbound-auto-email" &&
    input.headline !== null
  );
}

function NoteEntry({
  entry,
  currentOperatorUserId,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly currentOperatorUserId: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(entry.body);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const canManageNote =
    entry.noteId !== null &&
    entry.noteId !== undefined &&
    entry.authorId === currentOperatorUserId;

  const saveEdit = () => {
    const noteId = entry.noteId;

    if (
      typeof noteId !== "string" ||
      entry.authorId !== currentOperatorUserId
    ) {
      return;
    }

    const validationError = getInternalNoteValidationError(draftBody);

    if (validationError !== null) {
      setInlineError(validationError);
      return;
    }

    setInlineError(null);
    startSaveTransition(async () => {
      const result = await updateNoteAction({
        noteId,
        body: draftBody,
      });

      if (!result.ok) {
        setInlineError(result.message);
        return;
      }

      setIsEditing(false);
      router.refresh();
    });
  };

  const deleteNote = () => {
    const noteId = entry.noteId;

    if (
      typeof noteId !== "string" ||
      entry.authorId !== currentOperatorUserId
    ) {
      return;
    }

    setInlineError(null);
    startDeleteTransition(async () => {
      const result = await deleteNoteAction({
        noteId,
      });

      if (!result.ok) {
        setInlineError(result.message);
        return;
      }

      setDeleteOpen(false);
      router.refresh();
    });
  };

  return (
    <li className="flex w-full flex-col items-end">
      <div
        className={`w-full max-w-2xl ${RADIUS.md} border-l-2 border-amber-400 ${TONE.amber.subtle} px-4 py-2.5`}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-amber-700">
          <div className="flex items-center gap-1.5">
            <NoteIcon className="h-3 w-3" />
            <span className="font-medium">Note</span>
            <span className="text-amber-300">·</span>
            <span>{entry.actorLabel}</span>
            <span className="text-amber-300">·</span>
            <span>{entry.occurredAtLabel}</span>
          </div>
          {canManageNote ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                onClick={() => {
                  setDraftBody(entry.body);
                  setInlineError(null);
                  setIsEditing(true);
                }}
              >
                Edit
              </Button>
              <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                  >
                    Delete
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 space-y-3" align="end">
                  <p className="text-sm font-medium text-slate-900">
                    Delete this note?
                  </p>
                  <p className="text-xs text-slate-500">
                    This removes the note from the shared timeline.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isDeleting}
                      onClick={deleteNote}
                    >
                      {isDeleting ? (
                        <>
                          <LoaderIcon className="size-3 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        "Delete"
                      )}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
        </div>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              rows={4}
              value={draftBody}
              onChange={(event) => {
                setDraftBody(event.currentTarget.value);
                if (inlineError !== null) {
                  setInlineError(null);
                }
              }}
              className="w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
            {inlineError ? (
              <p className="text-xs text-rose-700">{inlineError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftBody(entry.body);
                  setInlineError(null);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={saveEdit}
              >
                {isSaving ? (
                  <>
                    <LoaderIcon className="size-3 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-amber-900">
              {entry.body}
            </p>
            {inlineError ? (
              <p className="mt-2 text-xs text-rose-700">{inlineError}</p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

function SystemDivider({
  entry,
  volunteerFirstName,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly volunteerFirstName: string;
}) {
  return (
    <li>
      <DividerLabel>
        {personalizeSystemBody(entry.body, volunteerFirstName)}
      </DividerLabel>
    </li>
  );
}

function bodyTextForEntry(entry: InboxTimelineEntryViewModel): string {
  return entry.body.trim();
}

function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) return firstName;
  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
}

type EntryRole =
  | "inbound"
  | "outbound"
  | "activity"
  | "automated"
  | "campaign"
  | "note"
  | "system";

function roleForKind(kind: InboxTimelineEntryKind): EntryRole {
  switch (kind) {
    case "inbound-email":
    case "inbound-sms":
      return "inbound";
    case "outbound-email":
    case "outbound-sms":
      return "outbound";
    case "email-activity":
      return "activity";
    case "outbound-auto-email":
    case "outbound-auto-sms":
      return "automated";
    case "outbound-campaign-email":
    case "outbound-campaign-sms":
      return "campaign";
    case "internal-note":
      return "note";
    case "system-event":
      return "system";
  }
}
