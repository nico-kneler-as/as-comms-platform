import type { ComponentType } from "react";

import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { cn } from "@/lib/utils";
import { SHADOW, TONE_CLASSES, type ToneNameV2 } from "@/app/_lib/design-tokens-v2";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import { TIMELINE_GRID_COLUMNS } from "./inbox-timeline-bubble";
import {
  BookOpenIcon,
  CalendarIcon,
  CheckCircleIcon,
  HandIcon,
  MapPinIcon,
  StarIcon,
} from "./icons";

const EXACT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ORG_TIMEZONE,
  timeZoneName: "short",
});

function formatExactTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) {
    return firstName;
  }

  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
}

export interface SystemDividerCategory {
  readonly tone: ToneNameV2;
  readonly Icon: ComponentType<{ className?: string }>;
}

export function classifySystemDivider(body: string): SystemDividerCategory {
  const normalized = body.toLowerCase();

  if (
    normalized.includes("completed training") ||
    normalized.includes("training completed") ||
    normalized.includes("training successful")
  ) {
    return {
      tone: "emerald",
      Icon: CheckCircleIcon,
    };
  }

  if (normalized.includes("training")) {
    return {
      tone: "sky",
      Icon: BookOpenIcon,
    };
  }

  if (
    normalized.includes("first data") ||
    normalized.includes("submitted first") ||
    normalized.includes("batch")
  ) {
    return {
      tone: "emerald",
      Icon: StarIcon,
    };
  }

  if (
    normalized.includes("signed up") ||
    normalized.includes("applied") ||
    normalized.includes("signup")
  ) {
    return {
      tone: "violet",
      Icon: HandIcon,
    };
  }

  if (
    normalized.includes("trip planning") ||
    normalized.includes("moved to trip")
  ) {
    return {
      tone: "amber",
      Icon: CalendarIcon,
    };
  }

  if (normalized.includes("field") || normalized.includes("in the field")) {
    return {
      tone: "emerald",
      Icon: MapPinIcon,
    };
  }

  if (
    normalized.includes("completed") ||
    normalized.includes("successful") ||
    normalized.includes("complete")
  ) {
    return {
      tone: "emerald",
      Icon: CheckCircleIcon,
    };
  }

  return { tone: "slate", Icon: CalendarIcon };
}

export function SystemDivider({
  entry,
  volunteerFirstName,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly volunteerFirstName: string;
}) {
  const body = personalizeSystemBody(entry.body, volunteerFirstName);
  const category = classifySystemDivider(body);
  const tone = TONE_CLASSES[category.tone];

  return (
    <li className={cn("col-span-3 grid", TIMELINE_GRID_COLUMNS)}>
      <div className="col-start-2 flex items-start">
        <div
          className={cn(
            "inline-flex max-w-[560px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5",
            SHADOW.sm,
          )}
        >
          <span
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
              tone.subtle,
            )}
          >
            <category.Icon className={cn("size-3", tone.text)} />
          </span>
          <span className="text-[12.5px] text-slate-700">{body}</span>
          <span className="text-[11px] text-slate-400 tabular-nums" aria-hidden="true">
            ·
          </span>
          <time
            dateTime={entry.occurredAt}
            title={formatExactTimestamp(entry.occurredAt)}
            className="cursor-help text-[11px] text-slate-400 tabular-nums"
          >
            {entry.occurredAtLabel}
          </time>
        </div>
      </div>
    </li>
  );
}
