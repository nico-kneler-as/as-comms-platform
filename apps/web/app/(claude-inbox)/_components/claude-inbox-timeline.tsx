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
 *      ("them") and right-aligned for outbound ("you"). The body is always
 *      visible because every word of a 1:1 exchange matters.
 *   2. Automated emails and campaign sends (email or SMS) all share the
 *      same outbound-style bubble — same sky tint, same right-alignment —
 *      and differ only in the caption label above ("Automated email" /
 *      "Campaign email" / "Campaign SMS"). Their body is collapsed behind
 *      the subject/campaign title because the content is rarely the thing
 *      the operator needs to read; clicking the bubble reveals the body.
 *   3. Internal notes are a distinct amber card, right-aligned so they sit
 *      next to the things the operator sent.
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
      return <ConversationBubble entry={entry} role={role} />;
    case "automated":
    case "campaign":
      return (
        <CollapsibleOutboundBubble
          entry={entry}
          role={role}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case "note":
      return <InternalNoteCard entry={entry} />;
    case "system":
      return (
        <SystemMarker entry={entry} volunteerFirstName={volunteerFirstName} />
      );
  }
}

// ---------- 1:1 chat bubble ----------

interface ConversationBubbleProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly role: "inbound" | "outbound";
}

function ConversationBubble({ entry, role }: ConversationBubbleProps) {
  const isOutbound = role === "outbound";
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;

  // Both sides keep a mostly white background so the left/right alignment
  // is the primary direction cue. Outbound bubbles pick up a subtle sky
  // tint; inbound stays white so a quick scan still separates the two
  // sides.
  const alignment = isOutbound ? "items-end" : "items-start";
  const bubble = isOutbound
    ? "bg-sky-50 border-sky-200"
    : entry.isUnread
      ? "bg-white border-sky-200 ring-1 ring-sky-100"
      : "bg-white border-slate-200";

  return (
    <li className={`flex w-full flex-col ${alignment}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ChannelIcon className="h-3 w-3" />
        <span>{isEmail ? "Email" : "SMS"}</span>
        <span className="text-slate-300">·</span>
        <span className="font-medium">{entry.actorLabel}</span>
      </div>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 shadow-sm ${bubble} ${
          isOutbound ? "rounded-br-md" : "rounded-bl-md"
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

// ---------- Collapsible outbound bubble (automated + campaign) ----------

interface CollapsibleOutboundBubbleProps {
  readonly entry: ClaudeTimelineEntryViewModel;
  readonly role: "automated" | "campaign";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

/**
 * Automated and campaign messages look identical to an outbound 1:1 bubble
 * on the right side, except the body is hidden behind the subject line by
 * default. Operators rarely need to re-read marketing copy or auto-reply
 * text while triaging 1:1 context — the subject is enough to tell them
 * what it was — so the body is a single click away without ever clogging
 * the transcript.
 */
function CollapsibleOutboundBubble({
  entry,
  role,
  isExpanded,
  onToggle
}: CollapsibleOutboundBubbleProps) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const captionLabel =
    role === "automated"
      ? "Automated email"
      : isEmail
        ? "Campaign email"
        : "Campaign SMS";

  // `subject` holds either the email subject or the campaign title, per
  // fixture contract. For the rare case where a fixture omits it, fall
  // back to a neutral placeholder so the bubble still has something to
  // click on — we never want to leak the body into the collapsed state.
  const headline = entry.subject ?? "(no subject)";

  return (
    <li className="flex w-full flex-col items-end">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ChannelIcon className="h-3 w-3" />
        <span>{captionLabel}</span>
        <span className="text-slate-300">·</span>
        <span className="font-medium">{entry.actorLabel}</span>
      </div>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="group max-w-[85%] rounded-2xl rounded-br-md border border-sky-200 bg-sky-50 px-4 py-3 text-left shadow-sm transition-colors duration-150 hover:bg-sky-100/70"
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[13px] font-semibold leading-snug text-slate-900">
            {headline}
          </p>
          <ChevronRightIcon
            className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </div>
        {isExpanded ? (
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
            {entry.body}
          </p>
        ) : null}
      </button>
      <div className="mt-1 text-[11px] text-slate-500">
        {entry.occurredAtLabel}
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
