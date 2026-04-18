"use client";

import { usePathname } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  InboxFilterId,
  InboxListViewModel
} from "../_lib/view-models";
import { fetchInboxListPage } from "../_lib/client-api";
import { EmptyState } from "@/components/ui/empty-state";

import { useInboxClient } from "./inbox-client-provider";
import { FOCUS_RING, LAYOUT, RADIUS, SHADOW, TEXT, TRANSITION } from "@/app/_lib/design-tokens";
import {
  InboxIcon,
  SearchIcon,
  SearchXIcon,
  XIcon
} from "./icons";
import { QueueLoadingSkeleton } from "./inbox-loading";
import { InboxRow } from "./inbox-row";

interface ListColumnProps {
  readonly initialList: InboxListViewModel;
  readonly initialFilterId?: InboxFilterId;
}

const FILTER_IDS: readonly InboxFilterId[] = [
  "all",
  "unread",
  "follow-up",
  "unresolved"
];

export function InboxList({
  initialList,
  initialFilterId = "all"
}: ListColumnProps) {
  const pathname = usePathname();
  const activeContactId = extractContactId(pathname);
  const {
    search,
    setSearchQuery,
    clearSearch,
    isQueueLoading,
    setQueueLoading
  } = useInboxClient();
  const deferredQuery = useDeferredValue(search.query);
  const normalizedQuery = deferredQuery.trim();
  const isServerSearchActive = normalizedQuery.length > 0;
  const [activeFilter, setActiveFilter] = useState<InboxFilterId>(initialFilterId);
  const [currentList, setCurrentList] = useState(initialList);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isFilterTransitionPending, startFilterTransition] = useTransition();
  const activeRequestIdRef = useRef(0);
  const previousFilterRef = useRef<InboxFilterId>(initialFilterId);
  const latestShellStateRef = useRef({
    activeFilter: initialFilterId,
    initialList
  });
  const listFreshnessKey = `${initialList.freshness.latestUpdatedAt ?? "none"}:${initialList.freshness.total.toString()}`;
  const initialFilterCountById = useMemo(
    () =>
      new Map(initialList.filters.map((filter) => [filter.id, filter.count] as const)),
    [initialList.filters]
  );

  useEffect(() => {
    latestShellStateRef.current = {
      activeFilter,
      initialList
    };
  }, [activeFilter, initialList]);

  const loadFilterPage = useCallback(
    async (input: {
      readonly filterId: InboxFilterId;
      readonly cursor?: string | null;
      readonly append: boolean;
      readonly query?: string | null;
    }) => {
      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      setQueueLoading(true);
      setQueueError(null);

      try {
        const nextList = await fetchInboxListPage({
          filterId: input.filterId,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          query: input.query ?? null
        });

        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentList((previousList) =>
          input.append
            ? {
                ...nextList,
                items: [...previousList.items, ...nextList.items]
              }
            : nextList
        );
      } catch {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setQueueError("Inbox refresh failed. Keeping the last loaded rows.");
      } finally {
        if (activeRequestIdRef.current === requestId) {
          setQueueLoading(false);
        }
      }
    },
    [setQueueLoading]
  );

  useEffect(() => {
    const previousFilter = previousFilterRef.current;
    previousFilterRef.current = activeFilter;
    activeRequestIdRef.current += 1;
    const latestShellState = latestShellStateRef.current;

    if (activeFilter === "all" && !isServerSearchActive) {
      setQueueLoading(false);
      setQueueError(null);
      setCurrentList(latestShellState.initialList);
      return;
    }

    if (previousFilter !== activeFilter) {
      setCurrentList((previousList) => ({
        ...previousList,
        items: [],
        page: {
          hasMore: false,
          nextCursor: null,
          total: initialFilterCountById.get(activeFilter) ?? previousList.page.total
        }
      }));
    }

    void loadFilterPage({
      filterId: activeFilter,
      append: false,
      query: normalizedQuery
    });
  }, [
    activeFilter,
    initialFilterCountById,
    isServerSearchActive,
    loadFilterPage,
    normalizedQuery,
    setQueueLoading
  ]);

  useEffect(() => {
    const latestShellState = latestShellStateRef.current;

    if (latestShellState.activeFilter === "all" && !isServerSearchActive) {
      setCurrentList(latestShellState.initialList);
      setQueueError(null);
      return;
    }

    void loadFilterPage({
      filterId: latestShellState.activeFilter,
      append: false,
      query: normalizedQuery
    });
  }, [isServerSearchActive, listFreshnessKey, loadFilterPage, normalizedQuery]);

  const filterLabels = useMemo(
    () =>
      new Map(currentList.filters.map((filter) => [filter.id, filter.label] as const)),
    [currentList.filters]
  );

  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        currentList.filters.map((filter) => [filter.id, filter.count] as const)
      ) as Record<InboxFilterId, number>,
    [currentList.filters]
  );

  const displayItems = currentList.items;

  const shouldShowInitialSkeleton = isQueueLoading && currentList.items.length === 0;
  const canLoadMore = currentList.page.hasMore && currentList.page.nextCursor !== null;

  return (
    <section className={`relative flex ${LAYOUT.listWidth} shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white`}>
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-5`}>
          <h1 className={`min-w-0 flex-1 truncate ${TEXT.headingLg}`}>
            Inbox
          </h1>
        </div>

        <div className="px-5 pb-3 pt-3">
          <label className={`flex items-center gap-2 ${RADIUS.md} border border-slate-200 bg-white px-3 py-1.5 text-sm ${SHADOW.sm} ${TRANSITION.fast} focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300`}>
            <SearchIcon className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search people, emails, projects"
              value={search.query}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value);
              }}
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {search.isActive ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clearSearch}
                className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {FILTER_IDS.map((id) => {
            const isActive = activeFilter === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  startFilterTransition(() => {
                    setActiveFilter(id);
                  });
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filterLabels.get(id) ?? id}{" "}
                <span className={isActive ? "text-slate-300" : "text-slate-400"}>
                  {filterCounts[id]}
                </span>
              </button>
            );
          })}
        </div>

        {queueError ? (
          <div className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700">
            {queueError}
          </div>
        ) : null}

        {search.isActive ? (
          <div className="border-t border-slate-100 px-5 py-2">
            <p className="text-xs text-slate-500">
              {displayItems.length === 0 ? (
                <span className="text-slate-400">
                  No results for &ldquo;{search.query}&rdquo;
                </span>
              ) : (
                <>
                  <span className="font-medium text-slate-700">
                    {displayItems.length}
                  </span>{" "}
                  {displayItems.length === 1 ? "result" : "results"} for
                  &ldquo;{search.query}&rdquo;
                </>
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shouldShowInitialSkeleton ? (
          <QueueLoadingSkeleton />
        ) : search.isActive && displayItems.length === 0 ? (
          <SearchEmptyState query={search.query} />
        ) : displayItems.length === 0 ? (
          <QueueEmptyState />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {displayItems.map((item) => (
                <InboxRow
                  key={item.contactId}
                  item={item}
                  isActive={item.contactId === activeContactId}
                />
              ))}
            </ul>

            {canLoadMore ? (
              <div className="border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  disabled={isQueueLoading || isFilterTransitionPending}
                  onClick={() => {
                    void loadFilterPage({
                      filterId: activeFilter,
                      cursor: currentList.page.nextCursor,
                      append: true,
                      query: normalizedQuery
                    });
                  }}
                  className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 ${TRANSITION.fast} hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isQueueLoading
                    ? "Loading more conversations..."
                    : `Load more (${currentList.items.length.toString()} of ${currentList.page.total.toString()})`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function QueueEmptyState() {
  return (
    <EmptyState
      icon={<InboxIcon className="h-6 w-6" />}
      title="All caught up"
      description="No conversations match the current filter."
    />
  );
}

function SearchEmptyState({ query }: { readonly query: string }) {
  return (
    <EmptyState
      icon={<SearchXIcon className="h-6 w-6" />}
      title="No results"
      description={
        <>
          Nothing in the loaded queue matches &ldquo;{query}&rdquo;. Try a different
          search.
        </>
      }
    />
  );
}

function extractContactId(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/inbox\/([^/]+)/.exec(pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return match[1] ?? null;
  }
}
