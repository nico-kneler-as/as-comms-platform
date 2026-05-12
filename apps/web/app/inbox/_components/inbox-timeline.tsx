"use client";

import { useState } from "react";
import type {
  InboxTimelineEntryKind,
  InboxTimelineSystemGroupViewModel,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import { groupInboxTimelineSystemMessages } from "../_lib/view-models";
import {
  ChevronRightIcon,
  MegaphoneIcon,
  ZapIcon,
} from "./icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { TimelineAutomatedRow } from "./inbox-timeline-automated-row";
import {
  EMAIL_BUBBLE_MAX_W,
  MessageBubble,
  TIMELINE_GRID_COLUMNS,
  TIMELINE_OUTER_MAX_W,
} from "./inbox-timeline-bubble";
import { TimelineNoteEntry } from "./inbox-timeline-note-entry";
import { SmsMessage } from "./sms-message";
import { SystemDivider } from "./inbox-timeline-system-divider";

export { shouldHideAutomatedRowBody } from "./inbox-timeline-automated-row";
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
  readonly showEarlierHistoryDivider?: boolean;
  readonly hasMore?: boolean;
  readonly isLoadingOlder?: boolean;
  readonly onLoadOlder?: () => void;
  readonly retryingEntryId?: string | null;
  readonly onRetryPending?: (entryId: string) => void;
  readonly onForward?: (entryId: string) => void;
  readonly onReply?: (entryId: string) => void;
}

