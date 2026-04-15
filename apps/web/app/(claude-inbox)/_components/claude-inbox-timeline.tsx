"use client";

import { useState } from "react";

import type {
  ClaudeTimelineEntryKind,
  ClaudeTimelineEntryViewModel
} from "../_lib/view-models";
import {
  ChevronRightIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  SparkleIcon
} from "./claude-icons";

interface TimelineProps {
  readonly entries: readonly ClaudeTimelineEntryViewModel[];
}

/**
 * Client island: renders the conversation transcript for a single contact.
 *
 * Visual hierarchy, in order of importance:
 *   1. 1:1 emails and SMS render as chat bubbles, left-aligned for inbound
 *      ("them") and right-aligned for outbound ("you"). This is the primary
 *      reading surface and takes up the most room.
 *   2. Internal notes are a distinct amber card that is clearly not a
 *      customer-facing message.
 *   3. Automated and campaign sends (both email and SMS) render as a single
 *      collapsed row with an expand chevron — they carry system metadata
 *      rather than 1:1 context, so they sit out of the way until someone
 *      explicitly opens them.
 *   4. System events (milestones, routing notices) render as the tiniest
 *      inline marker.
 *
 * Owning expansion state in this client island keeps it local — nothing
 * about which auto/campaign entries are expanded is canonical state.
 */
export function ClaudeInboxTimeline({ entries }: TimelineProps) {
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
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => (
        <ClaudeTimelineEntry
          key={entry.id}
          entry={entry}
          isExpanded={expanded.has(entry.id)}
          onToggle={() => {
            toggle(entry.id);
          }}
        />
      ))}
    </ol>
  );
}

interface EntryProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

function ClaudeTimelineEntry({ entry, isExpanded, onToggle }: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
    case "outbound":
      return <ConversationBubble entry={entry} direction={role} />;
    case "note":
      return <InternalNoteCard entry={entry} />;
    case "automated":
    case "campaign":
      return (
        <CollapsedBulkEntry
          entry={entry}
          variant={role}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "system":
      return <SystemMarker entry={entry} />;
  }
}

// ---------- 1:1 chat bubble ----------

interface ConversationBubbleProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly direction: "inbound" | "outbound";
}

function ConversationBubble({ entry, direction }: ConversationBubbleProps) {
  const isOutbound = direction === "outbound";
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;

  const alignment = isOutbound ? "items-end" : "items-start";
  const bubble = isOutbound
    ? "bg-slate-900 text-white"
    : entry.isUnread
      ? "bg-white text-slate-900 ring-1 ring-sky-200 border-sky-200"
      : "bg-white text-slate-900 border-slate-200";

  const metaTextColor = isOutbound ? "text-slate-400" : "text-slate-500";
  const subjectTextColor = isOutbound ? "text-slate-100" : "text-slate-900";
  const bodyTextColor = isOutbound ? "text-slate-100/95" : "text-slate-700";

  return (
    <li className={`flex w-full flex-col ${alignment}`}>
      <div className={`mb-1 flex items-center gap-1.5 text-[11px] ${metaTextColor}`}>
        <ChannelIcon className="h-3 w-3" />
        <span>{isEmail ? "Email" : "SMS"}</span>
        <span className="text-slate-300">·</span>
        <span className="font-medium">{entry.actorLabel}</span>
      </div>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 shadow-sm ${bubble} ${
          isOutbound ? "border-slate-900 rounded-br-md" : "rounded-bl-md"
        }`}
      >
        {isEmail && entry.subject ? (
          <p
            className={`mb-1 text-[13px] font-semibold leading-snug ${subjectTextColor}`}
          >
            {entry.subject}
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap text-[13px] leading-6 ${bodyTextColor}`}
        >
          {entry.body}
        </p>
      </div>
      <div
        className={`mt-1 flex items-center gap-1.5 text-[11px] ${metaTextColor}`}
      >
        <span>{entry.occurredAtLabel}</span>
        {entry.isUnread && !isOutbound ? (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"
            aria-label="Unread"
          />
        ) : null}
      </div>
    </li>
  );
}

// ---------- Internal note ----------

function InternalNoteCard({
  entry
}: {
  readonly entry: ClaudeTimelineEntryViewModel;
}) {
  return (
    <li className="flex w-full justify-center">
      <div className="w-full max-w-xl rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
          <NoteIcon className="h-3.5 w-3.5" />
          <span>Internal note · {entry.actorLabel}</span>
          <span className="ml-auto font-normal normal-case text-amber-700">
            {entry.occurredAtLabel}
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-amber-900">
          {entry.body}
        </p>
      </div>
    </li>
  );
}

// ---------- Collapsed automated / campaign entry ----------

interface CollapsedBulkProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly variant: "automated" | "campaign";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

function CollapsedBulkEntry({
  entry,
  variant,
  isExpanded,
  onToggle
}: CollapsedBulkProps) {
  const isCampaign = variant === "campaign";
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;

  const badgeLabel = isCampaign
    ? isEmail
      ? "Campaign email"
      : "Campaign SMS"
    : "Automated email";

  const tagClass = isCampaign
    ? "bg-violet-50 text-violet-700 ring-violet-200"
    : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <li className="w-full">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition hover:bg-slate-100/70"
      >
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tagClass}`}
        >
          <ChannelIcon className="h-3 w-3" />
          {badgeLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700">
          {entry.subject ?? entry.body}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {entry.occurredAtLabel}
        </span>
        <ChevronRightIcon
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {isExpanded ? (
        <div className="mt-1 ml-3 border-l border-slate-200 pl-4 pr-2 py-2 text-[13px] leading-6 text-slate-600">
          <p className="whitespace-pre-wrap">{entry.body}</p>
        </div>
      ) : null}
    </li>
  );
}

// ---------- System marker ----------

function SystemMarker({
  entry
}: {
  readonly entry: ClaudeTimelineEntryViewModel;
}) {
  return (
    <li className="flex w-full items-center justify-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-500">
        <SparkleIcon className="h-3 w-3 text-slate-400" />
        <span>{entry.body}</span>
        <span className="text-slate-300">·</span>
        <span>{entry.occurredAtLabel}</span>
      </div>
    </li>
  );
}

// ---------- Kind → role mapping ----------

type EntryRole =
  | "inbound"
  | "outbound"
  | "note"
  | "automated"
  | "campaign"
  | "system";

function roleForKind(kind: ClaudeTimelineEntryKind): EntryRole {
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
