"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useMemo, useRef } from "react";

import type { InboxUnifiedSearchRowViewModel } from "../_lib/view-models";
import { InboxAvatar } from "./inbox-avatar";
import { MailIcon, PhoneIcon } from "./icons";
import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";

/**
 * Single result row inside the unified search list. Shares layout primitives
 * with `InboxRow` so projection-backed and contact-only matches feel
 * identical. The two row formats:
 *
 * - `hasProjection === true`: renders subject + snippet (with `<mark>` over
 *   the matched substring when `highlightSnippet` is set).
 * - `hasProjection === false`: renders email/phone (or "No conversation
 *   yet") on the secondary line; no subject/snippet.
 *
 * Click target is `/inbox/[contactId]` regardless of section, preserving
 * existing `q` / `filter` / `projectId` URL params so the search input
 * stays populated when navigating back.
 */
export function InboxUnifiedSearchRow({
  row,
  query,
  isActive,
  highlightSnippet = false,
}: {
  readonly row: InboxUnifiedSearchRowViewModel;
  readonly query: string;
  readonly isActive: boolean;
  readonly highlightSnippet?: boolean;
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

  const showSubject =
    row.hasProjection &&
    row.latestSubject !== null &&
    row.latestSubject.length > 0;

  // Body-match snippet: slice ±60 chars around the first match position so
  // the matched substring is visible even for long snippets, then highlight
  // the matched substring with <mark>.
  const snippetContent = useMemo(() => {
    const snippet = row.snippet ?? "";

    if (snippet.length === 0) {
      return null;
    }

    if (!highlightSnippet || query.trim().length === 0) {
      return <span>{snippet}</span>;
    }

    return renderHighlightedSnippet(snippet, query);
  }, [row.snippet, query, highlightSnippet]);

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
              {snippetContent !== null ? (
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {snippetContent}
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
 * Slice ±60 chars around the first occurrence of the query (case-insensitive)
 * and wrap every match with <mark>. When the snippet is shorter than ~140
 * chars, return it unsliced.
 */
function renderHighlightedSnippet(
  snippet: string,
  query: string,
): React.ReactNode {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return <span>{snippet}</span>;
  }

  const lower = snippet.toLowerCase();
  const needle = trimmed.toLowerCase();
  const firstIdx = lower.indexOf(needle);

  let workingSnippet = snippet;
  let leadEllipsis = false;
  let trailEllipsis = false;

  // Slice around the first match if the snippet is long enough to need it.
  if (firstIdx >= 0 && snippet.length > 140) {
    const start = Math.max(0, firstIdx - 60);
    const end = Math.min(snippet.length, firstIdx + needle.length + 60);
    workingSnippet = snippet.slice(start, end);
    leadEllipsis = start > 0;
    trailEllipsis = end < snippet.length;
  }

  // Walk the working snippet, splitting on case-insensitive matches.
  const workingLower = workingSnippet.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < workingSnippet.length) {
    const idx = workingLower.indexOf(needle, cursor);
    if (idx === -1) {
      parts.push(
        <Fragment key={`t-${key.toString()}`}>
          {workingSnippet.slice(cursor)}
        </Fragment>,
      );
      key += 1;
      break;
    }
    if (idx > cursor) {
      parts.push(
        <Fragment key={`t-${key.toString()}`}>
          {workingSnippet.slice(cursor, idx)}
        </Fragment>,
      );
      key += 1;
    }
    parts.push(
      <mark
        key={`m-${key.toString()}`}
        className="rounded bg-amber-100 px-0.5 text-slate-900"
      >
        {workingSnippet.slice(idx, idx + needle.length)}
      </mark>,
    );
    key += 1;
    cursor = idx + needle.length;
  }

  return (
    <span>
      {leadEllipsis ? "… " : null}
      {parts}
      {trailEllipsis ? " …" : null}
    </span>
  );
}
