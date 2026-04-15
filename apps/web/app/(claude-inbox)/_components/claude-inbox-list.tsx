"use client";

import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { useMemo, useState } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models";
import { useClaudeInboxClient } from "./claude-inbox-client-provider";
import {
  CornerUpLeftIcon,
  FilterIcon,
  InboxIcon,
  MailIcon,
  SearchIcon
} from "./claude-icons";
import { ClaudeInboxRow } from "./claude-inbox-row";

interface ListColumnProps {
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly initialFilterId?: ClaudeInboxFilterId;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FILTER_ICONS: Record<ClaudeInboxFilterId, IconComponent> = {
  all: InboxIcon,
  unread: MailIcon,
  "follow-up": CornerUpLeftIcon
};

/**
 * Internal active-filter state. The disclosure panel lets the operator pick
 * one of the base filters OR one of the project buckets derived from the
 * current `items` list. The two are mutually exclusive so there's only ever
 * one active selection.
 */
type ActiveFilter =
  | { readonly kind: "base"; readonly id: ClaudeInboxFilterId }
  | { readonly kind: "project"; readonly label: string };

/**
 * Client island: owns local view state for the Inbox column — active filter
 * selection and the inline filter-panel open/close. The underlying `items`
 * flow from the server-side selector; follow-up flags come from the shared
 * client context so the list updates the moment the operator toggles the
 * button over in the detail view.
 */
export function ClaudeInboxList({
  items,
  filters,
  initialFilterId = "all"
}: ListColumnProps) {
  const pathname = usePathname();
  const activeContactId = extractContactId(pathname);
  const { followUp } = useClaudeInboxClient();

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>({
    kind: "base",
    id: initialFilterId
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Follow-up is client state, so we recompute its count here instead of
  // trusting the server placeholder.
  const followUpCount = items.filter((item) =>
    followUp.has(item.contactId)
  ).length;
  const filtersWithLiveCounts = filters.map((filter) =>
    filter.id === "follow-up" ? { ...filter, count: followUpCount } : filter
  );

  // Derive the project buckets from the current items list. Each distinct
  // `projectLabel` becomes a filter option; null labels are excluded.
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

  const filteredItems = items.filter((item) =>
    matchesActiveFilter(item, activeFilter, followUp)
  );

  const columnTitle =
    activeFilter.kind === "base"
      ? (filtersWithLiveCounts.find((filter) => filter.id === activeFilter.id)
          ?.label ?? "Inbox")
      : activeFilter.label;

  const isFilterActive =
    activeFilter.kind === "project" || activeFilter.id !== "all";

  return (
    <section className="relative flex w-[22rem] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div className="flex h-[65px] items-center gap-2 border-b border-slate-200 px-5">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900">
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
            className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
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

        <div className="px-5 pb-4 pt-3">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm transition-colors duration-150 focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300">
            <SearchIcon className="h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search people, subjects, projects"
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </label>
        </div>

        {/*
          Inline disclosure panel: rendered as a sibling below the search row
          but still inside the sticky header. We animate `grid-template-rows`
          from 0fr → 1fr, a shadcn/Radix-style collapse trick that works with
          pure Tailwind and keeps the panel's intrinsic height. The panel
          holds the base filters on top and a PROJECTS section underneath,
          derived from the active project labels in the current list.
        */}
        <div
          id="claude-inbox-filters-panel"
          aria-hidden={!filtersOpen}
          className={`grid overflow-hidden border-slate-200 transition-all duration-200 ease-out motion-reduce:transition-none ${
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
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
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
                  <div
                    role="separator"
                    className="my-3 border-t border-slate-100"
                  />
                  <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Projects
                  </p>
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
                            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">Nothing to show</p>
            <p className="mt-1 text-xs text-slate-500">
              Try a different filter, or wait for new activity.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredItems.map((item) => (
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
