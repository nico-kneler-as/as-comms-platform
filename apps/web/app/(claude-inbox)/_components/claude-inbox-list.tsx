"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models";
import { FilterIcon, SearchIcon } from "./claude-icons";
import { ClaudeInboxFiltersPopover } from "./claude-inbox-filters-popover";
import { ClaudeInboxRow } from "./claude-inbox-row";

interface ListColumnProps {
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly initialFilterId?: ClaudeInboxFilterId;
  readonly subtitle: string;
}

/**
 * Client island: owns local view state for the Inbox column — active filter
 * selection and filter-popover open/close. The underlying `items` and filter
 * counts originate server-side from the canonical projection selectors, so
 * no canonical state lives on the client.
 */
export function ClaudeInboxList({
  items,
  filters,
  initialFilterId = "new",
  subtitle
}: ListColumnProps) {
  const pathname = usePathname();
  const activeContactId = extractContactId(pathname);

  const [activeFilterId, setActiveFilterId] =
    useState<ClaudeInboxFilterId>(initialFilterId);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredItems = items.filter((item) =>
    matchesFilter(item, activeFilterId)
  );
  const activeFilter =
    filters.find((filter) => filter.id === activeFilterId) ?? null;
  const columnTitle = activeFilter?.label ?? "Inbox";

  return (
    <section className="relative flex w-[22rem] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Inbox · Claude prototype
            </p>
            <h1 className="mt-0.5 text-lg font-semibold text-slate-900">
              {columnTitle}
            </h1>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
            {filteredItems.length} people
          </span>
        </div>

        <div className="flex items-center gap-2 px-5 pb-4 pt-2">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300">
            <SearchIcon className="h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search people, subjects, projects"
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </label>

          <div className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              onClick={() => {
                setFiltersOpen((open) => !open);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition ${
                filtersOpen
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <FilterIcon className="h-3.5 w-3.5" />
              Filters
              {activeFilterId !== "all" && activeFilter ? (
                <span className="inline-flex items-center rounded-full bg-slate-900 px-1.5 py-px text-[10px] font-semibold text-white">
                  {activeFilter.label}
                </span>
              ) : null}
            </button>

            {filtersOpen ? (
              <ClaudeInboxFiltersPopover
                filters={filters}
                activeFilterId={activeFilterId}
                onSelect={(id) => {
                  setActiveFilterId(id);
                  setFiltersOpen(false);
                }}
                onClose={() => {
                  setFiltersOpen(false);
                }}
              />
            ) : null}
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

function matchesFilter(
  item: ClaudeInboxListItemViewModel,
  filterId: ClaudeInboxFilterId
): boolean {
  switch (filterId) {
    case "new":
      return item.bucket === "new";
    case "opened":
      return item.bucket === "opened";
    case "starred":
      return item.isStarred;
    case "unresolved":
      return item.hasUnresolved;
    case "all":
      return true;
  }
}
