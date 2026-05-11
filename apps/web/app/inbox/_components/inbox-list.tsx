"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  InboxActiveProjectOption,
  InboxFilterId,
  InboxListViewModel,
  InboxUnifiedSearchViewModel,
} from "../_lib/view-models";
import { fetchInboxListPage, fetchInboxUnifiedSearch } from "../_lib/client-api";
import { parseInboxFilterId } from "../_lib/view-models";
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
import { QueueLoadingSkeleton, QueueLoadMoreSkeleton } from "./inbox-loading";
import { InboxRow } from "./inbox-row";
import { InboxUnifiedSearchRow } from "./inbox-unified-search-row";

interface ListColumnProps {
  readonly initialList: InboxListViewModel;
  readonly initialFilterId?: InboxFilterId;
}

const STATE_HEADER_LABEL: Partial<Record<InboxFilterId, string>> = {
  unread: "Unread",
  "follow-up": "Pending",
  sent: "Sent",
  archived: "Archived",
};

/**
 * Pull a numeric HTTP status off an unknown caught error, when one is
 * available. We don't know the exact thrown shape (could be `InboxFetchError`,
 * a plain `Error`, a `TypeError` for network failures, etc.), so we duck-type
 * for `.status` instead of relying on `instanceof`.
 */
function extractFetchErrorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return null;
}

/**
 * Build the banner string for a failed inbox refresh. Surfacing the HTTP
 * status (when available) gives operators something concrete to report when a
 * refresh fails, without leaking request bodies, headers, or query params.
 */
function resolveInboxRefreshErrorMessage(input: {
  readonly status: number | null;
  readonly errorName: string | null;
}): string {
  if (input.status !== null) {
    return `Inbox refresh failed (HTTP ${input.status.toString()}). Keeping the last loaded rows.`;
  }

  if (input.errorName === "TypeError") {
    return "Inbox refresh failed (network error). Keeping the last loaded rows.";
  }

  return "Inbox refresh failed. Keeping the last loaded rows.";
}

function resolveInboxHeaderTitle(input: {
  readonly searchQuery: string;
  readonly activeFilter: InboxFilterId;
  readonly selectedProjectId: string | null;
  readonly urlProjectIds: readonly string[];
  readonly activeProjects: readonly InboxActiveProjectOption[];
}): string {
  if (input.searchQuery.trim().length >= 3) {
    return "Results";
  }

  const normalizedProjectIds =
    input.urlProjectIds.length > 0
      ? Array.from(
          new Set(input.urlProjectIds.filter((projectId) => projectId.length > 0)),
        )
      : input.selectedProjectId === null
        ? []
        : [input.selectedProjectId];
  const activeStateLabel: string | null =
    input.activeFilter === "inbox"
      ? null
      : STATE_HEADER_LABEL[input.activeFilter] ?? null;
  const activeFacetCount =
    normalizedProjectIds.length + (activeStateLabel === null ? 0 : 1);

  if (activeFacetCount === 0) {
    return "Inbox";
  }

  if (activeFacetCount > 2) {
    return "Filtered";
  }

  let projectLabel: string | null = null;

  if (normalizedProjectIds.length > 1) {
    projectLabel = `${String(normalizedProjectIds.length)} projects`;
  } else if (normalizedProjectIds.length === 1) {
    const selectedProject = input.activeProjects.find(
      (project) => project.id === normalizedProjectIds[0],
    );

    if (selectedProject !== undefined) {
      projectLabel = selectedProject.alias ?? selectedProject.name;
    }
  }

  if (projectLabel !== null && activeStateLabel !== null) {
    return `${projectLabel} · ${activeStateLabel}`;
  }

  return projectLabel ?? activeStateLabel ?? "Inbox";
}

