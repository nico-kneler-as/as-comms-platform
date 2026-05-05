"use client";

import { cn } from "@/lib/utils";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import {
  SMS_BUBBLE_MAX_W,
  TIMELINE_GRID_COLUMNS,
} from "./inbox-timeline-bubble";
import {
  CornerUpLeftIcon,
  LoaderIcon,
  RefreshCwIcon,
} from "./icons";

function StatusBanner({
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
      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-medium text-white/90">
        <LoaderIcon className="size-3 animate-spin" />
        Sending...
      </div>
    );
  }

  if (entry.sendStatus !== "failed" && entry.sendStatus !== "orphaned") {
    return null;
  }

  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-white/12 px-2.5 py-2 text-[11px] text-white/90">
      <span>
        {entry.sendStatus === "failed" ? "Send failed." : "Send stalled."}
      </span>
      {onRetryPending === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onRetryPending(entry.id);
          }}
          disabled={isRetrying}
          className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 font-medium text-sky-700 disabled:opacity-60"
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

export function SmsMessage({
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
  const isOutbound = direction === "outbound";

  return (
    <li className={cn("col-span-3 grid", TIMELINE_GRID_COLUMNS)}>
      <div
        className={cn(
          "col-start-2 min-w-0 flex",
          isOutbound ? "justify-end" : "justify-start",
        )}
      >
        <div className={cn("min-w-0 w-full", SMS_BUBBLE_MAX_W)}>
          <div className="mb-1 px-1">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                isOutbound ? "text-sky-600" : "text-emerald-700",
              )}
            >
              SMS
            </span>
          </div>

          <div
            className={cn(
              "w-full",
              SMS_BUBBLE_MAX_W,
              "rounded-2xl border px-4 py-3 shadow-sm",
              isOutbound
                ? "rounded-br-md border-sky-600 bg-sky-600 text-white"
                : "rounded-bl-md border-slate-200 bg-white text-slate-900",
            )}
          >
            {isOutbound ? (
              <StatusBanner
                entry={entry}
                isRetrying={isRetrying}
                {...(onRetryPending === undefined ? {} : { onRetryPending })}
              />
            ) : null}

            {entry.body.trim().length > 0 ? (
              <p
                className={cn(
                  "whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                  isOutbound ? "text-white" : "text-slate-700",
                )}
              >
                {autolinkText(entry.body)}
              </p>
            ) : null}

            <div
              className={cn(
                "mt-2 text-[11px]",
                isOutbound ? "text-white/75" : "text-slate-500",
              )}
            >
              {entry.occurredAtLabel}
            </div>
          </div>

          {isOutbound ? (
            <div className="mt-1 px-1 text-[11px] text-slate-500">
              {entry.actorLabel}
            </div>
          ) : null}

          {onReply === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                onReply(entry.id);
              }}
              className="mt-2 inline-flex items-center gap-1 px-1 text-[11px] text-slate-500 hover:text-slate-800"
            >
              <CornerUpLeftIcon className="size-3" />
              Reply
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
