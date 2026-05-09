"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LAYOUT,
  RADIUS,
  SHADOW,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";

import type {
  AllContactsSearchPageViewModel,
  AllContactsSearchRowViewModel,
} from "../_lib/all-contacts-search";
import {
  LoaderIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
  SearchXIcon,
  UserRoundIcon,
  XIcon,
} from "./icons";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

interface AllContactsViewProps {
  readonly initialQuery?: string;
}

interface SearchState {
  readonly query: string;
  readonly results: AllContactsSearchPageViewModel | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

async function fetchAllContactsSearch(
  query: string,
  cursor: string | null,
): Promise<AllContactsSearchPageViewModel> {
  const params = new URLSearchParams({ q: query });
  if (cursor !== null) {
    params.set("cursor", cursor);
  }
  const response = await fetch(`/api/contacts/search?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Search failed with status ${response.status.toString()}.`,
    );
  }
  return (await response.json()) as AllContactsSearchPageViewModel;
}

/**
 * "All contacts" search-only view. Bypasses the inbox projection and queries
 * the `contacts` table directly so volunteer-support operators can find any
 * volunteer in the database — even those with only signup/lifecycle events
 * or no events at all.
 *
 * Distinct from the inbox search bar (which only searches across
 * inbox-driving comm-event rows in `contact_inbox_projection`).
 */
