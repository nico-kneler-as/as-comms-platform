"use client";

import { TONE_CLASSES } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/section-label";

import type {
  InboxActiveProjectOption,
  InboxFilterId,
  InboxFilterViewModel,
} from "../_lib/view-models";
import { projectToneFromName } from "../_lib/project-tone";

const FILTER_TONE: Record<InboxFilterId, "slate" | "sky" | "amber" | "rose"> = {
  all: "slate",
  unread: "sky",
  "follow-up": "amber",
  unresolved: "rose",
  sent: "slate",
};

interface InboxFilterListProps {
  readonly filters: readonly InboxFilterViewModel[];
  readonly activeFilter: InboxFilterId;
  readonly onFilterChange: (id: InboxFilterId) => void;
  readonly projects: readonly InboxActiveProjectOption[];
  readonly selectedProjectId: string | null;
  readonly onProjectChange: (id: string | null) => void;
}

export function InboxFilterList({
  filters,
  activeFilter,
  onFilterChange,
  projects,
  selectedProjectId,
  onProjectChange,
}: InboxFilterListProps) {
  return (
    <div className="px-3 pb-3 pt-2">
      <SectionLabel as="h2" className="px-1 pb-1.5">
        State
      </SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {filters.map((filter) => {
          const tone = FILTER_TONE[filter.id];
          const isActive = filter.id === activeFilter;
          const showDot = !isActive && tone !== "slate";
          return (
            <li key={filter.id}>
              <button
                type="button"
                onClick={() => {
                  onFilterChange(filter.id);
                }}
                aria-pressed={isActive}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-150",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-50",
                )}
              >
                {showDot ? (
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_CLASSES[tone].dot}`}
                  />
                ) : (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0" />
                )}
                <span
                  className={cn(
                    "flex-1 truncate",
                    isActive ? "font-medium" : "",
                  )}
                >
                  {filter.label}
                </span>
                <span
                  className={cn(
                    "tabular-nums text-[11.5px]",
                    isActive ? "text-slate-300" : "text-slate-400",
                  )}
                >
                  {filter.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {projects.length > 0 ? (
        <>
          <SectionLabel as="h2" className="mt-3 border-t border-slate-100 px-1 pb-1.5 pt-3">
            Project
          </SectionLabel>
          <ul className="flex flex-col gap-0.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  onProjectChange(null);
                }}
                aria-pressed={selectedProjectId === null}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-150",
                  selectedProjectId === null
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0" />
                <span className="flex-1 truncate">All projects</span>
              </button>
            </li>
            {projects.map((project) => {
              const tone = projectToneFromName(project.name);
              const isActive = selectedProjectId === project.id;
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onProjectChange(project.id);
                    }}
                    aria-pressed={isActive}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-150",
                      isActive
                        ? "bg-slate-100 font-medium text-slate-900"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_CLASSES[tone].dot}`}
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/*
            TODO(B3): expose per-project unread + follow-up counts in the
            view-model so we can show them inline. With paginated data we
            can't compute accurately client-side; rather than show a
            misleading partial count we omit them.
          */}
        </>
      ) : null}
    </div>
  );
}
