"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import type {
  InboxFilterId,
  InboxFilterViewModel,
  InboxListItemViewModel
} from "../_lib/view-models";
import { resolveNeedsFollowUp } from "../_lib/follow-up-state";
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
  readonly items: readonly InboxListItemViewModel[];
  readonly filters: readonly InboxFilterViewModel[];
  readonly initialFilterId?: InboxFilterId;
}

export function InboxList({
  items,
  filters,
  initialFilterId = "all"
}: ListColumnProps) {
  const pathname = usePathname();
  const activeContactId = extractContactId(pathname);
  const {
    followUp,
    search,
    setSearchQuery,
    clearSearch,
    isQueueLoading
  } = useInboxClient();

  const [activeFilter, setActiveFilter] = useState<InboxFilterId>(initialFilterId);
  const filterLabels = useMemo(
    () =>
      new Map(filters.map((filter) => [filter.id, filter.label] as const)),
    [filters]
  );

  // Compute filter counts from base projection state + local overrides.
  const filterCounts = useMemo(() => {
    let unread = 0;
    let followUpCount = 0;
    let unresolved = 0;
    for (const item of items) {
      if (item.bucket === "new") unread++;
      if (resolveNeedsFollowUp(item.contactId, item.needsFollowUp, followUp)) {
        followUpCount++;
      }
      if (item.hasUnresolved) unresolved++;
    }
    return {
      all: items.length,
      unread,
      "follow-up": followUpCount,
      unresolved
    };
  }, [items, followUp]);

  // Apply filters: active filter -> search
  const filteredItems = useMemo(() => {
    let result = items.filter((item) =>
      matchesActiveFilter(item, activeFilter, followUp)
    );

    // Search filter
    if (search.isActive && search.resultContactIds.length > 0) {
      const ids = new Set(search.resultContactIds);
      result = result.filter((item) => ids.has(item.contactId));
    }

    return result;
  }, [items, activeFilter, followUp, search]);

  // For local search simulation: filter by query string matching
  const searchFilteredItems = useMemo(() => {
    if (!search.isActive || search.query.length === 0) return filteredItems;
    const q = search.query.toLowerCase();
    return filteredItems.filter(
      (item) =>
        item.displayName.toLowerCase().includes(q) ||
        item.latestSubject.toLowerCase().includes(q) ||
        item.snippet.toLowerCase().includes(q) ||
        (item.projectLabel?.toLowerCase().includes(q) ?? false)
    );
  }, [filteredItems, search]);

  const displayItems = search.isActive ? searchFilteredItems : filteredItems;

  const filterIds: readonly InboxFilterId[] = ["all", "unread", "follow-up", "unresolved"];

  return (
    <section className={`relative flex ${LAYOUT.listWidth} shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white`}>
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        {/* Header */}
        <div className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-5`}>
          <h1 className={`min-w-0 flex-1 truncate ${TEXT.headingLg}`}>
            Inbox
          </h1>
        </div>

        {/* Search bar */}
        <div className="px-5 pb-3 pt-3">
          <label className={`flex items-center gap-2 ${RADIUS.md} border border-slate-200 bg-white px-3 py-1.5 text-sm ${SHADOW.sm} ${TRANSITION.fast} focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300`}>
            <SearchIcon className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search people, subjects, projects"
              value={search.query}
              onChange={(e) => {
                const target = e.currentTarget as unknown as {
                  readonly value: string;
                };
                setSearchQuery(target.value);
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

        {/* Inline filter chips */}
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {filterIds.map((id) => {
            const isActive = activeFilter === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setActiveFilter(id);
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

        {/* Search active indicator */}
        {search.isActive ? (
          <div className="border-t border-slate-100 px-5 py-2">
            <p className="text-xs text-slate-500">
              {searchFilteredItems.length === 0 ? (
                <span className="text-slate-400">
                  No results for &ldquo;{search.query}&rdquo;
                </span>
              ) : (
                <>
                  <span className="font-medium text-slate-700">
                    {searchFilteredItems.length}
                  </span>{" "}
                  {searchFilteredItems.length === 1 ? "result" : "results"} for
                  &ldquo;{search.query}&rdquo;
                </>
              )}
            </p>
          </div>
        ) : null}
      </div>

      {/* List body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isQueueLoading ? (
          <QueueLoadingSkeleton />
        ) : search.isActive && searchFilteredItems.length === 0 ? (
          <SearchEmptyState query={search.query} />
        ) : displayItems.length === 0 ? (
          <QueueEmptyState />
        ) : (
          <ul className="divide-y divide-slate-100">
            {displayItems.map((item) => (
              <InboxRow
                key={item.contactId}
                item={{
                  ...item,
                  needsFollowUp: resolveNeedsFollowUp(
                    item.contactId,
                    item.needsFollowUp,
                    followUp
                  )
                }}
                isActive={item.contactId === activeContactId}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------- Empty states ----------

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
      description={<>Nothing matches &ldquo;{query}&rdquo;. Try a different search.</>}
    />
  );
}

// ---------- Helpers ----------

function extractContactId(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/inbox\/([^/]+)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

function matchesActiveFilter(
  item: InboxListItemViewModel,
  activeFilter: InboxFilterId,
  followUp: ReadonlyMap<string, boolean>
): boolean {
  switch (activeFilter) {
    case "all":
      return true;
    case "unread":
      return item.bucket === "new";
    case "follow-up":
      return resolveNeedsFollowUp(item.contactId, item.needsFollowUp, followUp);
    case "unresolved":
      return item.hasUnresolved;
  }
}
