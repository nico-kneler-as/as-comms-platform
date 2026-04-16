"use client";

import Link from "next/link";

import type { ClaudeInboxListItemViewModel } from "../_lib/view-models";
import { ClaudeInboxAvatar } from "./claude-inbox-avatar";
import { useClaudeInboxClient } from "./claude-inbox-client-provider";
import { MailIcon, PhoneIcon } from "./claude-icons";
import { FOCUS_RING, SPACING, TEXT, TRANSITION } from "@/app/_lib/design-tokens";

interface RowProps {
  readonly item: ClaudeInboxListItemViewModel;
  readonly isActive: boolean;
}

/**
 * List row for a contact. Stripped of starred / unresolved / stage badges
 * — those are no longer part of the inbox surface. The left accent bar is
 * sky when the row is unread and rose when the operator has flagged the
 * contact for follow-up. The channel icon (mail/phone) is always preserved
 * in the leading slot so operators keep their at-a-glance channel cue even
 * on the rows most likely to need triaging.
 */
export function ClaudeInboxRow({ item, isActive }: RowProps) {
  const { followUp } = useClaudeInboxClient();
  const isFollowUp = followUp.has(item.contactId);
  const isUnread = item.unreadCount > 0;
  const ChannelIcon = item.latestChannel === "email" ? MailIcon : PhoneIcon;

  const accentClass = isFollowUp
    ? "bg-rose-500"
    : isUnread
      ? "bg-sky-500"
      : null;

  return (
    <li>
      <Link
        href={`/inbox/${item.contactId}`}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex gap-3 border-b border-slate-100 ${SPACING.listItem} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
          isActive
            ? "bg-sky-50/60 ring-1 ring-inset ring-sky-200"
            : "hover:bg-slate-50/80"
        }`}
      >
        {accentClass ? (
          <span
            aria-hidden="true"
            className={`absolute left-0 top-0 h-full w-1 ${accentClass}`}
          />
        ) : null}

        <ClaudeInboxAvatar
          initials={item.initials}
          tone={item.avatarTone}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`truncate text-sm ${
                isUnread ? "font-semibold text-slate-900" : "text-slate-800"
              }`}
            >
              {item.displayName}
            </p>
            <span
              className={`shrink-0 text-[11px] tabular-nums ${
                isUnread ? "font-semibold text-sky-700" : "text-slate-500"
              }`}
            >
              {item.lastActivityLabel}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5">
            <ChannelIcon
              className={`h-3 w-3 shrink-0 ${
                isUnread ? "text-sky-600" : "text-slate-400"
              }`}
              aria-label={
                item.latestChannel === "email" ? "Email" : "SMS"
              }
            />
            <p
              className={`truncate text-[13px] ${
                isUnread ? "font-medium text-slate-800" : "text-slate-600"
              }`}
            >
              {item.latestSubject}
            </p>
          </div>

          <p className={`mt-0.5 line-clamp-1 ${TEXT.caption}`}>
            {item.snippet}
          </p>

          {item.projectLabel || item.unreadCount > 0 ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              {item.projectLabel ? (
                <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {item.projectLabel}
                </span>
              ) : null}
              {item.unreadCount > 0 ? (
                <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-semibold text-white tabular-nums">
                  {item.unreadCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
