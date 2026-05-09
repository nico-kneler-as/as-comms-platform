"use client";

import { SHADOW, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/section-label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LucideIcon } from "lucide-react";

import type {
  InboxActiveProjectOption,
  InboxFilterId,
  InboxFilterViewModel,
} from "../_lib/view-models";
import {
  ArchiveBoxIcon,
  ChevronDownIcon,
  FlagIcon,
  InboxIcon,
  MailOpenIcon,
  SendIcon,
} from "./icons";

const FILTER_ICON: Record<InboxFilterId, LucideIcon | null> = {
  inbox: InboxIcon,
  unread: MailOpenIcon,
  "follow-up": FlagIcon,
  sent: SendIcon,
  archived: ArchiveBoxIcon,
};

interface InboxFilterListProps {
  readonly id?: string;
  readonly filters: readonly InboxFilterViewModel[];
  readonly activeFilter: InboxFilterId;
  readonly onFilterChange: (id: InboxFilterId) => void;
  readonly onCollapse: () => void;
  readonly projects: readonly InboxActiveProjectOption[];
  readonly selectedProjectId: string | null;
  readonly onProjectChange: (id: string | null) => void;
}

export function InboxFilterList({
  id,
  filters,
  activeFilter,
  onFilterChange,
  onCollapse,
  projects,
  selectedProjectId,
  onProjectChange,
}: InboxFilterListProps) {
  const filterById = new Map(filters.map((filter) => [filter.id, filter]));
  const primaryFilters = ["inbox", "unread", "follow-up"] as const;
  const secondaryFilters = ["archived", "sent"] as const;
  const selectedProject =
    selectedProjectId === null
      ? null
      : (projects.find((project) => project.id === selectedProjectId) ?? null);
  const selectedProjectLabel =
    selectedProject === null
      ? "All projects"
      : (selectedProject.alias ?? selectedProject.name);

  return (
    <div
      id={id}
      className={cn(
        "animate-in slide-in-from-top-1 border-t border-slate-100 bg-white pb-3 duration-150 fade-in",
        "motion-reduce:animate-none",
        SHADOW.md,
        TRANSITION.reduceMotion,
      )}
    >
      <SectionLabel
        as="h2"
        className="px-5 pb-2 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400"
      >
        State
      </SectionLabel>
      <ul className="flex flex-col gap-0.5 px-3">
        {primaryFilters.map((filterId) => {
          const filter = filterById.get(filterId);

          return filter === undefined ? null : (
            <li key={filter.id}>
              <FilterRow
                filter={filter}
                activeFilter={activeFilter}
                onFilterChange={onFilterChange}
                onCollapse={onCollapse}
              />
            </li>
          );
        })}
      </ul>

      <div className="my-2 border-t border-slate-100" />

      <ul className="flex flex-col gap-0.5 px-3">
        {secondaryFilters.map((filterId) => {
          const filter = filterById.get(filterId);

          return filter === undefined ? null : (
            <li key={filter.id}>
              <FilterRow
                filter={filter}
                activeFilter={activeFilter}
                onFilterChange={onFilterChange}
                onCollapse={onCollapse}
              />
            </li>
          );
        })}
      </ul>

      {projects.length > 0 ? (
        <>
          <div className="my-2 border-t border-slate-100" />
          <div className="px-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] text-slate-700 transition-colors duration-150 hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 truncate",
                      selectedProject !== null || selectedProjectId === null
                        ? "font-medium text-slate-900"
                        : "",
                    )}
                  >
                    {selectedProjectLabel}
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-slate-400"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-xl p-1.5"
                sideOffset={6}
              >
                <DropdownMenuRadioGroup
                  value={selectedProjectId ?? "__all__"}
                  onValueChange={(value) => {
                    onProjectChange(value === "__all__" ? null : value);
                  }}
                >
                  <DropdownMenuRadioItem
                    value="__all__"
                    className="rounded-lg text-[12.5px]"
                  >
                    All projects
                  </DropdownMenuRadioItem>
                  {projects.map((project) => (
                    <DropdownMenuRadioItem
                      key={project.id}
                      value={project.id}
                      className="rounded-lg text-[12.5px]"
                    >
                      {project.alias ?? project.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FilterRow(input: {
  readonly filter: InboxFilterViewModel;
  readonly activeFilter: InboxFilterId;
  readonly onFilterChange: (id: InboxFilterId) => void;
  readonly onCollapse: () => void;
}) {
  const isActive = input.filter.id === input.activeFilter;
  const Icon = FILTER_ICON[input.filter.id];

  if (Icon === null) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        input.onFilterChange(input.filter.id);
        input.onCollapse();
      }}
      aria-pressed={isActive}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-150",
        isActive
          ? "bg-[#abb8c3] text-slate-900"
          : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className={cn("flex-1 truncate", isActive ? "font-medium" : "")}>
        {input.filter.label}
      </span>
      {input.filter.count === null ? null : (
        <span
          className={cn(
            "tabular-nums text-[11.5px]",
            isActive ? "text-slate-300" : "text-slate-400",
          )}
        >
          {input.filter.count}
        </span>
      )}
    </button>
  );
}
