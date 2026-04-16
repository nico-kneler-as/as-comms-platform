"use client";

import Link from "next/link";

import type { InboxListItemViewModel } from "../_lib/view-models";
import { InboxAvatar } from "./inbox-avatar";
import { MailIcon, PhoneIcon } from "./icons";
import { FOCUS_RING, SPACING, TEXT, TRANSITION } from "@/app/_lib/design-tokens";

interface RowProps {
  readonly item: InboxListItemViewModel;
  readonly isActive: boolean;
}

/**
 * List row for a contact. The left accent bar is sky when the row has
 * bucket === "new" and rose when needsFollowUp is set. If both apply,
 * sky wins. Stacking badges after the project label show follow-up
 * (rose) and review/unresolved (amber) state at a glance.
 */
export function InboxRow({ item, isActive }: RowProps) {
  const isUnread = item.unreadCount > 0;
  const ChannelIcon = item.latestChannel === "email" ? MailIcon : PhoneIcon;

  const accentClass =
    item.bucket === "new"
      ? "bg-sky-500"
      : item.needsFollowUp
        ? "bg-rose-500"
        : null;

  const showBadges =
    item.projectLabel ||
    item.needsFollowUp ||
    item.hasUnresolved ||
    item.unreadCount > 0;

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

        <InboxAvatar
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

          {showBadges ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              {item.projectLabel ? (
                <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {item.projectLabel}
                </span>
              ) : null}
              {item.needsFollowUp ? (
                <span className="inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  Follow-up
                </span>
              ) : null}
              {item.hasUnresolved ? (
                <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  Review
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