export function InboxList({
  initialList,
  initialFilterId = "inbox",
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
  const urlFilter = searchParams.get("filter");
  const urlProjectId = searchParams.get("projectId");
  const urlProjectIds = searchParams.getAll("projectId");
  const rawSearchQuery = search.query.trim();
  const normalizedQuery = rawSearchQuery;
  const isSearchThresholdMet = rawSearchQuery.length >= 3;
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
  const filterPaneRef = useRef<HTMLDivElement | null>(null);
  const filterToggleRef = useRef<HTMLButtonElement | null>(null);
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingAppendCursorRef = useRef<string | null>(null);
  const previousFilterRef = useRef(initialFilterId);
  const previousProjectIdRef = useRef(
    urlProjectId ?? initialList.selectedProjectId ?? null,
  );
  const previousUrlQueryRef = useRef(urlQuery);
  const previousUrlFilterRef = useRef(urlFilter);
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
        currentQuery: search.query,
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
    if (urlFilter === previousUrlFilterRef.current) {
      return;
    }

    previousUrlFilterRef.current = urlFilter;
    const parsedFilter = parseInboxFilterId(urlFilter);

    if (parsedFilter !== null) {
      setActiveFilter(parsedFilter);
    }
  }, [urlFilter]);

  useEffect(() => {
    if (urlFilter !== "all") {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("filter", "inbox");

    const nextQueryString = nextParams.toString();
    const nextHref =
      nextQueryString.length === 0 ? pathname : `${pathname}?${nextQueryString}`;

    previousUrlFilterRef.current = "inbox";
    router.replace(nextHref, { scroll: false });
  }, [pathname, router, searchParams, urlFilter]);

  useEffect(() => {
    if (normalizedQuery.length > 0 && normalizedQuery.length < 3) {
      return;
    }

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
      window.history.replaceState(window.history.state, "", nextHref);
    }, 400);

    return () => {
      window.clearTimeout(handle);
    };
  }, [normalizedQuery, pathname, searchParams, urlQuery]);

  const [searchResult, setSearchResult] =
    useState<InboxUnifiedSearchViewModel | null>(null);

  const loadFilterPage = useCallback(
    async (input: {
      readonly filterId: InboxFilterId;
      readonly cursor?: string | null;
      readonly append: boolean;
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
      } catch (error) {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        // AbortError fires when the user navigates away or the freshness
        // poller cancels a stale fetch — neither is a failure we should
        // surface to the operator.
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        const status = extractFetchErrorStatus(error);
        const errorName = error instanceof Error ? error.name : null;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Structured log only — never include request bodies, tokens,
        // headers, or query params. We rely on `Error.message` as
        // emitted by `InboxFetchError`/native fetch, which doesn't carry
        // those fields.
        console.warn("inbox.refresh.failed", {
          status,
          name: errorName ?? "unknown",
          message: errorMessage,
        });

        setQueueError(
          resolveInboxRefreshErrorMessage({ status, errorName }),
        );
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

  const loadUnifiedSearchPage = useCallback(
    async (query: string) => {
      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      setQueueLoading(true);
      setQueueError(null);

      try {
        const next = await fetchInboxUnifiedSearch({ query });

        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setSearchResult(next);
      } catch {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }

        setQueueError("Search failed. Keeping the previous results.");
      } finally {
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

    // Search active → run the unified search pipeline. The folder-filtered
    // list stays in `currentList` from before the search began; we don't
    // refetch it because the user can still see what they were looking at
    // when they clear the input.
    if (isServerSearchActive && serverQuery !== null) {
      void loadUnifiedSearchPage(serverQuery);
      return;
    }

    if (
      activeFilter === "inbox" &&
      selectedProjectId === null
    ) {
      setQueueLoading(false);
      setQueueError(null);
      setCurrentList(latestShellState.initialList);
      setSearchResult(null);
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

    setSearchResult(null);
    void loadFilterPage({
      filterId: activeFilter,
      append: false,
      projectId: selectedProjectId,
    });
  }, [
    activeFilter,
    initialFilterCountById,
    isServerSearchActive,
    loadFilterPage,
    loadUnifiedSearchPage,
    selectedProjectId,
    serverQuery,
    setQueueLoading,
  ]);

  useEffect(() => {
    const latestShellState = latestShellStateRef.current;

    if (isServerSearchActive && serverQuery !== null) {
      void loadUnifiedSearchPage(serverQuery);
      return;
    }

    if (
      latestShellState.activeFilter === "inbox" &&
      latestShellState.selectedProjectId === null
    ) {
      setCurrentList(latestShellState.initialList);
      setQueueError(null);
      setSearchResult(null);
      return;
    }

    setSearchResult(null);
    void loadFilterPage({
      filterId: latestShellState.activeFilter,
      append: false,
      projectId: latestShellState.selectedProjectId,
    });
  }, [
    isServerSearchActive,
    listFreshnessKey,
    loadFilterPage,
    loadUnifiedSearchPage,
    serverQuery,
  ]);

  const displayItems = currentList.items;

  const isSearchInFlight =
    isServerSearchActive &&
    isQueueLoading &&
    pendingAppendCursorRef.current === null;
  const shouldShowSearchSkeleton = isSearchThresholdMet && isSearchInFlight;
  const shouldShowInitialSkeleton =
    isQueueLoading && currentList.items.length === 0 && !shouldShowSearchSkeleton;
  // Pagination only applies to the folder-filtered list — the unified search
  // returns the top 25 per section in v1 with no cursor.
  const canLoadMore =
    !isServerSearchActive &&
    currentList.page.hasMore &&
    currentList.page.nextCursor !== null;
  const isLoadingMore =
    isQueueLoading && pendingAppendCursorRef.current !== null;
  const searchResultCount =
    searchResult === null
      ? 0
      : searchResult.volunteers.length + searchResult.contacts.length;
  const activeProjects = currentList.activeProjects;
  const hasActiveFilters =
    activeFilter !== "inbox" || selectedProjectId !== null;
  const shouldShowSearchSummary = search.isActive && isSearchThresholdMet;
  const headerTitle = useMemo(
    () =>
      resolveInboxHeaderTitle({
        searchQuery: search.query,
        activeFilter,
        selectedProjectId,
        urlProjectIds,
        activeProjects,
      }),
    [activeFilter, activeProjects, search.query, selectedProjectId, urlProjectIds],
  );

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
      const currentSearchQuery = search.query.trim();

      if (currentSearchQuery.length < 3) {
        nextParams.delete("q");
      } else {
        nextParams.set("q", currentSearchQuery);
      }

      if (id === null) {
        nextParams.delete("projectId");
      } else {
        nextParams.set("projectId", id);
      }

      const nextQueryString = nextParams.toString();
      const nextHref =
        nextQueryString.length === 0 ? pathname : `${pathname}?${nextQueryString}`;

      previousUrlProjectIdRef.current = id;
      previousUrlQueryRef.current = currentSearchQuery;
      router.replace(nextHref, { scroll: false });
    },
    [pathname, router, search.query, searchParams, startFilterTransition],
  );

  const toggleFilterPane = useCallback(() => {
    setFilterPaneOpen((isOpen) => !isOpen);
  }, []);

  // Collapse the filter pane on outside pointerdown. The toggle button is
  // excluded so it can still flip the pane closed via its own onClick. The
  // project Radix `DropdownMenu` portals its content outside `filterPaneRef`,
  // so allow clicks on any `[role="menu"]` element so picking a project does
  // not close the pane on its way to the radio item handler.
  useEffect(() => {
    if (!isFilterPaneOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (filterPaneRef.current?.contains(target) === true) {
        return;
      }

      if (filterToggleRef.current?.contains(target) === true) {
        return;
      }

      if (
        target instanceof Element &&
        target.closest('[role="menu"]') !== null
      ) {
        return;
      }

      setFilterPaneOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isFilterPaneOpen]);

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
  ]);

  return (
    <section
      data-inbox-list-root="true"
      className={cn(
        "relative shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white",
        activeContactId === null
          ? "flex w-full lg:w-[22rem]"
          : "hidden w-full lg:flex lg:w-[22rem]",
      )}
    >
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div
          className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-4`}
        >
          <h1 className={`min-w-0 flex-1 truncate ${TYPE.headingMd}`}>
            {headerTitle}
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Compose"
            aria-keyshortcuts="c"
            title="Compose"
            onClick={openNewDraft}
            className="size-8 shrink-0 text-slate-900 hover:bg-slate-100 hover:text-slate-950"
          >
            <PencilIcon aria-hidden="true" data-icon="inline-start" />
          </Button>
          <Button
            ref={filterToggleRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Filters"
            aria-controls="inbox-filter-list"
            aria-expanded={isFilterPaneOpen}
            title="Filters"
            onClick={toggleFilterPane}
            className={cn(
              "relative size-8 shrink-0",
              isFilterPaneOpen
                ? "bg-[#253746] text-white hover:bg-[#253746] hover:text-white"
                : hasActiveFilters
                  ? "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
                  : "text-slate-900 hover:bg-slate-100 hover:text-slate-950",
            )}
          >
            <FilterIcon aria-hidden="true" data-icon="inline-start" />
            {hasActiveFilters ? (
              <span
                aria-hidden="true"
                data-filter-active-indicator="true"
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full bg-sky-500 ring-2",
                  isFilterPaneOpen ? "ring-slate-900" : "ring-white",
                )}
              />
            ) : null}
          </Button>
        </div>

        <div className="px-4 py-2.5">
          <label
            className={`flex items-center gap-2 ${RADIUS.md} border border-slate-200 bg-white px-3 py-1.5 text-sm ${SHADOW.sm} ${TRANSITION.fast} focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300`}
          >
            <SearchIcon className="size-4 text-slate-400" />
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
                className="inline-flex size-4 items-center justify-center"
              >
                <LoaderIcon
                  aria-hidden="true"
                  className="size-3.5 animate-spin text-slate-400"
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
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        {isFilterPaneOpen ? (
          <InboxFilterList
            ref={filterPaneRef}
            id="inbox-filter-list"
            filters={currentList.filters}
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            onCollapse={() => {
              setFilterPaneOpen(false);
            }}
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
              ) : searchResultCount === 0 ? (
                <span className="text-slate-400">
                  No results for &ldquo;{search.query}&rdquo;
                </span>
              ) : (
                <>
                  <span className="font-medium text-slate-700">
                    {searchResultCount}
                  </span>{" "}
                  {searchResultCount === 1 ? "result" : "results"} for
                  &ldquo;{search.query}&rdquo;
                </>
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div ref={listViewportRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {shouldShowSearchSkeleton ? (
          <QueueLoadingSkeleton rowCount={3} label="Searching inbox" />
        ) : shouldShowInitialSkeleton ? (
          <QueueLoadingSkeleton />
        ) : isServerSearchActive && searchResult !== null ? (
          searchResultCount === 0 ? (
            <SearchEmptyState
              query={search.query}
              onClearSearch={clearSearch}
            />
          ) : (
            <UnifiedSearchResultList
              result={searchResult}
              activeContactId={activeContactId}
            />
          )
        ) : displayItems.length === 0 ? (
          <QueueEmptyState
            onSwitchToFollowUp={() => {
              handleFilterChange("follow-up");
            }}
          />
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
                  <QueueLoadMoreSkeleton />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function QueueEmptyState({
  onSwitchToFollowUp,
}: {
  readonly onSwitchToFollowUp: () => void;
}) {
  return (
    <EmptyState
      icon={<InboxIcon className="size-6" />}
      title="All caught up"
      description="No conversations match the current filter."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSwitchToFollowUp}
        >
          Switch to pending
        </Button>
      }
    />
  );
}

function SearchEmptyState({
  query,
  onClearSearch,
}: {
  readonly query: string;
  readonly onClearSearch: () => void;
}) {
  return (
    <EmptyState
      icon={<SearchXIcon className="size-6" />}
      title="No contacts match the search"
      description={
        <>
          Nothing matches &ldquo;{query}&rdquo;. Try a different name, email,
          or phone number.
        </>
      }
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearSearch}
        >
          Clear search
        </Button>
      }
    />
  );
}

/**
 * Two-section result list rendered when the inbox search bar is in unified
 * search mode. Top section — `volunteers` — shows matched contacts with at
 * least one membership in the existing full-row format. Bottom section —
 * `contacts` — shows matched contacts with zero memberships in a compact
 * single-line format. Section labels render only when both sections have
 * results; if only one is populated we render that section's rows without
 * a header.
 */
function UnifiedSearchResultList({
  result,
  activeContactId,
}: {
  readonly result: InboxUnifiedSearchViewModel;
  readonly activeContactId: string | null;
}) {
  const showSectionLabels =
    result.volunteers.length > 0 && result.contacts.length > 0;

  return (
    <div>
      {result.volunteers.length > 0 ? (
        <section aria-label="Volunteers">
          {showSectionLabels ? (
            <UnifiedSearchSectionHeader label="Volunteers" />
          ) : null}
          <ul className="divide-y divide-slate-100">
            {result.volunteers.map((row) => (
              <InboxUnifiedSearchRow
                key={row.contactId}
                row={row}
                isActive={row.contactId === activeContactId}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {result.contacts.length > 0 ? (
        <section aria-label="Contacts">
          {showSectionLabels ? (
            <UnifiedSearchSectionHeader label="Contacts" />
          ) : null}
          <ul className="divide-y divide-slate-100">
            {result.contacts.map((row) => (
              <InboxUnifiedSearchRow
                key={row.contactId}
                row={row}
                isActive={row.contactId === activeContactId}
                compact
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function UnifiedSearchSectionHeader({ label }: { readonly label: string }) {
  return (
    <div className="border-y border-slate-100 bg-slate-50 px-4 py-1.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </div>
    </div>
  );
}
