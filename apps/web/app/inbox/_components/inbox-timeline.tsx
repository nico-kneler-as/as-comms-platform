"use client";

import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
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
  BotIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  EyeIcon,
  LoaderIcon,
  MailIcon,
  MegaphoneIcon,
  MousePointerClickIcon,
  NoteIcon,
  PhoneIcon,
  RefreshCwIcon,
  SparkleIcon,
  WandIcon,
  XIcon,
  MapPinIcon,
} from "./icons";
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

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";
const EXACT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

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
    <TooltipProvider>
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
    </TooltipProvider>
  );
}

function formatExactTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function RelativeTimestamp({
  timestamp,
  label,
  className,
  asSpan = false,
  focusable = true,
}: {
  readonly timestamp: string;
  readonly label: string;
  readonly className?: string;
  readonly asSpan?: boolean;
  readonly focusable?: boolean;
}) {
  const exactLabel = formatExactTimestamp(timestamp);

  const content = asSpan ? (
    <span
      title={exactLabel}
      tabIndex={focusable ? 0 : undefined}
      className={cn(
        "cursor-help rounded-sm decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 hover:underline",
        className,
      )}
    >
      {label}
    </span>
  ) : (
    <time
      dateTime={timestamp}
      title={exactLabel}
      tabIndex={focusable ? 0 : undefined}
      className={cn(
        "cursor-help rounded-sm decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 hover:underline",
        className,
      )}
    >
      {label}
    </time>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top">
        <p>{exactLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function TimelineTimestamp({
  entry,
  className,
  asSpan = false,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly className?: string;
  readonly asSpan?: boolean;
}) {
  return (
    <RelativeTimestamp
      timestamp={entry.occurredAt}
      label={entry.occurredAtLabel}
      asSpan={asSpan}
      {...(className === undefined ? {} : { className })}
    />
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
        className={`min-w-0 w-full max-w-2xl ${RADIUS.bubble} rounded-bl-sm border border-slate-200 bg-white px-4 py-3 ${SHADOW.sm}`}
      >
        <EmailParticipantHeaders entry={entry} tone="inbound" />
        {isEmail && entry.subject ? (
          <p
            className={cn(
              "mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-900",
              WRAP_ANYWHERE,
            )}
          >
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p
            className={cn(
              `whitespace-pre-wrap text-pretty ${TEXT.bodySm}`,
              WRAP_ANYWHERE,
            )}
          >
            {autolinkText(body, "text-sky-600")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <ChannelIcon className="h-3 w-3" />
        <span className="font-medium text-slate-500">{entry.actorLabel}</span>
        <span>·</span>
        <TimelineTimestamp entry={entry} />
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
        className={cn(
          `min-w-0 w-full max-w-2xl ${RADIUS.bubble} rounded-br-sm border border-sky-100 bg-sky-50/80 px-4 py-3 ${SHADOW.sm}`,
          "backdrop-blur-[1px]",
        )}
      >
        {entry.sendStatus === "pending" ? (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] font-medium text-sky-700">
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

        <EmailParticipantHeaders entry={entry} tone="outbound" />
        {isEmail && entry.subject ? (
          <p
            className={cn(
              "mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-900",
              WRAP_ANYWHERE,
            )}
          >
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p
            className={cn(
              "whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-slate-700",
              WRAP_ANYWHERE,
            )}
          >
            {autolinkText(body, "text-sky-700")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <TimelineTimestamp entry={entry} />
        <span>·</span>
        <ChannelIcon className="h-3 w-3" />
      </div>
    </li>
  );
}

function EmailParticipantHeaders({
  entry,
  tone,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly tone: "inbound" | "outbound";
}) {
  if (
    entry.channel !== "email" ||
    (entry.fromHeader === null &&
      entry.toHeader === null &&
      entry.ccHeader === null)
  ) {
    return null;
  }

  const borderClass =
    tone === "inbound" ? "border-slate-200" : "border-sky-100";
  const rows = [
    { label: "From", value: entry.fromHeader },
    { label: "To", value: entry.toHeader },
    { label: "Cc", value: entry.ccHeader },
  ].filter(
    (
      row,
    ): row is {
      readonly label: "From" | "To" | "Cc";
      readonly value: string;
    } => row.value !== null,
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <dl
      className={`mb-2.5 space-y-1 border-b pb-2.5 text-[11px] leading-relaxed ${borderClass}`}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2"
        >
          <dt className="font-medium uppercase tracking-[0.08em] text-slate-500">
            {row.label}
          </dt>
          <dd className={cn("min-w-0 break-words text-slate-700", WRAP_ANYWHERE)}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
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
  const campaignActivity =
    entry.kind === "outbound-campaign-email" ? entry.campaignActivity : [];
  const campaignState =
    role === "campaign"
      ? describeCampaignVisualState(campaignActivity)
      : undefined;
  const descriptor = describeEventRow({
    role,
    isEmail,
  });
  const headline = entry.subject;
  const body = bodyTextForEntry(entry);
  const hideCollapsedBody = shouldHideAutomatedRowBody({
    isExpanded,
    kind: entry.kind,
    headline,
  });

  return (
    <li className="flex w-full flex-col items-end">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-expanded={isExpanded}
            title={formatExactTimestamp(entry.occurredAt)}
            onClick={onToggle}
            data-event-role={role}
            data-campaign-state={campaignState}
            className={cn(
              `group flex w-full max-w-2xl items-start gap-3 ${RADIUS.md} border px-4 py-3 text-left`,
              "transition-[color,background-color,transform] duration-150 ease-out",
              "active:scale-[0.96]",
              TRANSITION.reduceMotion,
              descriptor.shellClassName,
            )}
          >
            <div
              className={cn(
                "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-white/90",
                descriptor.iconClassName,
              )}
            >
              {role === "campaign" ? (
                <CampaignStateIcon state={campaignState ?? "sent"} />
              ) : (
                <descriptor.Icon className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.18em]",
                    descriptor.labelClassName,
                  )}
                >
                  {descriptor.label}
                </span>
                <RelativeTimestamp
                  timestamp={entry.occurredAt}
                  label={entry.occurredAtLabel}
                  asSpan
                  focusable={false}
                  className="text-[11px] text-slate-500"
                />
              </div>
              {headline ? (
                <p
                  className={cn(
                    "mt-2 text-pretty text-[13px] font-semibold leading-snug text-slate-900",
                    WRAP_ANYWHERE,
                  )}
                >
                  {headline}
                </p>
              ) : null}
              {!hideCollapsedBody && body.length > 0 ? (
                <p
                  className={cn(
                    "text-[13px] leading-relaxed text-slate-700",
                    WRAP_ANYWHERE,
                    (headline !== null || role === "campaign") && "mt-1.5",
                    isExpanded
                      ? "whitespace-pre-wrap text-pretty"
                      : "line-clamp-1",
                  )}
                >
                  {isExpanded ? autolinkText(body, "text-sky-600") : body}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1">
              <ChevronRightIcon
                className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-150 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{formatExactTimestamp(entry.occurredAt)}</p>
        </TooltipContent>
      </Tooltip>
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
            <TimelineTimestamp entry={entry} />
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
            <p
              className={cn(
                "whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-amber-900",
                WRAP_ANYWHERE,
              )}
            >
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
  const descriptor = describeLifecycleEvent(
    personalizeSystemBody(entry.body, volunteerFirstName),
  );

  return (
    <li className="flex w-full justify-start">
      <div
        className={cn(
          `flex w-full max-w-2xl items-start gap-3 ${RADIUS.md} border px-4 py-3`,
          "border-amber-200 bg-amber-50/80",
        )}
      >
        <div
          className={cn(
            "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-white/90",
            descriptor.iconClassName,
          )}
        >
          <descriptor.Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.18em]",
                descriptor.labelClassName,
              )}
            >
              {descriptor.label}
            </span>
            <TimelineTimestamp
              entry={entry}
              className="text-[11px] text-slate-500"
              asSpan
            />
          </div>
          <p className="mt-2 text-pretty text-[13px] font-medium leading-relaxed text-slate-800">
            {personalizeSystemBody(entry.body, volunteerFirstName)}
          </p>
        </div>
      </div>
    </li>
  );
}

interface EventRowDescriptor {
  readonly label: string;
  readonly Icon: ComponentType<{ className?: string }>;
  readonly shellClassName: string;
  readonly iconClassName: string;
  readonly labelClassName: string;
}

function describeEventRow(input: {
  readonly role: "automated" | "campaign" | "activity";
  readonly isEmail: boolean;
}): EventRowDescriptor {
  if (input.role === "campaign") {
    return {
      label: input.isEmail ? "Campaign" : "Campaign SMS",
      Icon: MegaphoneIcon,
      shellClassName: "border-violet-200 bg-violet-50/75 hover:bg-violet-50",
      iconClassName: "border-violet-200 text-violet-700",
      labelClassName: "text-violet-700",
    };
  }

  if (input.role === "activity") {
    return {
      label: input.isEmail ? "Activity" : "SMS Activity",
      Icon: input.isEmail ? MailIcon : PhoneIcon,
      shellClassName: "border-violet-200 bg-violet-50/75 hover:bg-violet-50",
      iconClassName: "border-violet-200 text-violet-700",
      labelClassName: "text-violet-700",
    };
  }

  return {
    label: input.isEmail ? "Automated" : "Automated SMS",
    Icon: input.isEmail ? BotIcon : WandIcon,
    shellClassName: "border-sky-200 bg-sky-50/75 hover:bg-sky-50",
    iconClassName: "border-sky-200 text-sky-700",
    labelClassName: "text-sky-700",
  };
}

function describeCampaignVisualState(
  activities: readonly {
    readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  }[],
): "sent" | "opened" | "clicked" | "unsubscribed" {
  if (activities.some((activity) => activity.activityType === "unsubscribed")) {
    return "unsubscribed";
  }

  if (activities.some((activity) => activity.activityType === "clicked")) {
    return "clicked";
  }

  if (activities.some((activity) => activity.activityType === "opened")) {
    return "opened";
  }

  return "sent";
}

function CampaignStateIcon({
  state,
}: {
  readonly state: ReturnType<typeof describeCampaignVisualState>;
}) {
  const AccentIcon =
    state === "clicked"
      ? MousePointerClickIcon
      : state === "opened"
        ? EyeIcon
        : state === "unsubscribed"
          ? XIcon
          : null;

  return (
    <span className="relative inline-flex">
      <MegaphoneIcon className="size-4" />
      {AccentIcon ? (
        <span className="absolute -right-1 -top-1 inline-flex size-3.5 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 shadow-sm">
          <AccentIcon className="size-2" />
        </span>
      ) : (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-violet-500 ring-2 ring-white" />
      )}
    </span>
  );
}

function describeLifecycleEvent(body: string): Omit<
  EventRowDescriptor,
  "shellClassName"
> {
  const normalized = body.toLowerCase();

  if (normalized.includes("training")) {
    return {
      label: "Training",
      Icon: WandIcon,
      iconClassName: "border-sky-200 text-sky-700",
      labelClassName: "text-sky-700",
    };
  }

  if (normalized.includes("field")) {
    return {
      label: "In Field",
      Icon: MapPinIcon,
      iconClassName: "border-emerald-200 text-emerald-700",
      labelClassName: "text-emerald-700",
    };
  }

  if (normalized.includes("successful") || normalized.includes("complete")) {
    return {
      label: "Completed",
      Icon: CheckCircleIcon,
      iconClassName: "border-emerald-200 text-emerald-700",
      labelClassName: "text-emerald-700",
    };
  }

  if (normalized.includes("applied")) {
    return {
      label: "Applied",
      Icon: SparkleIcon,
      iconClassName: "border-violet-200 text-violet-700",
      labelClassName: "text-violet-700",
    };
  }

  return {
    label: "Lifecycle",
    Icon: CalendarIcon,
    iconClassName: "border-amber-200 text-amber-700",
    labelClassName: "text-amber-700",
  };
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
