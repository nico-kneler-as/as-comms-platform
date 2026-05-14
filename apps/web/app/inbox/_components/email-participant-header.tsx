"use client";

import { useId, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";

import type {
  InboxTimelineEntryParticipantRowViewModel,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import { ArrowRightIcon, ChevronDownIcon, MailIcon } from "./icons";

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";
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

/**
 * Pick the compact-row label for the `<sender> → <recipient>` summary
 * line. Falls through `name` → `email` so we never blank a half. The
 * server-side resolver in `selectors.ts` already nulls `name` out when
 * we'd otherwise render `email <email>`.
 */
function compactLabel(
  row: InboxTimelineEntryParticipantRowViewModel | undefined,
): string {
  if (row === undefined) {
    return "";
  }
  if (row.name !== null && row.name.length > 0) {
    return row.name;
  }
  if (row.email !== null && row.email.length > 0) {
    return row.email;
  }
  return "";
}

const HEADER_EMAIL_PATTERN = /<\s*([^>\s]+@[^>\s]+)\s*>/u;
const PLAIN_EMAIL_PATTERN = /^[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+$/u;

function extractDisplayNameRaw(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const stripped = trimmed.replace(/\s*<[^>]+>\s*/g, "").trim();
  if (stripped.length === 0) {
    return null;
  }
  if (PLAIN_EMAIL_PATTERN.test(stripped)) {
    return null;
  }
  return stripped.replace(/^["']|["']$/g, "").trim() || null;
}

function extractEmailFromHeader(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const angle = HEADER_EMAIL_PATTERN.exec(trimmed)?.[1];
  if (angle !== undefined && angle.length > 0) {
    return angle;
  }
  if (PLAIN_EMAIL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * When the view-model didn't supply pre-resolved `participantRows`
 * (e.g. test fixtures, hand-rolled entries, or in-flight optimistic
 * outbound entries before the selector has touched them), build the
 * minimum viable rows from the raw header fields so the bubble still
 * renders something. This is a defense-in-depth fallback — production
 * entries always come with `participantRows` populated.
 */
function deriveParticipantRowsFromRawHeaders(
  entry: InboxTimelineEntryViewModel,
): readonly InboxTimelineEntryParticipantRowViewModel[] {
  const rows: InboxTimelineEntryParticipantRowViewModel[] = [];

  const fromName = extractDisplayNameRaw(entry.fromHeader) ?? entry.actorLabel;
  rows.push({
    label: "From",
    name: fromName.length > 0 ? fromName : null,
    email: extractEmailFromHeader(entry.fromHeader),
  });

  const toName =
    entry.recipientLabel ??
    extractDisplayNameRaw(entry.toHeader) ??
    entry.headerProjectLabel ??
    (entry.kind === "inbound-email" ? "Adventure Scientists" : null);
  rows.push({
    label: "To",
    name: toName !== null && toName.length > 0 ? toName : null,
    email:
      extractEmailFromHeader(entry.toHeader) ?? entry.mailbox ?? null,
  });

  if (entry.ccHeader !== null && entry.ccHeader.trim().length > 0) {
    rows.push({
      label: "Cc",
      name: entry.ccHeader.trim(),
      email: null,
    });
  }

  return rows;
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
  /**
   * Tone drives the border / Cc-pill background colors. Direction is
   * NOT passed any more — the server-side `participantRows` already
   * bake direction into the From/To resolution, so the component just
   * renders `[0].name → [1].name`.
   */
  readonly tone?: "slate" | "sky";
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  if (entry.channel !== "email") {
    return null;
  }

  const rows =
    entry.participantRows !== undefined && entry.participantRows.length > 0
      ? entry.participantRows
      : deriveParticipantRowsFromRawHeaders(entry);
  const fromRow = rows[0];
  const toRow = rows[1];
  const sender = compactLabel(fromRow);
  const recipient = compactLabel(toRow);
  const hasCc = rows.some((row) => row.label === "Cc");

  const headerBorderClass =
    tone === "sky" ? "border-sky-100/60" : "border-slate-100";
  const detailBorderClass =
    tone === "sky"
      ? "border-sky-100/60 bg-sky-50/40"
      : "border-slate-100 bg-slate-50/40";
  const ccClass =
    tone === "sky"
      ? "bg-sky-100/70 text-sky-700"
      : "bg-slate-100 text-slate-500";

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
            aria-label={
              expanded ? "Hide full email headers" : "Show full email headers"
            }
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]",
              FOCUS_RING,
              TRANSITION.fast,
              TRANSITION.reduceMotion,
            )}
          >
            <MailIcon className="size-3 shrink-0 text-slate-400" />
            <span className="min-w-0 truncate font-medium text-slate-800">
              {sender}
            </span>
            <ArrowRightIcon className="size-3 shrink-0 text-slate-400" />
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
                "size-3 shrink-0 text-slate-400 transition-transform duration-150",
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
        <dl className="space-y-0.5 text-[11.5px] leading-relaxed text-slate-600">
          {rows.map((row) => (
            <ParticipantRowDetail key={row.label} row={row} />
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Expanded debug-row renderer. Format: `<name> <email>`. When `name`
 * is null or equals the email, render only `<email>`. When `email` is
 * null, render only the `name`. Cc rows currently arrive as a single
 * verbatim header string in `name` with `email = null` — per-address
 * parsing is a follow-up.
 */
function ParticipantRowDetail({
  row,
}: {
  readonly row: InboxTimelineEntryParticipantRowViewModel;
}) {
  const name = row.name?.trim() ?? "";
  const email = row.email?.trim() ?? "";
  const showName = name.length > 0 && name !== email;
  const showEmail = email.length > 0;

  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-slate-400">{row.label}</dt>
      <dd className={cn("min-w-0 text-slate-700", WRAP_ANYWHERE)}>
        {showName ? <span>{name}</span> : null}
        {showEmail ? (
          <>
            {showName ? " " : null}
            <span className="text-slate-400">{`<${email}>`}</span>
          </>
        ) : null}
        {!showName && !showEmail ? (
          <span className="text-slate-400">—</span>
        ) : null}
      </dd>
    </div>
  );
}
