"use client";

import { useState } from "react";

import type {
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel
} from "../_lib/view-models";
import {
  ChevronRightIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon
} from "./icons";
import { DividerLabel } from "@/components/ui/divider-label";
import { RADIUS, SHADOW, TEXT, TONE, TRANSITION } from "@/app/_lib/design-tokens";

interface TimelineProps {
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly volunteerFirstName: string;
}

export function InboxTimeline({
  entries,
  volunteerFirstName
}: TimelineProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        No history yet for this person.
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <TimelineEntry
          key={entry.id}
          entry={entry}
          volunteerFirstName={volunteerFirstName}
          isExpanded={expanded.has(entry.id)}
          onToggle={() => {
            toggle(entry.id);
          }}
        />
      ))}
    </ol>
  );
}

// ---------- Entry router ----------

interface EntryProps {
  readonly entry: InboxTimelineEntryViewModel;
  readonly volunteerFirstName: string;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

function TimelineEntry({
  entry,
  volunteerFirstName,
  isExpanded,
  onToggle
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
      return <InboundBubble entry={entry} />;
    case "outbound":
      return <OutboundBubble entry={entry} />;
    case "automated":
    case "campaign":
      return (
        <AutomatedRow
          entry={entry}
          role={role}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "note":
      return <NoteEntry entry={entry} />;
    case "system":
      return (
        <SystemDivider
          entry={entry}
          volunteerFirstName={volunteerFirstName}
        />
      );
  }
}

// ---------- Inbound bubble (them, left) ----------

function InboundBubble({
  entry
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;

  return (
    <li className="flex w-full flex-col items-start">
      <div className={`max-w-2xl ${RADIUS.bubble} rounded-bl-sm border border-slate-200 bg-white px-4 py-3 ${SHADOW.sm}`}>
        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-[13px] font-semibold leading-snug text-slate-900">
            {entry.subject}
          </p>
        ) : null}
        <p className={`whitespace-pre-wrap ${TEXT.bodySm}`}>
          {entry.body}
        </p>
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <ChannelIcon className="h-3 w-3" />
        <span className="font-medium text-slate-500">
          {entry.actorLabel}
        </span>
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

// ---------- Outbound bubble (you, right) — dark ----------

function OutboundBubble({
  entry
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;

  return (
    <li className="flex w-full flex-col items-end">
      <div className={`max-w-2xl ${RADIUS.bubble} rounded-br-sm bg-slate-800 px-4 py-3 ${SHADOW.sm}`}>
        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-[13px] font-semibold leading-snug text-slate-100">
            {entry.subject}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">
          {entry.body}
        </p>
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <span>{entry.occurredAtLabel}</span>
        <span>·</span>
        <ChannelIcon className="h-3 w-3" />
      </div>
    </li>
  );
}

// ---------- Automated / campaign — inline row, not a bubble ----------

function AutomatedRow({
  entry,
  role,
  isExpanded,
  onToggle
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly role: "automated" | "campaign";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const isEmail = entry.channel === "email";
  const label =
    role === "automated"
      ? isEmail
        ? "Automated Email"
        : "Automated SMS"
      : isEmail
        ? "Campaign Email"
        : "Campaign SMS";
  const headline = entry.subject ?? "(no subject)";

  return (
    <li className="flex w-full flex-col items-end">
      <span className={`mb-1 px-1 ${TEXT.micro}`}>
        {label}
      </span>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={`group flex w-full max-w-2xl items-center gap-3 ${RADIUS.md} border border-dashed border-slate-300 bg-white px-4 py-2.5 text-left ${TRANSITION.fast} hover:bg-slate-50`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-slate-700">
            {headline}
          </p>
          {isExpanded ? (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
              {entry.body}
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

// ---------- Internal note — left-border accent ----------

function NoteEntry({
  entry
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  return (
    <li className="flex w-full flex-col items-end">
      <div className={`max-w-2xl ${RADIUS.md} border-l-2 border-amber-400 ${TONE.amber.subtle} px-4 py-2.5`}>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-amber-700">
          <NoteIcon className="h-3 w-3" />
          <span className="font-medium">Note</span>
          <span className="text-amber-300">·</span>
          <span>{entry.actorLabel}</span>
          <span className="text-amber-300">·</span>
          <span>{entry.occurredAtLabel}</span>
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-amber-900">
          {entry.body}
        </p>
      </div>
    </li>
  );
}

// ---------- System event — centered divider ----------

function SystemDivider({
  entry,
  volunteerFirstName
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

// ---------- Helpers ----------

function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) return firstName;
  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
}

type EntryRole =
  | "inbound"
  | "outbound"
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
    case "outbound-auto-email":
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
