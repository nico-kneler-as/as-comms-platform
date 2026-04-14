import type { ComponentType, SVGProps } from "react";

import type {
  ClaudeTimelineEntryKind,
  ClaudeTimelineEntryViewModel
} from "../_lib/view-models";
import {
  MailIcon,
  NoteIcon,
  PhoneIcon,
  SparkleIcon
} from "./claude-icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface TimelineProps {
  readonly entries: readonly ClaudeTimelineEntryViewModel[];
}

export function ClaudeInboxTimeline({ entries }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        No history yet for this person.
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {entries.map((entry) => (
        <ClaudeTimelineEntry key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}

function ClaudeTimelineEntry({
  entry
}: {
  readonly entry: ClaudeTimelineEntryViewModel;
}) {
  const { style, Icon, label } = STYLES[entry.kind];
  const isOutbound =
    entry.kind === "outbound-email" || entry.kind === "outbound-sms";
  const isNote = entry.kind === "internal-note";
  const isSystem = entry.kind === "system-event" || entry.kind === "campaign-event";

  if (isSystem) {
    return (
      <li className="flex items-center gap-3 text-xs text-slate-500">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">·</span>
        <span>{entry.body}</span>
        <span className="ml-auto text-slate-400">{entry.occurredAtLabel}</span>
      </li>
    );
  }

  return (
    <li
      className={`rounded-2xl border p-4 shadow-sm ${
        isNote
          ? "border-amber-200 bg-amber-50/60"
          : entry.isUnread
            ? "border-sky-200 bg-white ring-1 ring-sky-100"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full ${style}`}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">
              {entry.actorLabel}
            </p>
            <span className="shrink-0 text-xs text-slate-500">
              {entry.occurredAtLabel}
            </span>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {isOutbound ? "Sent" : isNote ? "Internal note" : "Received"}
            {entry.channel ? ` · ${entry.channel}` : ""}
          </p>
        </div>
        {entry.isUnread ? (
          <span className="inline-flex h-2 w-2 rounded-full bg-sky-500" aria-label="Unread" />
        ) : null}
      </div>
      {entry.subject ? (
        <p className="mt-3 text-[13px] font-semibold text-slate-900">
          {entry.subject}
        </p>
      ) : null}
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
        {entry.body}
      </p>
    </li>
  );
}

interface KindStyle {
  readonly style: string;
  readonly Icon: IconComponent;
  readonly label: string;
}

const STYLES: Record<ClaudeTimelineEntryKind, KindStyle> = {
  "inbound-email": {
    style: "bg-sky-100 text-sky-700",
    Icon: MailIcon,
    label: "Email"
  },
  "outbound-email": {
    style: "bg-slate-900 text-white",
    Icon: MailIcon,
    label: "Email"
  },
  "inbound-sms": {
    style: "bg-violet-100 text-violet-700",
    Icon: PhoneIcon,
    label: "SMS"
  },
  "outbound-sms": {
    style: "bg-slate-900 text-white",
    Icon: PhoneIcon,
    label: "SMS"
  },
  "internal-note": {
    style: "bg-amber-100 text-amber-700",
    Icon: NoteIcon,
    label: "Note"
  },
  "campaign-event": {
    style: "bg-slate-100 text-slate-500",
    Icon: SparkleIcon,
    label: "Campaign"
  },
  "system-event": {
    style: "bg-slate-100 text-slate-500",
    Icon: SparkleIcon,
    label: "System"
  }
};
