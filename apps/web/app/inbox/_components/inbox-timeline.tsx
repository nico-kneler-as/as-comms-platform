"use client";

import { useState } from "react";

import type {
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import { ChevronRightIcon, MailIcon, NoteIcon, PhoneIcon } from "./icons";
import { DividerLabel } from "@/components/ui/divider-label";
import { cn } from "@/lib/utils";
import {
  RADIUS,
  SHADOW,
  TEXT,
  TONE,
  TRANSITION,
} from "@/app/_lib/design-tokens";

interface TimelineProps {
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly volunteerFirstName: string;
  readonly hasMore?: boolean;
  readonly isLoadingOlder?: boolean;
  readonly onLoadOlder?: () => void;
}

export function InboxTimeline({
  entries,
  volunteerFirstName,
  hasMore = false,
  isLoadingOlder = false,
  onLoadOlder,
}: TimelineProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

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
    </div>
  );
}

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
  onToggle,
}: EntryProps) {
  const role = roleForKind(entry.kind);

  switch (role) {
    case "inbound":
      return <InboundBubble entry={entry} />;
    case "outbound":
      return <OutboundBubble entry={entry} />;
    case "automated":
    case "campaign":
    case "activity":
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
        <SystemDivider entry={entry} volunteerFirstName={volunteerFirstName} />
      );
  }
}

function InboundBubble({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const body = bodyTextForEntry(entry);

  return (
    <li className="flex w-full flex-col items-start">
      <div
        className={`w-full max-w-2xl ${RADIUS.bubble} rounded-bl-sm border border-slate-200 bg-white px-4 py-3 ${SHADOW.sm}`}
      >
        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-900">
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p className={`whitespace-pre-wrap text-pretty ${TEXT.bodySm}`}>
            {autolinkText(body, "text-sky-600")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <ChannelIcon className="h-3 w-3" />
        <span className="font-medium text-slate-500">{entry.actorLabel}</span>
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

function OutboundBubble({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const isEmail = entry.channel === "email";
  const ChannelIcon = isEmail ? MailIcon : PhoneIcon;
  const body = bodyTextForEntry(entry);

  return (
    <li className="flex w-full flex-col items-end">
      <div
        className={`w-full max-w-2xl ${RADIUS.bubble} rounded-br-sm bg-slate-800 px-4 py-3 ${SHADOW.sm}`}
      >
        {isEmail && entry.subject ? (
          <p className="mb-1.5 text-balance text-[13px] font-semibold leading-snug text-slate-100">
            {entry.subject}
          </p>
        ) : null}
        {body.length > 0 ? (
          <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-slate-200">
            {autolinkText(body, "text-sky-300")}
          </p>
        ) : null}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 px-1 ${TEXT.micro}`}>
        <span>{entry.occurredAtLabel}</span>
        <span>·</span>
        <ChannelIcon className="h-3 w-3" />
      </div>
    </li>
  );
}

function AutomatedRow({
  entry,
  role,
  isExpanded,
  onToggle,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly role: "automated" | "campaign" | "activity";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const isEmail = entry.channel === "email";
  const label =
    role === "activity"
      ? isEmail
        ? "Email Activity"
        : "SMS Activity"
      : role === "automated"
        ? isEmail
          ? "Automated Email"
          : "Automated SMS"
        : isEmail
          ? "Campaign Email"
          : "Campaign SMS";
  const headline = entry.subject;
  const body = bodyTextForEntry(entry);
  const hideCollapsedBody = shouldHideAutomatedRowBody({
    isExpanded,
    kind: entry.kind,
    headline,
  });

  return (
    <li className="flex w-full flex-col items-end">
      <div className="mb-1 flex w-full max-w-2xl items-center justify-between px-1">
        <span className={TEXT.micro}>{label}</span>
      </div>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={cn(
          `group flex w-full max-w-2xl items-center gap-3 ${RADIUS.md} border border-dashed border-slate-300 bg-white px-4 py-2.5 text-left`,
          "transition-[color,background-color,transform] duration-150 ease-out",
          "active:scale-[0.96]",
          TRANSITION.reduceMotion,
          "hover:bg-slate-50",
        )}
      >
        <div className="min-w-0 flex-1">
          {headline ? (
            <p className="text-pretty text-[13px] font-medium leading-snug text-slate-700">
              {headline}
            </p>
          ) : null}
          {!hideCollapsedBody && body.length > 0 ? (
            <p
              className={cn(
                "text-[13px] leading-relaxed text-slate-600",
                headline && "mt-1.5",
                isExpanded ? "whitespace-pre-wrap text-pretty" : "line-clamp-1",
              )}
            >
              {isExpanded ? autolinkText(body, "text-sky-600") : body}
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

export function shouldHideAutomatedRowBody(input: {
  readonly isExpanded: boolean;
  readonly kind: InboxTimelineEntryKind;
  readonly headline: string | null;
}): boolean {
  return (
    !input.isExpanded &&
    input.kind === "outbound-auto-email" &&
    input.headline !== null
  );
}

function NoteEntry({ entry }: { readonly entry: InboxTimelineEntryViewModel }) {
  return (
    <li className="flex w-full flex-col items-end">
      <div
        className={`w-full max-w-2xl ${RADIUS.md} border-l-2 border-amber-400 ${TONE.amber.subtle} px-4 py-2.5`}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-amber-700">
          <NoteIcon className="h-3 w-3" />
          <span className="font-medium">Note</span>
          <span className="text-amber-300">·</span>
          <span>{entry.actorLabel}</span>
          <span className="text-amber-300">·</span>
          <span>{entry.occurredAtLabel}</span>
        </div>
        <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-amber-900">
          {entry.body}
        </p>
      </div>
    </li>
  );
}

function SystemDivider({
  entry,
  volunteerFirstName,
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

function bodyTextForEntry(entry: InboxTimelineEntryViewModel): string {
  return entry.body.trim();
}

function personalizeSystemBody(body: string, firstName: string): string {
  if (body.length === 0) return firstName;
  const head = body.charAt(0).toLowerCase();
  const tail = body.slice(1);
  return `${firstName} ${head}${tail}`;
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