export function AllContactsView({ initialQuery = "" }: AllContactsViewProps) {
  const [state, setState] = useState<SearchState>({
    query: initialQuery,
    results: null,
    isLoading: false,
    error: null,
  });
  const [isLoadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const trimmedQuery = state.query.trim();
  const isSearchable = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!isSearchable) {
      setState((previous) => ({
        ...previous,
        results: null,
        isLoading: false,
        error: null,
      }));
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((previous) => ({ ...previous, isLoading: true, error: null }));

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const page = await fetchAllContactsSearch(trimmedQuery, null);
          if (requestIdRef.current !== requestId) {
            return;
          }
          setState((previous) =>
            previous.query.trim() === trimmedQuery
              ? { ...previous, results: page, isLoading: false, error: null }
              : previous,
          );
        } catch {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setState((previous) =>
            previous.query.trim() === trimmedQuery
              ? {
                  ...previous,
                  results: null,
                  isLoading: false,
                  error: "Search failed. Try again.",
                }
              : previous,
          );
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [isSearchable, trimmedQuery]);

  const handleLoadMore = useCallback(async () => {
    if (state.results?.nextCursor === undefined || state.results.nextCursor === null) {
      return;
    }
    setLoadingMore(true);
    const requestId = requestIdRef.current;
    try {
      const next = await fetchAllContactsSearch(
        state.results.query,
        state.results.nextCursor,
      );
      if (requestIdRef.current !== requestId) {
        return;
      }
      setState((previous) =>
        previous.results === null
          ? previous
          : {
              ...previous,
              results: {
                query: previous.results.query,
                rows: [...previous.results.rows, ...next.rows],
                nextCursor: next.nextCursor,
              },
            },
      );
    } catch {
      // Swallow load-more errors; the toast on the main flow already covers
      // the bad-network case.
    } finally {
      setLoadingMore(false);
    }
  }, [state.results]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div
          className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-4`}
        >
          <UserRoundIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-500"
          />
          <h1 className={`min-w-0 flex-1 truncate ${TYPE.headingMd}`}>
            All contacts
          </h1>
        </div>

        <div className="px-4 py-2.5">
          <label
            className={`flex items-center gap-2 ${RADIUS.md} border border-slate-200 bg-white px-3 py-1.5 text-sm ${SHADOW.sm} ${TRANSITION.fast} focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300`}
          >
            <SearchIcon className="size-4 text-slate-400" />
            <input
              autoFocus
              data-all-contacts-search-input="true"
              type="text"
              placeholder="Search any volunteer by name, email, or phone"
              value={state.query}
              onChange={(event) => {
                setState((previous) => ({
                  ...previous,
                  query: event.currentTarget.value,
                }));
              }}
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {state.isLoading ? (
              <span
                role="status"
                aria-label="Search loading"
                className="inline-flex size-4 items-center justify-center"
              >
                <LoaderIcon
                  aria-hidden="true"
                  className="size-3.5 animate-spin text-slate-400"
                />
              </span>
            ) : state.query.length > 0 ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setState((previous) => ({
                    ...previous,
                    query: "",
                    results: null,
                  }));
                }}
                className={cn(
                  "relative rounded p-0.5 text-slate-400 hover:text-slate-700",
                  "transition-[color,transform] duration-150 ease-out active:scale-[0.96]",
                  "after:absolute after:-inset-2.5 after:content-['']",
                  TRANSITION.reduceMotion,
                  FOCUS_RING,
                )}
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        {state.error !== null ? (
          <div className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700">
            {state.error}
          </div>
        ) : null}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!isSearchable ? (
          <AllContactsEmptyPrompt />
        ) : state.isLoading && state.results === null ? (
          <AllContactsLoading />
        ) : state.results !== null && state.results.rows.length === 0 ? (
          <AllContactsNoResults query={state.results.query} />
        ) : state.results !== null ? (
          <>
            <ul className="divide-y divide-slate-100">
              {state.results.rows.map((row) => (
                <AllContactsRow key={row.contactId} row={row} />
              ))}
            </ul>
            {state.results.nextCursor !== null ? (
              <div className="border-t border-slate-100 px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleLoadMore();
                  }}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function AllContactsRow({ row }: { readonly row: AllContactsSearchRowViewModel }) {
  return (
    <li>
      <Link
        href={row.profileHref}
        className={cn(
          "flex flex-col gap-1.5 px-5 py-3 transition-colors duration-150",
          "hover:bg-slate-50 focus:bg-slate-50 focus:outline-none",
          FOCUS_RING,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-slate-900">
            {row.displayName}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {formatLastActivityLabel(row.lastActivityAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {row.primaryEmail !== null ? (
            <span className="inline-flex items-center gap-1 truncate">
              <MailIcon
                aria-hidden="true"
                className="size-3 shrink-0 text-slate-400"
              />
              <span className="truncate">{row.primaryEmail}</span>
            </span>
          ) : null}
          {row.primaryPhone !== null ? (
            <span className="inline-flex items-center gap-1">
              <PhoneIcon
                aria-hidden="true"
                className="size-3 shrink-0 text-slate-400"
              />
              <span>{row.primaryPhone}</span>
            </span>
          ) : null}
          {row.primaryEmail === null && row.primaryPhone === null ? (
            <span className="text-slate-400">No contact info</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.memberships.length === 0 ? (
            <span className="text-[11px] italic text-slate-400">
              No active project
            </span>
          ) : (
            row.memberships.map((membership) => (
              <span
                key={membership.projectId}
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
              >
                {membership.label}
              </span>
            ))
          )}
        </div>
      </Link>
    </li>
  );
}

function AllContactsEmptyPrompt() {
  return (
    <EmptyState
      icon={<UserRoundIcon className="size-6" />}
      title="Search any volunteer"
      description="Look up a volunteer by name, email, or phone — even if they haven't written in yet."
    />
  );
}

function AllContactsLoading() {
  return (
    <div className="flex items-center justify-center px-5 py-12 text-xs text-slate-400">
      <LoaderIcon className="mr-2 size-4 animate-spin" /> Searching…
    </div>
  );
}

function AllContactsNoResults({ query }: { readonly query: string }) {
  return (
    <EmptyState
      icon={<SearchXIcon className="size-6" />}
      title="No matching contacts"
      description={
        <>
          Nothing matches &ldquo;{query}&rdquo;. Try a different name, email, or
          phone number.
        </>
      }
    />
  );
}

function formatLastActivityLabel(iso: string | null): string {
  if (iso === null) {
    return "No activity";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "No activity";
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return formatter.format(date);
}