export function InboxTimeline({
  entries,
  volunteerFirstName,
  currentOperatorUserId,
  showEarlierHistoryDivider = false,
  hasMore = false,
  isLoadingOlder = false,
  onLoadOlder,
  retryingEntryId = null,
  onRetryPending,
  onForward,
  onReply,
}: TimelineProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const presentationItems = groupInboxTimelineSystemMessages(entries);

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

        <ol
          className={cn(
            "mx-auto grid w-full gap-x-2.5 gap-y-3",
            TIMELINE_OUTER_MAX_W,
            TIMELINE_GRID_COLUMNS,
          )}
        >
          {showEarlierHistoryDivider ? (
            <li
              aria-label="Earlier history not shown"
              className={cn("col-span-3 list-none grid", TIMELINE_GRID_COLUMNS)}
            >
              <div className="col-start-2 flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span className="whitespace-nowrap">
                  Earlier history not shown - full capture began Jan 1, 2025
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </li>
          ) : null}
          {presentationItems.flatMap((item) => {
            if (item.kind !== "system-message-group") {
              return [
                <TimelineEntry
                  key={item.id}
                  entry={item}
                  volunteerFirstName={volunteerFirstName}
                  currentOperatorUserId={currentOperatorUserId}
                  isExpanded={expanded.has(item.id)}
                  retryingEntryId={retryingEntryId}
                  onRetryPending={onRetryPending}
                  {...(onForward === undefined ? {} : { onForward })}
                  {...(onReply === undefined ? {} : { onReply })}
                  onToggle={() => {
                    toggle(item.id);
                  }}
                />,
              ];
            }

            const rows = [
              <SystemMessageGroup
                key={item.id}
                group={item}
                isExpanded={expanded.has(item.id)}
                onToggle={() => {
                  toggle(item.id);
                }}
              />,
            ];

            if (!expanded.has(item.id)) {
              return rows;
            }

            return rows.concat(
              item.entries.map((entry) => (
                <TimelineEntry
                  key={entry.id}
                  entry={entry}
                  volunteerFirstName={volunteerFirstName}
                  currentOperatorUserId={currentOperatorUserId}
                  isExpanded={expanded.has(entry.id)}
                  retryingEntryId={retryingEntryId}
                  onRetryPending={onRetryPending}
                  {...(onForward === undefined ? {} : { onForward })}
                  {...(onReply === undefined ? {} : { onReply })}
                  onToggle={() => {
                    toggle(entry.id);
                  }}
                />
              )),
            );
          })}
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

interface EntryProps {
  readonly entry: InboxTimelineEntryViewModel;
  readonly volunteerFirstName: string;
  readonly currentOperatorUserId: string;
  readonly isExpanded: boolean;
  readonly retryingEntryId: string | null;
  readonly onRetryPending: ((entryId: string) => void) | undefined;
  readonly onForward?: (entryId: string) => void;
  readonly onReply?: (entryId: string) => void;
  readonly onToggle: () => void;
}

function TimelineEntry({
  entry,
  volunteerFirstName,
  currentOperatorUserId,
  isExpanded,
  retryingEntryId,
  onRetryPending,
  onForward,
  onReply,
  onToggle,
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
      if (entry.kind === "inbound-sms") {
        return (
          <SmsMessage
            entry={entry}
            direction="inbound"
            {...(onReply === undefined ? {} : { onReply })}
          />
        );
      }

      return (
        <MessageBubble
          entry={entry}
          direction="inbound"
          {...(onForward === undefined ? {} : { onForward })}
          {...(onReply === undefined ? {} : { onReply })}
        />
      );
    case "outbound":
      if (entry.kind === "outbound-sms") {
        return (
          <SmsMessage
            entry={entry}
            direction="outbound"
            isRetrying={retryingEntryId === entry.id}
            {...(onReply === undefined ? {} : { onReply })}
            {...(onRetryPending === undefined ? {} : { onRetryPending })}
          />
        );
      }

      return (
        <MessageBubble
          entry={entry}
          direction="outbound"
          isRetrying={retryingEntryId === entry.id}
          {...(onForward === undefined ? {} : { onForward })}
          {...(onReply === undefined ? {} : { onReply })}
          {...(onRetryPending === undefined ? {} : { onRetryPending })}
        />
      );
    case "automated":
    case "campaign":
    case "activity":
      return (
        <TimelineAutomatedRow
          entry={entry}
          role={role}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "note":
      return (
        <TimelineNoteEntry
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

function SystemMessageGroup({
  group,
  isExpanded,
  onToggle,
}: {
  readonly group: InboxTimelineSystemGroupViewModel;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const summary = formatSystemGroupSummary(group);
  const primaryKind = group.campaignCount > 0 ? "campaign" : "automated";
  const GroupIcon = primaryKind === "campaign" ? MegaphoneIcon : ZapIcon;

  return (
    <li className={cn("col-span-3 grid", TIMELINE_GRID_COLUMNS)}>
      <div className="col-start-2 flex justify-end">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          data-group-icon={primaryKind}
          className={cn(
            "group w-full overflow-hidden rounded-xl border px-4 py-3 text-left shadow-sm",
            "border-violet-200/70 bg-violet-50/40 hover:bg-violet-50/70",
            "transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2",
            EMAIL_BUBBLE_MAX_W,
            TRANSITION.reduceMotion,
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
                  TONE_CLASSES.violet.avatar,
                )}
              >
                <GroupIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-slate-900">
                  {summary}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-violet-700/80 tabular-nums">
                  <RelativeTimestamp
                    timestamp={group.occurredAt}
                    label={group.occurredAtLabel}
                    asSpan
                    focusable={false}
                  />
                  <span aria-hidden="true" className="text-violet-300">
                    ·
                  </span>
                  <span>{isExpanded ? "Click to collapse" : "Click to expand"}</span>
                </div>
              </div>
            </div>
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-violet-500 transition-transform duration-150",
                isExpanded && "rotate-90",
                TRANSITION.reduceMotion,
              )}
            />
          </div>
        </button>
      </div>
    </li>
  );
}

function formatSystemGroupSummary(
  group: InboxTimelineSystemGroupViewModel,
): string {
  if (group.campaignCount > 0 && group.automatedCount === 0) {
    return `${String(group.campaignCount)} campaign${group.campaignCount === 1 ? "" : "s"}`;
  }

  if (group.automatedCount > 0 && group.campaignCount === 0) {
    return `${String(group.automatedCount)} automated send${group.automatedCount === 1 ? "" : "s"}`;
  }

  const parts: string[] = [];

  if (group.automatedCount > 0) {
    parts.push(`${String(group.automatedCount)} automated`);
  }

  if (group.campaignCount > 0) {
    parts.push(
      `${String(group.campaignCount)} campaign${group.campaignCount === 1 ? "" : "s"}`,
    );
  }

  return parts.join(" · ");
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
