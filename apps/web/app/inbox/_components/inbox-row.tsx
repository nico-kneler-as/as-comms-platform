"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import type { InboxListItemViewModel } from "../_lib/view-models";
import { InboxAvatar } from "./inbox-avatar";
import { FlagIcon, MailIcon, PhoneIcon } from "./icons";
import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";

interface RowProps {
  readonly item: InboxListItemViewModel;
  readonly isActive: boolean;
}

/**
 * List row for a contact. The left accent bar is sky when the row has
 * bucket === "new" and rose when needsFollowUp is set. If both apply,
 * both colors remain visible via stacked segments.
 */
export function InboxRow({ item, isActive }: RowProps) {
  const router = useRouter();
  const prefetchedRef = useRef(false);
  const isUnread = item.isUnread;
  const ChannelIcon = item.latestChannel === "email" ? MailIcon : PhoneIcon;
  const href = `/inbox/${encodeURIComponent(item.contactId)}`;

  const showBadges = Boolean(item.projectLabel) || item.needsFollowUp;

  const prefetchDetail = useCallback(() => {
    if (prefetchedRef.current) {
      return;
    }

    prefetchedRef.current = true;
    router.prefetch(href);
  }, [href, router]);

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        data-inbox-row="true"
        data-contact-id={item.contactId}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        aria-keyshortcuts="Enter"
        onMouseEnter={prefetchDetail}
        onFocus={prefetchDetail}
        className={`relative flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
          isActive
            ? "bg-sky-50/50"
            : item.needsFollowUp
              ? "hover:bg-rose-50/40"
              : "hover:bg-slate-50"
        }`}
      >
        <AccentBar unread={isUnread} needsFollowUp={item.needsFollowUp} />

        <InboxAvatar
          initials={item.initials}
          tone={item.avatarTone}
          size="xs"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[13px] font-semibold text-slate-900">
              {item.displayName}
            </p>
            <span
              className={`shrink-0 text-[11px] tabular-nums ${
                isUnread ? "font-medium text-sky-600" : "text-slate-400"
              }`}
            >
              {item.lastActivityLabel}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1 text-[12px]">
            <ChannelIcon
              className={`h-3 w-3 shrink-0 ${
                isUnread ? "text-sky-600" : "text-slate-400"
              }`}
              aria-label={
                item.latestChannel === "email" ? "Email" : "SMS"
              }
            />
            <p
              className={`truncate ${
                isUnread ? "font-medium text-slate-800" : "text-slate-700"
              }`}
            >
              {item.latestSubject}
            </p>
          </div>

          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {item.snippet}
          </p>

          {showBadges ? (
            <div className="mt-2 flex items-center gap-1.5">
              {item.projectLabel ? (
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {item.projectLabel}
                </span>
              ) : null}
              {item.needsFollowUp ? (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">
                  <FlagIcon className="h-2.5 w-2.5" />
                  Follow-up
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/**
 * Left accent bar. Renders both flags as stacked segments when a contact is
 * both unread and flagged for follow-up, so neither signal is hidden by the
 * other. When only one applies, the active color fills the full height —
 * visually identical to the previous single-color bar.
 */
function AccentBar({
  unread,
  needsFollowUp
}: {
  readonly unread: boolean;
  readonly needsFollowUp: boolean;
}) {
  if (!unread && !needsFollowUp) {
    return null;
  }

  if (unread && needsFollowUp) {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 flex h-full w-0.5 flex-col"
      >
        <span className="h-1/2 w-full bg-sky-500" />
        <span className="h-1/2 w-full bg-rose-500" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 h-full w-0.5 ${
        unread ? "bg-sky-500" : "bg-rose-500"
      }`}
    />
  );
}
