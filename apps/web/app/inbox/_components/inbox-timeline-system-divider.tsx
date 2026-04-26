import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { SHADOW, TONE_CLASSES, TYPE, type ToneNameV2 } from "@/app/_lib/design-tokens-v2";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import {
  CalendarIcon,
  CheckCircleIcon,
  DatabaseIcon,
  MapPinIcon,
  SparkleIcon,
  WandIcon,
} from "./icons";

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

function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) {
    return firstName;
  }

  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
}

export interface SystemDividerCategory {
  readonly label:
    | "LIFECYCLE"
    | "APPLIED"
    | "TRAINING"
    | "TRIP PLANNING"
    | "IN FIELD"
    | "FIRST DATA"
    | "COMPLETED";
  readonly tone: ToneNameV2;
  readonly Icon: ComponentType<{ className?: string }>;
}

export function classifySystemDivider(body: string): SystemDividerCategory {
  const normalized = body.toLowerCase();

  if (normalized.includes("applied")) {
    return {
      label: "APPLIED",
      tone: "violet",
      Icon: SparkleIcon,
    };
  }

  if (normalized.includes("trip planning") || normalized.includes("moved to trip")) {
    return {
      label: "TRIP PLANNING",
      tone: "amber",
      Icon: CalendarIcon,
    };
  }

  if (normalized.includes("training")) {
    return {
      label: "TRAINING",
      tone: "sky",
      Icon: WandIcon,
    };
  }

  if (normalized.includes("first data") || normalized.includes("submitted first") || normalized.includes("batch")) {
    return {
      label: "FIRST DATA",
      tone: "emerald",
      Icon: DatabaseIcon,
    };
  }

  if (normalized.includes("field") || normalized.includes("in the field")) {
    return {
      label: "IN FIELD",
      tone: "emerald",
      Icon: MapPinIcon,
    };
  }

  if (normalized.includes("completed") || normalized.includes("successful") || normalized.includes("complete")) {
    return {
      label: "COMPLETED",
      tone: "emerald",
      Icon: CheckCircleIcon,
    };
  }

  return {
    label: "LIFECYCLE",
    tone: "amber",
    Icon: CalendarIcon,
  };
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
    <li className="flex w-full items-center justify-center gap-3 py-1.5">
      <div className="h-px flex-1 bg-slate-200" />
      <div
        className={cn(
          "inline-flex max-w-[720px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1",
          SHADOW.sm,
        )}
      >
        <span
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
            tone.subtle,
          )}
        >
          <category.Icon className={cn("h-3 w-3", tone.text)} />
        </span>
        <span className={cn(TYPE.label, tone.text)}>{category.label}</span>
        <span className="text-[11.5px] text-slate-600">{body}</span>
        <time
          dateTime={entry.occurredAt}
          title={formatExactTimestamp(entry.occurredAt)}
          className="cursor-help text-[11px] text-slate-400"
        >
          {entry.occurredAtLabel}
        </time>
      </div>
      <div className="h-px flex-1 bg-slate-200" />
    </li>
  );
}
