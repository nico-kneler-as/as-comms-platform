"use client";

import { useState } from "react";
import type {
  InboxTimelineEntryKind,
  InboxTimelinePresentationItem,
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
import { TRANSITION } from "@/app/_lib/design-tokens-v2";
import { TimelineAutomatedRow } from "./inbox-timeline-automated-row";
import { MessageBubble } from "./inbox-timeline-bubble";
import { TimelineNoteEntry } from "./inbox-timeline-note-entry";
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
  readonly hasMore?: boolean;
  readonly isLoadingOlder?: boolean;
  readonly onLoadOlder?: () => void;
  readonly retryingEntryId?: string | null;
  readonly onRetryPending?: (entryId: string) => void;
  readonly onReply?: (entryId: string) => void;
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

        <ol className="mx-auto flex w-full max-w-[840px] flex-col gap-3">
          {presentationItems.map((item) => (
            <TimelinePresentationItem
              key={item.id}
              item={item}
              volunteerFirstName={volunteerFirstName}
              currentOperatorUserId={currentOperatorUserId}
              isExpanded={expanded.has(item.id)}
              retryingEntryId={retryingEntryId}
              onRetryPending={onRetryPending}
              {...(onReply === undefined ? {} : { onReply })}
              onToggle={() => {
                toggle(item.id);
              }}
              isChildExpanded={(entryId) => expanded.has(entryId)}
              onToggleChild={toggle}
            />
          ))}
        </ol>
      </div>
    </TooltipProvider>
  );
}

interface PresentationItemProps {
  readonly item: InboxTimelinePresentationItem;
  readonly volunteerFirstName: string;
  readonly currentOperatorUserId: string;
  readonly isExpanded: boolean;
  readonly retryingEntryId: string | null;
  readonly onRetryPending: ((entryId: string) => void) | undefined;
  readonly onReply?: (entryId: string) => void;
  readonly onToggle: () => void;
  readonly isChildExpanded: (entryId: string) => boolean;
  readonly onToggleChild: (entryId: string) => void;
}

function TimelinePresentationItem({
  item,
  volunteerFirstName,
  currentOperatorUserId,
  isExpanded,
  retryingEntryId,
  onRetryPending,
  onReply,
  onToggle,
  isChildExpanded,
  onToggleChild,
}: PresentationItemProps) {
  if (item.kind === "system-message-group") {
    return (
      <SystemMessageGroup
        group={item}
        isExpanded={isExpanded}
        currentOperatorUserId={currentOperatorUserId}
        retryingEntryId={retryingEntryId}
        onRetryPending={onRetryPending}
        onToggle={onToggle}
        isChildExpanded={isChildExpanded}
        onToggleChild={onToggleChild}
      />
    );
  }

  return (
    <TimelineEntry
      entry={item}
      volunteerFirstName={volunteerFirstName}
      currentOperatorUserId={currentOperatorUserId}
      isExpanded={isExpanded}
      retryingEntryId={retryingEntryId}
      onRetryPending={onRetryPending}
      {...(onReply === undefined ? {} : { onReply })}
      onToggle={onToggle}
    />
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
  onReply,
  onToggle,
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
      return (
        <MessageBubble
          entry={entry}
          direction="inbound"
          {...(onReply === undefined ? {} : { onReply })}
        />
      );
    case "outbound":
      return (
        <MessageBubble
          entry={entry}
          direction="outbound"
          isRetrying={retryingEntryId === entry.id}
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
  currentOperatorUserId,
  isExpanded,
  retryingEntryId,
  onRetryPending,
  onToggle,
  isChildExpanded,
  onToggleChild,
}: {
  readonly group: InboxTimelineSystemGroupViewModel;
  readonly currentOperatorUserId: string;
  readonly isExpanded: boolean;
  readonly retryingEntryId: string | null;
  readonly onRetryPending: ((entryId: string) => void) | undefined;
  readonly onToggle: () => void;
  readonly isChildExpanded: (entryId: string) => boolean;
  readonly onToggleChild: (entryId: string) => void;
}) {
  const summary = formatSystemGroupSummary(group);

  return (
    <li className="flex w-full justify-end pl-16">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          className={cn(
            "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50/60",
            "transition-[background-color,transform] duration-150 ease-out active:scale-[0.99]",
            TRANSITION.reduceMotion,
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="-space-x-1 flex shrink-0 items-center">
              {group.entries.slice(0, 3).map((entry) => (
                <span
                  key={entry.id}
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full ring-2 ring-white",
                    roleForKind(entry.kind) === "campaign"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  {roleForKind(entry.kind) === "campaign" ? (
                    <MegaphoneIcon className="size-2.5" />
                  ) : (
                    <ZapIcon className="size-2.5" />
                  )}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-slate-800">
                {summary}
              </div>
              <RelativeTimestamp
                timestamp={group.occurredAt}
                label={group.occurredAtLabel}
                asSpan
                focusable={false}
                className="text-[11px] text-slate-400"
              />
            </div>
          </div>
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-slate-400 transition-transform duration-150",
              isExpanded && "rotate-90",
              TRANSITION.reduceMotion,
            )}
          />
        </button>
        {isExpanded ? (
          <ol className="space-y-2 border-t border-slate-100 bg-slate-50/30 p-3">
            {group.entries.map((entry) => (
              <TimelineEntry
                key={entry.id}
                entry={entry}
                volunteerFirstName=""
                currentOperatorUserId={currentOperatorUserId}
                isExpanded={isChildExpanded(entry.id)}
                retryingEntryId={retryingEntryId}
                onRetryPending={onRetryPending}
                onToggle={() => {
                  onToggleChild(entry.id);
                }}
              />
            ))}
          </ol>
        ) : null}
      </div>
    </li>
  );
}

function formatSystemGroupSummary(
  group: InboxTimelineSystemGroupViewModel,
): string {
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
