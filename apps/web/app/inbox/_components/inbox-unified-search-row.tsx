"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

import type { InboxUnifiedSearchRowViewModel } from "../_lib/view-models";
import { InboxAvatar } from "./inbox-avatar";
import { MailIcon, PhoneIcon } from "./icons";
import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";

/**
 * Single result row inside the unified search list. Two visual modes:
 *
 * - Default (Volunteers section): full-row format — avatar + name +
 *   time-ago + snippet + project chip. `hasProjection === true` rows show
 *   subject/snippet from the inbox projection; `hasProjection === false`
 *   rows fall back to email/phone with a muted "No conversation yet" line.
 * - Compact (Contacts section, `compact = true`): single-line format with
 *   no avatar, no time-ago, no snippet, no project chip. If `displayName`
 *   contains "@" we render just the email; otherwise we render
 *   "Name · email".
 *
 * Click target is `/inbox/[contactId]` regardless of mode, preserving
 * existing `q` / `filter` / `projectId` URL params so the search input
 * stays populated when navigating back.
 */
export function InboxUnifiedSearchRow({
  row,
  isActive,
  compact = false,
}: {
  readonly row: InboxUnifiedSearchRowViewModel;
  readonly isActive: boolean;
  readonly compact?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefetchedRef = useRef(false);

  const queryString = searchParams.toString();
  const href =
    queryString.length > 0
      ? `/inbox/${encodeURIComponent(row.contactId)}?${queryString}`
      : `/inbox/${encodeURIComponent(row.contactId)}`;

  const prefetchDetail = useCallback(() => {
    if (prefetchedRef.current) {
      return;
    }
    prefetchedRef.current = true;
    router.prefetch(href);
  }, [href, router]);

  const ChannelIcon = useMemo(() => {
    if (row.latestChannel === "email") return MailIcon;
    if (row.latestChannel === "sms") return PhoneIcon;
    return null;
  }, [row.latestChannel]);

  if (compact) {
    return (
      <CompactContactRow
        row={row}
        href={href}
        isActive={isActive}
        prefetchDetail={prefetchDetail}
      />
    );
  }

  const showSubject =
    row.hasProjection &&
    row.latestSubject !== null &&
    row.latestSubject.length > 0;

  const snippet = row.snippet ?? "";

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        data-inbox-row="true"
        data-inbox-search-row="true"
        data-contact-id={row.contactId}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onMouseEnter={prefetchDetail}
        onFocus={prefetchDetail}
        className={`relative flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
          isActive ? "bg-sky-50/50" : "hover:bg-slate-50"
        }`}
      >
        <InboxAvatar
          initials={row.initials}
          tone={row.avatarTone}
          size="xs"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[13px] font-semibold text-slate-900">
              {row.displayName}
            </p>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
              {row.lastActivityLabel}
            </span>
          </div>

          {row.hasProjection ? (
            <>
              {showSubject ? (
                <div className="mt-0.5 flex items-center gap-1 text-[12px]">
                  {ChannelIcon ? (
                    <ChannelIcon
                      className="size-3 shrink-0 text-slate-400"
                      aria-label={
                        row.latestChannel === "email" ? "Email" : "SMS"
                      }
                    />
                  ) : null}
                  <p className="truncate text-slate-700">{row.latestSubject}</p>
                </div>
              ) : null}
              {snippet.length > 0 ? (
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {snippet}
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              {row.primaryEmail !== null && row.primaryEmail.length > 0 ? (
                <span className="inline-flex max-w-full items-center gap-1 truncate">
                  <MailIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-slate-400"
                  />
                  <span className="truncate">{row.primaryEmail}</span>
                </span>
              ) : null}
              {row.primaryPhone !== null && row.primaryPhone.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <PhoneIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-slate-400"
                  />
                  <span>{row.primaryPhone}</span>
                </span>
              ) : null}
              {(row.primaryEmail === null || row.primaryEmail.length === 0) &&
              (row.primaryPhone === null || row.primaryPhone.length === 0) ? (
                <span className="italic text-slate-400">
                  No contact info
                </span>
              ) : null}
              <span className="italic text-slate-400">
                No conversation yet
              </span>
            </div>
          )}

          {row.projectLabel !== null ? (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {row.projectLabel}
              </span>
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/**
 * Compact single-line row for the Contacts section. Visually lightest row
 * format we render: no avatar, no time-ago, no snippet, no project chip.
 * Email-only contacts (the dominant case — ~3,304 of ~3,467) collapse to
 * just the email; SF-anchored named contacts render `Name · email`.
 */
function CompactContactRow({
  row,
  href,
  isActive,
  prefetchDetail,
}: {
  readonly row: InboxUnifiedSearchRowViewModel;
  readonly href: string;
  readonly isActive: boolean;
  readonly prefetchDetail: () => void;
}) {
  const isDisplayNameAnEmail = row.displayName.includes("@");
  const hasSecondaryEmail =
    !isDisplayNameAnEmail &&
    row.primaryEmail !== null &&
    row.primaryEmail.length > 0;

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        data-inbox-row="true"
        data-inbox-search-row="true"
        data-inbox-search-row-compact="true"
        data-contact-id={row.contactId}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onMouseEnter={prefetchDetail}
        onFocus={prefetchDetail}
        className={`flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2 text-left text-[12px] ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
          isActive ? "bg-sky-50/50" : "hover:bg-slate-50"
        }`}
      >
        {isDisplayNameAnEmail ? (
          <span className="truncate text-slate-700">{row.displayName}</span>
        ) : (
          <span className="truncate">
            <span className="font-semibold text-slate-900">
              {row.displayName}
            </span>
            {hasSecondaryEmail ? (
              <span className="text-slate-400"> · {row.primaryEmail}</span>
            ) : null}
          </span>
        )}
      </Link>
    </li>
  );
}
