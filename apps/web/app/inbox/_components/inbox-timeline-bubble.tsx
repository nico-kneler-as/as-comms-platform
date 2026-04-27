"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SHADOW, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import { EmailParticipantHeader } from "./email-participant-header";
import { InboxAvatar } from "./inbox-avatar";
import {
  AdventureScientistsLogo,
  CornerUpLeftIcon,
  LoaderIcon,
  MailIcon,
  PhoneIcon,
  RefreshCwIcon,
} from "./icons";

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";

function initialsForLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "AS";
  }

  if (parts.length === 1) {
    return (parts[0] ?? "AS").slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function bodyTextForEntry(entry: InboxTimelineEntryViewModel): string {
  return entry.body.trim();
}

function ReplyFooter({
  entryId,
  tone,
  onReply,
}: {
  readonly entryId: string;
  readonly tone: "slate" | "sky" | "sky-inverse";
  readonly onReply?: (entryId: string) => void;
}) {
  if (onReply === undefined) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-end border-t px-4 py-2",
        tone === "sky-inverse"
          ? "border-sky-500/40"
          : tone === "sky"
            ? "border-sky-100/60"
            : "border-slate-100",
      )}
    >
      <button
        type="button"
        onClick={() => {
          onReply(entryId);
        }}
        className={cn(
          "inline-flex items-center gap-1 text-[12px]",
          TRANSITION.fast,
          TRANSITION.reduceMotion,
          tone === "sky-inverse"
            ? "text-sky-100 hover:text-white hover:underline"
            : "text-sky-700 hover:underline",
        )}
      >
        <CornerUpLeftIcon className="h-3 w-3" />
        <span>Reply</span>
      </button>
    </div>
  );
}

function InboundMetadataRow({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const ChannelIcon = entry.channel === "email" ? MailIcon : PhoneIcon;

  return (
    <div className={cn("mt-1.5 flex items-center gap-1.5 px-1", TYPE.micro)}>
      <ChannelIcon className="h-3 w-3" />
      <span className="font-medium text-slate-500">{entry.actorLabel}</span>
      {entry.isUnread ? (
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"
          aria-label="Unread"
        />
      ) : null}
    </div>
  );
}

function OutboundSmsMetaRow({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 pr-1 text-[11px] text-sky-600">
      <PhoneIcon className="h-3 w-3" />
      <span className="font-medium uppercase tracking-wide">SMS</span>
      <span className="text-sky-300">·</span>
      <time
        dateTime={entry.occurredAt}
        title={entry.occurredAt}
        className="text-sky-700/80"
      >
        {entry.occurredAtLabel}
      </time>
    </div>
  );
}

function OutboundStatusBanner({
  entry,
  isRetrying,
  onRetryPending,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly isRetrying: boolean;
  readonly onRetryPending?: (entryId: string) => void;
}) {
  if (entry.sendStatus === "pending") {
    return (
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] font-medium text-sky-700">
        <LoaderIcon className="size-3 animate-spin" />
        Sending...
      </div>
    );
  }

  if (entry.sendStatus !== "failed" && entry.sendStatus !== "orphaned") {
    return null;
  }

  const canRetry =
    entry.attachmentCount === 0 && onRetryPending !== undefined;
  const retryDisabledReason =
    entry.attachmentCount > 0
      ? "Re-attach files and send as a new message"
      : null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
      <span>
        {entry.failedReason === "bounce"
          ? "Your last reply to this contact bounced — recipient address may be invalid."
          : entry.sendStatus === "failed"
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
  );
}

function OutboundBrandAvatar() {
  return (
    <span
      aria-label="Adventure Scientists"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white ring-1 ring-slate-900/10"
    >
      <AdventureScientistsLogo className="size-6" />
    </span>
  );
}

export function MessageBubble({
  entry,
  direction,
  onReply,
  isRetrying = false,
  onRetryPending,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly direction: "inbound" | "outbound";
  readonly onReply?: (entryId: string) => void;
  readonly isRetrying?: boolean;
  readonly onRetryPending?: (entryId: string) => void;
}) {
  const isEmail = entry.channel === "email";
  const isOutbound = direction === "outbound";
  const body = bodyTextForEntry(entry);
  const inboundAvatar = (
    <InboxAvatar
      initials={initialsForLabel(entry.actorLabel)}
      tone="slate"
      size="sm"
    />
  );

  const bubbleClassName = isEmail
    ? isOutbound
      ? "border border-sky-100 bg-sky-50"
      : "border border-slate-200 bg-white"
    : isOutbound
      ? "border border-sky-600 bg-sky-600 text-white"
      : "border border-slate-200 bg-white";
  const replyTone = isOutbound ? (isEmail ? "sky" : "sky-inverse") : "slate";

  return (
    <li
      className={cn(
        "flex w-full flex-col",
        isOutbound ? "items-end pl-16" : "items-start pr-16",
      )}
    >
      {isOutbound && !isEmail ? <OutboundSmsMetaRow entry={entry} /> : null}

      <div
        className={cn(
          "flex w-full items-start gap-2.5",
          isOutbound ? "justify-end" : "justify-start",
        )}
      >
        {!isOutbound ? (
          <div className="mt-2 shrink-0">{inboundAvatar}</div>
        ) : null}

        <div
          className={cn(
            "min-w-0 w-full max-w-[640px] overflow-hidden rounded-xl",
            SHADOW.sm,
            bubbleClassName,
          )}
        >
          {isEmail ? (
            <EmailParticipantHeader
              entry={entry}
              tone={isOutbound ? "sky" : "slate"}
            />
          ) : null}

          <div className={cn("px-4", isEmail ? "py-3" : "py-2.5")}>
            {isOutbound ? (
              <OutboundStatusBanner
                entry={entry}
                isRetrying={isRetrying}
                {...(onRetryPending === undefined ? {} : { onRetryPending })}
              />
            ) : null}

            {isEmail && entry.subject ? (
              <p
                className={cn(
                  "mb-1.5 text-balance text-[14px] font-semibold text-slate-900",
                  WRAP_ANYWHERE,
                )}
              >
                {entry.subject}
              </p>
            ) : null}

            {body.length > 0 ? (
              <p
                className={cn(
                  "whitespace-pre-wrap text-pretty text-[14px] leading-relaxed",
                  isOutbound && !isEmail ? "text-white" : "text-slate-700",
                  WRAP_ANYWHERE,
                )}
              >
                {autolinkText(body)}
              </p>
            ) : null}
          </div>

          <ReplyFooter
            entryId={entry.id}
            tone={replyTone}
            {...(onReply === undefined ? {} : { onReply })}
          />
        </div>

        {isOutbound ? (
          <div className="mt-2 shrink-0">
            <OutboundBrandAvatar />
          </div>
        ) : null}
      </div>

      {!isOutbound ? <InboundMetadataRow entry={entry} /> : null}
    </li>
  );
}
