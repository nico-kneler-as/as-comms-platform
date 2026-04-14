"use client";

import type { ComponentType, SVGProps } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel
} from "../_lib/view-models";
import { AlertIcon, InboxIcon, StarIcon, UsersIcon } from "./claude-icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FILTER_ICONS: Record<ClaudeInboxFilterId, IconComponent> = {
  new: InboxIcon,
  opened: InboxIcon,
  starred: StarIcon,
  unresolved: AlertIcon,
  all: UsersIcon
};

interface Project {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const PROJECTS: readonly Project[] = [
  { id: "wolverine", name: "Wolverine Watch 2025", count: 2 },
  { id: "pika", name: "Alpine Pika Survey", count: 1 },
  { id: "kelp", name: "Coastal Kelp Monitoring", count: 1 },
  { id: "otter", name: "River Otter Distribution", count: 1 }
];

interface FiltersPopoverProps {
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly activeFilterId: ClaudeInboxFilterId;
  readonly onSelect: (id: ClaudeInboxFilterId) => void;
  readonly onClose: () => void;
}

export function ClaudeInboxFiltersPopover({
  filters,
  activeFilterId,
  onSelect,
  onClose
}: FiltersPopoverProps) {
  return (
    <>
      {/*
        Invisible full-screen backdrop that dismisses the popover when the
        operator clicks anywhere outside it. Using a <button> keeps click
        semantics accessible without pulling in DOM event listener types.
      */}
      <button
        type="button"
        aria-label="Dismiss filters"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default bg-transparent"
      />
      <div
        role="dialog"
        aria-label="Inbox filters"
        className="absolute right-0 top-full z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ring-1 ring-black/5"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Inbox
          </p>
          <ul className="mt-2 space-y-0.5">
            {filters.map((filter) => {
              const Icon = FILTER_ICONS[filter.id];
              const isActive = filter.id === activeFilterId;
              return (
                <li key={filter.id}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      onSelect(filter.id);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                      isActive
                        ? "bg-slate-900 font-semibold text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{filter.label}</span>
                    <span
                      className={`text-xs tabular-nums ${
                        isActive ? "text-white" : "text-slate-400"
                      }`}
                    >
                      {filter.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Projects
          </p>
          <ul className="mt-2 space-y-0.5">
            {PROJECTS.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <span className="truncate">{project.name}</span>
                  <span className="text-xs text-slate-400 tabular-nums">
                    {project.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
