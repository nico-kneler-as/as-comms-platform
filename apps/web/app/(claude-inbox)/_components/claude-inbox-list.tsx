"use client";

import type { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models";
import { Separator } from "@/components/ui/separator";
import { SectionLabel } from "@/components/ui/section-label";
import { EmptyState } from "@/components/ui/empty-state";

import { useClaudeInboxClient } from "./claude-inbox-client-provider";
import { FOCUS_RING, LAYOUT, RADIUS, SHADOW, TEXT, TRANSITION } from "@/app/_lib/design-tokens";
import {
  CornerUpLeftIcon,
  FilterIcon,
  InboxIcon,
  MailIcon,
  SearchIcon,
  SearchXIcon,
  XIcon
} from "./claude-icons";
import { QueueLoadingSkeleton } from "./claude-inbox-loading";
import { ClaudeInboxRow } from "./claude-inbox-row";

interface ListColumnProps {
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly initialFilterId?: ClaudeInboxFilterId;
}

const FILTER_ICONS: Record<ClaudeInboxFilterId, LucideIcon> = {
  all: InboxIcon,
  unread: MailIcon,
  "follow-up": CornerUpLeftIcon
};

type ActiveFilter =
  | { readonly kind: "base"; readonly id: ClaudeInboxFilterId }
  | { readonly kind: "project"; readonly label: string };

export function ClaudeInboxList({
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
  } = useClaudeInboxClient();

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>({
    kind: "base",
    id: initialFilterId
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const followUpCount = items.filter((item) =>
    followUp.has(item.contactId)
  ).length;
  const filtersWithLiveCounts = filters.map((filter) =>
    filter.id === "follow-up" ? { ...filter, count: followUpCount } : filter
  );

  const projectBuckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.projectLabel) {
        counts.set(item.projectLabel, (counts.get(item.projectLabel) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  // Apply filters: base/project filter → search
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

  const columnTitle =
    activeFilter.kind === "base"
      ? (filtersWithLiveCounts.find((filter) => filter.id === activeFilter.id)
          ?.label ?? "Inbox")
      : activeFilter.label;

  const isFilterActive =
    activeFilter.kind === "project" || activeFilter.id !== "all";

  return (
    <section className={`relative flex ${LAYOUT.listWidth} shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white`}>
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        {/* Header */}
        <div className={`flex ${LAYOUT.headerHeight} items-center gap-2 border-b border-slate-200 px-5`}>
          <h1 className={`min-w-0 flex-1 truncate ${TEXT.headingLg}`}>
            {columnTitle}
          </h1>
          <button
            type="button"
            aria-label="Filter"
            aria-expanded={filtersOpen}
            aria-controls="claude-inbox-filters-panel"
            onClick={() => {
              setFiltersOpen((open) => !open);
            }}
            className={`relative inline-flex h-8 w-8 items-center justify-center ${RADIUS.md} border ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
              filtersOpen
                ? "border-slate-300 bg-slate-100 text-slate-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <FilterIcon className="h-4 w-4" />
            {isFilterActive ? (
              <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-white">
                1
              </span>
            ) : null}
          </button>
        </div>

        {/* Search bar */}
        <div className="px-5 pb-4 pt-3">
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

        {/* Filter disclosure panel */}
        <div
          id="claude-inbox-filters-panel"
          aria-hidden={!filtersOpen}
          className={`grid overflow-hidden border-slate-200 ${TRANSITION.layout} ${TRANSITION.reduceMotion} ${
            filtersOpen
              ? "grid-rows-[1fr] border-t opacity-100"
              : "grid-rows-[0fr] border-t-0 opacity-0"
          }`}
        >
          <div className="min-h-0">
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              <ul className="space-y-0.5">
                {filtersWithLiveCounts.map((filter) => {
                  const Icon = FILTER_ICONS[filter.id];
                  const isActive =
                    activeFilter.kind === "base" &&
                    activeFilter.id === filter.id;
                  return (
                    <li key={filter.id}>
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          setActiveFilter({ kind: "base", id: filter.id });
                          setFiltersOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 ${RADIUS.md} px-2.5 py-1.5 text-left text-sm ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
                          isActive
                            ? "bg-slate-900 font-semibold text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{filter.label}</span>
                        <span
                          className={`text-xs tabular-nums ${
                            isActive ? "text-white" : "text-slate-500"
                          }`}
                        >
                          {filter.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {projectBuckets.length > 0 ? (
                <>
                  <Separator className="my-3 bg-slate-100" />
                  <SectionLabel as="p" className="mb-1 px-2.5">
                    Projects
                  </SectionLabel>
                  <ul className="space-y-0.5">
                    {projectBuckets.map((bucket) => {
                      const isActive =
                        activeFilter.kind === "project" &&
                        activeFilter.label === bucket.label;
                      return (
                        <li key={bucket.label}>
                          <button
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => {
                              setActiveFilter({
                                kind: "project",
                                label: bucket.label
                              });
                              setFiltersOpen(false);
                            }}
                            className={`flex w-full items-center gap-2.5 ${RADIUS.md} px-2.5 py-1.5 text-left text-sm ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
                              isActive
                                ? "bg-slate-900 font-semibold text-white"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            }`}
                          >
                            <span className="flex-1 truncate">
                              {bucket.label}
                            </span>
                            <span
                              className={`text-xs tabular-nums ${
                                isActive ? "text-white" : "text-slate-500"
                              }`}
                            >
                              {bucket.count}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </div>
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
              <ClaudeInboxRow
                key={item.contactId}
                item={item}
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
  item: ClaudeInboxListItemViewModel,
  activeFilter: ActiveFilter,
  followUp: ReadonlySet<string>
): boolean {
  if (activeFilter.kind === "project") {
    return item.projectLabel === activeFilter.label;
  }
  switch (activeFilter.id) {
    case "all":
      return true;
    case "unread":
      return item.unreadCount > 0;
    case "follow-up":
      return followUp.has(item.contactId);
  }
}
