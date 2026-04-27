"use client";

import { useId, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  MailIcon,
} from "./icons";

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

function formatExactTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function extractDisplayName(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const stripped = value.replace(/\s*<[^>]+>\s*/g, "").trim();
  return stripped.length === 0 ? value.trim() : stripped;
}

function RelativeTimestamp({
  timestamp,
  label,
  className,
}: {
  readonly timestamp: string;
  readonly label: string;
  readonly className?: string;
}) {
  const exactLabel = formatExactTimestamp(timestamp);

  return (
    <time
      dateTime={timestamp}
      title={exactLabel}
      className={cn(
        "cursor-help rounded-sm decoration-dotted underline-offset-2 hover:underline",
        FOCUS_RING,
        className,
      )}
    >
      {label}
    </time>
  );
}

export function EmailParticipantHeader({
  entry,
  tone = "slate",
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly tone?: "slate" | "sky";
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  if (entry.channel !== "email") {
    return null;
  }

  const rows = [
    { label: "From", value: entry.fromHeader ?? entry.actorLabel },
    { label: "To", value: entry.toHeader ?? "Unknown recipient" },
    { label: "Cc", value: entry.ccHeader },
  ].filter(
    (
      row,
    ): row is {
      readonly label: "From" | "To" | "Cc";
      readonly value: string;
    } => row.value !== null,
  );

  const sender = extractDisplayName(entry.fromHeader) ?? entry.actorLabel;
  const recipient = extractDisplayName(entry.toHeader) ?? "Unknown recipient";
  const hasCc = entry.ccHeader !== null && entry.ccHeader.trim().length > 0;
  const headerBorderClass =
    tone === "sky" ? "border-sky-100/60" : "border-slate-100";
  const detailBorderClass =
    tone === "sky"
      ? "border-sky-100/60 bg-sky-50/40"
      : "border-slate-100 bg-slate-50/40";
  const ccClass =
    tone === "sky" ? "bg-sky-100/70 text-sky-700" : "bg-slate-100 text-slate-500";

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b px-4 py-2",
          headerBorderClass,
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-controls={contentId}
            aria-label={expanded ? "Hide full email headers" : "Show full email headers"}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]",
              FOCUS_RING,
              TRANSITION.fast,
              TRANSITION.reduceMotion,
            )}
          >
            <MailIcon className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="min-w-0 truncate font-medium text-slate-800">
              {sender}
            </span>
            <ArrowRightIcon className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="min-w-0 truncate text-slate-700">{recipient}</span>
            {hasCc ? (
              <span
                className={cn(
                  "shrink-0 rounded-sm px-1 py-px text-[10px] font-medium",
                  ccClass,
                )}
              >
                +cc
              </span>
            ) : null}
            <ChevronDownIcon
              className={cn(
                "h-3 w-3 shrink-0 text-slate-400 transition-transform duration-150",
                expanded && "rotate-180",
                TRANSITION.reduceMotion,
              )}
            />
          </button>
        </CollapsibleTrigger>

        <RelativeTimestamp
          timestamp={entry.occurredAt}
          label={entry.occurredAtLabel}
          className={cn(TYPE.micro, "shrink-0 text-slate-400")}
        />
      </div>

      <CollapsibleContent
        id={contentId}
        className={cn("border-b px-4 py-2", detailBorderClass)}
      >
        <dl className="space-y-1 text-[11.5px] leading-relaxed text-slate-600">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2"
            >
              <dt className="font-medium text-slate-400">{row.label}</dt>
              <dd className={cn("min-w-0 text-slate-700", WRAP_ANYWHERE)}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
