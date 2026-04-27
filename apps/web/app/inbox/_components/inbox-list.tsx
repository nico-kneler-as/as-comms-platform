"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type { InboxFilterId, InboxListViewModel } from "../_lib/view-models";
import { fetchInboxListPage } from "../_lib/client-api";
import { shouldApplyUrlSearchQuery } from "../_lib/search-sync";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { extractInboxContactId } from "./inbox-keyboard-helpers";
import { resolveAutoLoadInboxCursor } from "./inbox-list-pagination";
import { useInboxClient } from "./inbox-client-provider";
import {
  FOCUS_RING,
  LAYOUT,
  RADIUS,
  SHADOW,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import {
  FilterIcon,
  InboxIcon,
  LoaderIcon,
  PencilIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "./icons";
import { InboxFilterList } from "./inbox-filter-list";
import { QueueLoadingSkeleton } from "./inbox-loading";
import { InboxRow } from "./inbox-row";

interface ListColumnProps {
  readonly initialList: InboxListViewModel;
  readonly initialFilterId?: InboxFilterId;
}

const TITLE = "Inbox";

export function InboxList({
  initialList,
  initialFilterId = "all",
}: ListColumnProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeContactId = extractInboxContactId(pathname);
  const {
    search,
    setSearchQuery,
    clearSearch,
    isQueueLoading,
    setQueueLoading,
    openNewDraft,
  } = useInboxClient();
  const urlQuery = searchParams.get("q") ?? "";
  const urlProjectId = searchParams.get("projectId");
  const rawSearchQuery = search.query.trim();
  const deferredQuery = useDeferredValue(search.query);
  const normalizedQuery = deferredQuery.trim();
  const isSearchThresholdMet = rawSearchQuery.length >= 3;
  const isDeferredSearchPending =
    isSearchThresholdMet && rawSearchQuery !== normalizedQuery;
  const isServerSearchActive =
    isSearchThresholdMet && normalizedQuery.length >= 3;
  const serverQuery = isServerSearchActive ? normalizedQuery : null;
  const [activeFilter, setActiveFilter] = useState(initialFilterId);
  const [selectedProjectId, setSelectedProjectId] = useState(
    urlProjectId ?? initialList.selectedProjectId ?? null,
  );
  const [currentList, setCurrentList] = useState(initialList);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isFilterPaneOpen, setFilterPaneOpen] = useState(false);
  const [isFilterTransitionPending, startFilterTransition] = useTransition();
  const activeRequestIdRef = useRef(0);
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingAppendCursorRef = useRef<string | null>(null);
  const previousFilterRef = useRef(initialFilterId);
  const previousProjectIdRef = useRef(
    urlProjectId ?? initialList.selectedProjectId ?? null,
  );
  const previousUrlQueryRef = useRef(urlQuery);
  const previousUrlProjectIdRef = useRef(urlProjectId);
  const latestShellStateRef = useRef({
    activeFilter: initialFilterId,
    selectedProjectId: urlProjectId ?? initialList.selectedProjectId ?? null,
    initialList,
  });
  const listFreshnessKey = `${initialList.freshness.latestUpdatedAt ?? "none"}:${initialList.freshness.total.toString()}`;
  const initialFilterCountById = useMemo(
    () =>
      new Map(
        initialList.filters.map((filter) => [filter.id, filter.count] as const),
      ),
    [initialList.filters],
  );

  useEffect(() => {
    latestShellStateRef.current = {
      activeFilter,
      selectedProjectId,
      initialList,
    };
  }, [activeFilter, initialList, selectedProjectId]);

  useEffect(() => {
    if (
      !shouldApplyUrlSearchQuery({
        urlQuery,
        previousUrlQuery: previousUrlQueryRef.current,
      })
    ) {
      return;
    }

    previousUrlQueryRef.current = urlQuery;

    if (search.query !== urlQuery) {
      setSearchQuery(urlQuery);
    }
  }, [search.query, setSearchQuery, urlQuery]);

  // Sync URL projectId → state on external URL changes (e.g. welcome card click)
  useEffect(() => {
    if (urlProjectId === previousUrlProjectIdRef.current) {
      return;
    }

    previousUrlProjectIdRef.current = urlProjectId;
    setSelectedProjectId(urlProjectId);
  }, [urlProjectId]);

  useEffect(() => {
    const currentUrlQuery = urlQuery.trim();

    if (normalizedQuery === currentUrlQuery) {
      return;
    }

    const handle = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (normalizedQuery.length === 0) {
        nextParams.delete("q");
      } else {
        nextParams.set("q", normalizedQuery);
      }

      const nextQueryString = nextParams.toString();
      const nextHref =
        nextQueryString.length === 0
          ? pathname
          : `${pathname}?${nextQueryString}`;

      previousUrlQueryRef.current = normalizedQuery;
      router.replace(nextHref, { scroll: false });
    }, 400);

    return () => {
      window.clearTimeout(handle);
    };
  }, [normalizedQuery, pathname, router, searchParams, urlQuery]);

  const loadFilterPage = useCallback(
    async (input: {
      readonly filterId: InboxFilterId;
      readonly cursor?: string | null;
      readonly append: boolean;
      readonly query?: string | null;
      readonly projectId?: string | null;
    }) => {
      const appendCursor = input.append ? (input.cursor ?? null) : null;

      if (input.append) {
        if (appendCursor === null) {
          return;
        }

        if (pendingAppendCursorRef.current === appendCursor) {
          return;
        }

        pendingAppendCursorRef.current = appendCursor;
      } else {
        pendingAppendCursorRef.current = null;
      }

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      setQueueLoading(true);
      setQueueError(null);

      try {
        const nextList = await fetchInboxListPage({
          filterId: input.filterId,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          query: input.query ?? null,
          projectId: input.projectId ?? null,
        });

        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentList((previousList) =>
          input.append
            ? {
                ...nextList,
                items: [...previousList.items, ...nextList.items],
              }
            : nextList,
        );
      } catch {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setQueueError("Inbox refresh failed. Keeping the last loaded rows.");
      } finally {
        if (
          appendCursor !== null &&
          pendingAppendCursorRef.current === appendCursor
        ) {
          pendingAppendCursorRef.current = null;
        }

        if (activeRequestIdRef.current === requestId) {
          setQueueLoading(false);
        }
      }
    },
    [setQueueLoading],
  );

  useEffect(() => {
    const previousFilter = previousFilterRef.current;
    const previousProjectId = previousProjectIdRef.current;
    previousFilterRef.current = activeFilter;
    previousProjectIdRef.current = selectedProjectId;
    activeRequestIdRef.current += 1;
    const latestShellState = latestShellStateRef.current;

    if (
      activeFilter === "all" &&
      selectedProjectId === null &&
      !isServerSearchActive
    ) {
      setQueueLoading(false);
      setQueueError(null);
      setCurrentList(latestShellState.initialList);
      return;
    }

    if (
      previousFilter !== activeFilter ||
      previousProjectId !== selectedProjectId
    ) {
      setCurrentList((previousList) => ({
        ...previousList,
        items: [],
        page: {
          hasMore: false,
          nextCursor: null,
          total:
            initialFilterCountById.get(activeFilter) ?? previousList.page.total,
        },
      }));
    }

    void loadFilterPage({
      filterId: activeFilter,
      append: false,
      query: serverQuery,
      projectId: selectedProjectId,
    });
  }, [
    activeFilter,
    initialFilterCountById,
    isServerSearchActive,
    loadFilterPage,
    selectedProjectId,
    serverQuery,
    setQueueLoading,
  ]);

  useEffect(() => {
    const latestShellState = latestShellStateRef.current;

    if (
      latestShellState.activeFilter === "all" &&
      latestShellState.selectedProjectId === null &&
      !isServerSearchActive
    ) {
      setCurrentList(latestShellState.initialList);
      setQueueError(null);
      return;
    }

    void loadFilterPage({
      filterId: latestShellState.activeFilter,
      append: false,
      query: serverQuery,
      projectId: latestShellState.selectedProjectId,
    });
  }, [isServerSearchActive, listFreshnessKey, loadFilterPage, serverQuery]);

  const displayItems = currentList.items;

  const isSearchInFlight =
    isServerSearchActive &&
    isQueueLoading &&
    pendingAppendCursorRef.current === null;
  const shouldShowSearchSkeleton =
    isSearchThresholdMet && (isDeferredSearchPending || isSearchInFlight);
  const shouldShowInitialSkeleton =
    isQueueLoading && currentList.items.length === 0 && !shouldShowSearchSkeleton;
  const canLoadMore =
    currentList.page.hasMore && currentList.page.nextCursor !== null;
  const isLoadingMore =
    isQueueLoading && pendingAppendCursorRef.current !== null;
  const activeProjects = currentList.activeProjects;
  const hasActiveFilters = activeFilter !== "all" || selectedProjectId !== null;
  const shouldShowSearchSummary = search.isActive && isSearchThresholdMet;

  const handleFilterChange = useCallback(
    (id: InboxFilterId) => {
      startFilterTransition(() => {
        setActiveFilter(id);
      });
    },
    [startFilterTransition],
  );

  const handleProjectChange = useCallback(
    (id: string | null) => {
      startFilterTransition(() => {
        setSelectedProjectId(id);
      });

      const nextParams = new URLSearchParams(searchParams.toString());
      if (id === null) {
        nextParams.delete("projectId");
      } else {
        nextParams.set("projectId", id);
      }

      const nextQueryString = nextParams.toString();
      const nextHref =
        nextQueryString.length === 0 ? pathname : `${pathname}?${nextQueryString}`;

      previousUrlProjectIdRef.current = id;
      router.replace(nextHref, { scroll: false });
    },
    [pathname, router, searchParams, startFilterTransition],
  );

  const toggleFilterPane = useCallback(() => {
    setFilterPaneOpen((isOpen) => !isOpen);
  }, []);

  useEffect(() => {
    const root = listViewportRef.current;
    const sentinel = loadMoreSentinelRef.current;

    if (root === null || sentinel === null) {
      return;
    }

    if (!canLoadMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const nextCursor = resolveAutoLoadInboxCursor({
          isIntersecting: entries.some((entry) => entry.isIntersecting),
          hasMore: currentList.page.hasMore,
          nextCursor: currentList.page.nextCursor,
          isQueueLoading,
          isFilterTransitionPending,
          pendingCursor: pendingAppendCursorRef.current,
        });

        if (nextCursor === null) {
          return;
        }

        void loadFilterPage({
          filterId: activeFilter,
          cursor: nextCursor,
          append: true,
          query: serverQuery,
          projectId: selectedProjectId,
        });
      },
      {
        root,
        rootMargin: "240px 0px",
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [
    activeFilter,
    canLoadMore,
    currentList.page.hasMore,
    currentList.page.nextCursor,
    isFilterTransitionPending,
    isQueueLoading,
    loadFilterPage,
    selectedProjectId,
    serverQuery,
  ]);

  return (
    <section
      data-inbox-list-root="true"
      className={`relative flex ${LAYOUT.listWidth} shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white`}
    >
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div
          className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-5`}
        >
          <h1 className={`min-w-0 flex-1 truncate ${TYPE.headingLg}`}>
            {TITLE}
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Compose"
            aria-keyshortcuts="c"
            title="Compose"
            onClick={openNewDraft}
            className="h-8 w-8 shrink-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <PencilIcon aria-hidden="true" data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Filters"
            aria-controls="inbox-filter-list"
            aria-expanded={isFilterPaneOpen}
            title="Filters"
            onClick={toggleFilterPane}
            className={cn(
              "relative h-8 w-8 shrink-0",
              isFilterPaneOpen
                ? "bg-slate-900 text-white hover:bg-slate-900 hover:text-white"
                : hasActiveFilters
                  ? "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <FilterIcon aria-hidden="true" data-icon="inline-start" />
            {hasActiveFilters ? (
              <span
                aria-hidden="true"
                data-filter-active-indicator="true"
                className={cn(
                  "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-500 ring-2",
                  isFilterPaneOpen ? "ring-slate-900" : "ring-white",
                )}
              />
            ) : null}
          </Button>
        </div>

        <div className="px-5 pb-3 pt-3">
          <label
            className={`flex items-center gap-2 ${RADIUS.md} border border-slate-200 bg-white px-3 py-1.5 text-sm ${SHADOW.sm} ${TRANSITION.fast} focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300`}
          >
            <SearchIcon className="h-4 w-4 text-slate-400" />
            <input
              id="inbox-search-input"
              data-inbox-search-input="true"
              aria-keyshortcuts="/"
              type="text"
              placeholder="Search people, emails, projects"
              value={search.query}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value);
              }}
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {shouldShowSearchSkeleton ? (
              <span
                role="status"
                aria-label="Search loading"
                className="inline-flex h-4 w-4 items-center justify-center"
              >
                <LoaderIcon
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin text-slate-400"
                />
              </span>
            ) : search.isActive ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clearSearch}
                className={cn(
                  "relative rounded p-0.5 text-slate-400 hover:text-slate-700",
                  "transition-[color,transform] duration-150 ease-out active:scale-[0.96]",
                  "after:absolute after:-inset-2.5 after:content-['']",
                  TRANSITION.reduceMotion,
                  FOCUS_RING,
                )}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        {isFilterPaneOpen ? (
          <InboxFilterList
            id="inbox-filter-list"
            filters={currentList.filters}
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            projects={activeProjects}
            selectedProjectId={selectedProjectId}
            onProjectChange={handleProjectChange}
          />
        ) : null}

        {queueError ? (
          <div className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700">
            {queueError}
          </div>
        ) : null}

        {shouldShowSearchSummary ? (
          <div className="border-t border-slate-100 px-5 py-2">
            <p className="text-xs text-slate-500">
              {shouldShowSearchSkeleton ? (
                <span className="text-slate-400">
                  Searching for &ldquo;{search.query}&rdquo;
                </span>
              ) : displayItems.length === 0 ? (
                <span className="text-slate-400">
                  No results for &ldquo;{search.query}&rdquo;
                </span>
              ) : (
                <>
                  <span className="font-medium text-slate-700">
                    {currentList.page.total}
                  </span>{" "}
                  {currentList.page.total === 1 ? "result" : "results"} for
                  &ldquo;{search.query}&rdquo;
                </>
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div ref={listViewportRef} className="min-h-0 flex-1 overflow-y-auto">
        {shouldShowSearchSkeleton ? (
          <QueueLoadingSkeleton rowCount={3} label="Searching inbox" />
        ) : shouldShowInitialSkeleton ? (
          <QueueLoadingSkeleton />
        ) : shouldShowSearchSummary && displayItems.length === 0 ? (
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
                <div
                  ref={loadMoreSentinelRef}
                  aria-hidden="true"
                  className="h-px w-full"
                />
                {isLoadingMore ? (
                  <p className="pt-3 text-center text-sm text-slate-500">
                    Loading more conversations...
                  </p>
                ) : null}
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
          Nothing in the inbox matches &ldquo;{query}&rdquo;. Try a different
          search.
        </>
      }
    />
  );
}
