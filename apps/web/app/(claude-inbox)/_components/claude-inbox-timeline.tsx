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
  readonly volunteerFirstName: string;
}

/**
 * Client island: renders the conversation transcript for a single contact.
 *
 * Visual hierarchy, in order of importance:
 *   1. 1:1 emails and SMS render as chat bubbles, left-aligned for inbound
 *      ("them") and right-aligned for outbound ("you"). Automated emails
 *      render in the same bubble style as outbound — same sky tint, same
 *      alignment — and only the caption above swaps "Email" for "Automated
 *      email" to flag them as system-generated.
 *   2. Internal notes are a distinct amber card, right-aligned so they sit
 *      next to the things the operator sent.
 *   3. Campaign sends (email or SMS) render as a single collapsed row with
 *      an expand chevron — they're never 1:1 context so they sit out of the
 *      way until someone explicitly opens them.
 *   4. System events (milestones, routing notices) render as the tiniest
 *      inline marker, left-aligned and prefixed with the volunteer's first
 *      name so the row reads as a natural sentence.
 */
export function ClaudeInboxTimeline({
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
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => (
        <ClaudeTimelineEntry
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

interface EntryProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly volunteerFirstName: string;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

function ClaudeTimelineEntry({
  entry,
  volunteerFirstName,
  isExpanded,
  onToggle
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
    case "outbound":
    case "automated":
      return <ConversationBubble entry={entry} role={role} />;
    case "note":
      return <InternalNoteCard entry={entry} />;
    case "campaign":
      return (
        <CollapsedCampaignEntry
          entry={entry}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "system":
      return (
        <SystemMarker entry={entry} volunteerFirstName={volunteerFirstName} />
      );
  }
}

// ---------- 1:1 chat bubble ----------

interface ConversationBubbleProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly role: "inbound" | "outbound" | "automated";
}

function ConversationBubble({ entry, role }: ConversationBubbleProps) {
  const isOperatorSide = role === "outbound" || role === "automated";
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const captionLabel =
    role === "automated" ? "Automated email" : isEmail ? "Email" : "SMS";

  // Both sides keep a mostly white background so the left/right alignment
  // is the primary direction cue. Operator-side bubbles (outbound + auto)
  // pick up a subtle sky tint; inbound stays white so a quick scan still
  // separates the two sides.
  const alignment = isOperatorSide ? "items-end" : "items-start";
  const bubble = isOperatorSide
    ? "bg-sky-50 border-sky-200"
    : entry.isUnread
      ? "bg-white border-sky-200 ring-1 ring-sky-100"
      : "bg-white border-slate-200";

  return (
    <li className={`flex w-full flex-col ${alignment}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ChannelIcon className="h-3 w-3" />
        <span>{captionLabel}</span>
        <span className="text-slate-300">·</span>
        <span className="font-medium">{entry.actorLabel}</span>
      </div>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 shadow-sm ${bubble} ${
          isOperatorSide ? "rounded-br-md" : "rounded-bl-md"
        }`}
      >
        {isEmail && entry.subject ? (
          <p className="mb-1 text-[13px] font-semibold leading-snug text-slate-900">
            {entry.subject}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
          {entry.body}
        </p>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <span>{entry.occurredAtLabel}</span>
        {entry.isUnread && !isOperatorSide ? (
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
    <li className="flex w-full flex-col items-end">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-amber-700">
        <NoteIcon className="h-3 w-3" />
        <span>Internal note</span>
        <span className="text-amber-300">·</span>
        <span className="font-medium">{entry.actorLabel}</span>
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-amber-200 bg-amber-50/70 px-4 py-3 shadow-sm">
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-amber-900">
          {entry.body}
        </p>
      </div>
      <div className="mt-1 text-[11px] text-amber-700">
        {entry.occurredAtLabel}
      </div>
    </li>
  );
}

// ---------- Collapsed campaign entry ----------

interface CollapsedCampaignProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

function CollapsedCampaignEntry({
  entry,
  isExpanded,
  onToggle
}: CollapsedCampaignProps) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const badgeLabel = isEmail ? "Campaign email" : "Campaign SMS";

  return (
    <li className="flex w-full flex-col items-end">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="flex w-[85%] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-100/70"
      >
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-200">
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
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {isExpanded ? (
        <div className="mt-1 w-[85%] border-l-2 border-slate-200 py-2 pl-4 pr-2 text-[13px] leading-6 text-slate-600">
          <p className="whitespace-pre-wrap">{entry.body}</p>
        </div>
      ) : null}
    </li>
  );
}

// ---------- System marker ----------

function SystemMarker({
  entry,
  volunteerFirstName
}: {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly volunteerFirstName: string;
}) {
  return (
    <li className="flex w-full items-center justify-start">
      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-500">
        <SparkleIcon className="h-3 w-3 text-slate-400" />
        <span>{personalizeSystemBody(entry.body, volunteerFirstName)}</span>
        <span className="text-slate-300">·</span>
        <span>{entry.occurredAtLabel}</span>
      </div>
    </li>
  );
}

/**
 * System event bodies are stored as "Signed up for Wolverine Watch 2025".
 * At render time we prefix the volunteer's first name and lowercase the
 * leading verb so the result reads as a natural sentence:
 * "Maya signed up for Wolverine Watch 2025".
 */
function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) return firstName;
  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
}

// ---------- Kind → role mapping ----------

type EntryRole =
  | "inbound"
  | "outbound"
  | "automated"
  | "campaign"
  | "note"
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
