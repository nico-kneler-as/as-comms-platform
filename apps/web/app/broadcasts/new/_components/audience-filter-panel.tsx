"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";

import {
  FOCUS_RING,
  TONE_CLASSES,
  TRANSITION,
  type ToneNameV2,
} from "@/app/_lib/design-tokens-v2";
import {
  residenceStateNames,
  type ExpeditionMemberStatus,
  type ResidenceStateCode,
} from "@as-comms/contracts";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type {
  AudienceStatusCounts,
  CampaignProjectOption,
} from "../../_lib/audience-data-source";
import type { CampaignAudienceCriteria } from "./audience-builder-step";

const STAGE_GROUPS = {
  lead: {
    color: "amber",
    statuses: ["Lead"],
  },
  top: {
    color: "emerald",
    statuses: [
      "Waitlist",
      "Applied",
      "Pending Acceptance",
      "Accepted",
      "Confirmed",
      "In Training",
    ],
  },
  mid: {
    color: "sky",
    statuses: ["In Progress", "Trip Planning", "In the Field"],
  },
  bottom: {
    color: "violet",
    statuses: ["Successful", "Completed", "Returning Gear"],
  },
  off: {
    color: "rose",
    statuses: ["Denied", "Aborted", "Soft Denied", "Failed"],
  },
} as const satisfies Record<
  string,
  {
    readonly color: ToneNameV2;
    readonly statuses: readonly ExpeditionMemberStatus[];
  }
>;

interface AudienceFilterPanelProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly singleSelectProjects?: boolean;
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly statusCountsLoading: boolean;
  readonly statusCountsErrorMessage: string | null;
  readonly stateCounts?: AudienceStateCounts;
  readonly stateCountsLoading?: boolean;
  readonly stateCountsErrorMessage?: string | null;
  readonly showProjectSection?: boolean;
  readonly showStatusSection?: boolean;
  readonly showStateSection?: boolean;
  readonly subscriptionBoxMode?: boolean;
  readonly onProjectChange: (projectId: string) => void;
  readonly onToggleAllStatuses: (selectAll: boolean) => void;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
  readonly onStateToggle?: (code: ResidenceStateCode) => void;
  readonly onClearStates?: () => void;
}

export interface AudienceStateCounts {
  readonly byState: readonly {
    readonly code: ResidenceStateCode;
    readonly count: number;
  }[];
  readonly noStateOnFile: number;
  readonly total: number;
  readonly lastSyncedAt: string | null;
}

const EMPTY_STATE_COUNTS: AudienceStateCounts = {
  byState: [],
  noStateOnFile: 0,
  total: 0,
  lastSyncedAt: null,
};

export function AudienceFilterPanel({
  criteria,
  projectOptions,
  singleSelectProjects = false,
  statusOptions,
  statusCounts,
  statusCountsLoading,
  statusCountsErrorMessage,
  stateCounts = EMPTY_STATE_COUNTS,
  stateCountsLoading = false,
  stateCountsErrorMessage = null,
  showProjectSection = true,
  showStatusSection = true,
  showStateSection = true,
  subscriptionBoxMode = false,
  onProjectChange,
  onToggleAllStatuses,
  onStatusToggle,
  onStateToggle = () => undefined,
  onClearStates = () => undefined,
}: AudienceFilterPanelProps) {
  const selectedProjectIds = [
    ...(criteria.projectId == null ? [] : [criteria.projectId]),
    ...criteria.projectIds,
  ].filter((projectId, index, values) => values.indexOf(projectId) === index);
  const selectedProjectIdSet = new Set(selectedProjectIds);
  const knownStatuses = new Set(statusOptions);
  const projectHelperText = singleSelectProjects
    ? "Pick exactly one active project."
    : (projectOptions[0]?.aliasHint ?? null) === null
      ? null
      : projectOptions.length === 1
        ? `Inherited from ${projectOptions[0]?.aliasHint ?? ""}`
        : `Inherited from ${projectOptions[0]?.aliasHint ?? ""} · pick one or more sub-projects`;
  const hasSingleLockedProject =
    !singleSelectProjects && projectOptions.length === 1;
  const shouldRenderStatusShell =
    selectedProjectIds.length > 0 && statusCountsLoading;
  const hasProjectWithoutSubscriptionBox =
    subscriptionBoxMode &&
    selectedProjectIds.some(
      (projectId) =>
        projectOptions.find((project) => project.id === projectId)
          ?.hasSubscriptionBox === false,
    );

  const stageSections = Object.values(STAGE_GROUPS)
    .map((group) => {
      const statuses = group.statuses.filter((status) => {
        return (
          knownStatuses.has(status) &&
          (shouldRenderStatusShell || (statusCounts[status] ?? 0) > 0)
        );
      });

      return {
        ...group,
        statuses,
      };
    })
    .filter((group) => group.statuses.length > 0);

  const visibleStatuses = stageSections.flatMap((group) => group.statuses);
  const allVisibleStatusesSelected =
    visibleStatuses.length > 0 &&
    visibleStatuses.every((status) => criteria.statuses.includes(status));

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">Audience filters</h3>
      </div>

      <div className="space-y-7 px-4 py-4">
        {showProjectSection ? (
          <FilterSection
            title="Project"
            aside={projectHelperText}
          >
            <div className="flex flex-wrap gap-2">
              {projectOptions.map((project) =>
                hasSingleLockedProject ? (
                  <LockedProjectRow key={project.id} project={project} />
                ) : (
                  <ProjectOptionRow
                    key={project.id}
                    project={project}
                    selected={selectedProjectIdSet.has(project.id)}
                    onSelect={onProjectChange}
                  />
                ),
              )}
            </div>
            {hasProjectWithoutSubscriptionBox ? (
              <p className="mt-3 text-[12px] text-slate-500">
                This project has no subscription box in Salesforce, so this
                audience comes from Expedition Members.
              </p>
            ) : null}
          </FilterSection>
        ) : null}

        {showStatusSection ? (
          <FilterSection
            title="Member status"
            action={
              selectedProjectIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    onToggleAllStatuses(!allVisibleStatusesSelected);
                  }}
                  className={cn(
                    `text-[11.5px] font-medium text-slate-500 ${TRANSITION.fast} ${FOCUS_RING}`,
                    "hover:text-slate-900",
                  )}
                >
                  {allVisibleStatusesSelected ? "Unselect all" : "Select all"}
                </button>
              ) : null
            }
          >
            {statusCountsErrorMessage !== null ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {statusCountsErrorMessage}
              </div>
            ) : null}

            {selectedProjectIds.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] italic text-slate-500">
                Select at least one project above to see member statuses.
              </div>
            ) : !statusCountsLoading && stageSections.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-500">
                No populated member statuses were found for the selected
                projects.
              </div>
            ) : (
              <div className="space-y-5">
                {stageSections.map((group) => (
                  <StageStatusSection
                    key={group.color}
                    color={group.color}
                    selectedStatuses={criteria.statuses}
                    statusCounts={statusCounts}
                    statuses={group.statuses}
                    onStatusToggle={onStatusToggle}
                  />
                ))}
              </div>
            )}
          </FilterSection>
        ) : null}

        {showStateSection &&
        (selectedProjectIds.length > 0 ||
          (!showProjectSection && !showStatusSection)) ? (
          <AudienceStateFilterSection
            selectedStates={criteria.states ?? []}
            stateCounts={stateCounts}
            loading={stateCountsLoading}
            errorMessage={stateCountsErrorMessage}
            onToggle={onStateToggle}
            onClear={onClearStates}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AudienceStateFilterSection({
  selectedStates,
  stateCounts,
  loading,
  errorMessage,
  onToggle,
  onClear,
}: {
  readonly selectedStates: readonly ResidenceStateCode[];
  readonly stateCounts: AudienceStateCounts;
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly onToggle: (code: ResidenceStateCode) => void;
  readonly onClear: () => void;
}) {
  const populatedStates = stateCounts.byState
    .filter((state) => state.count > 0)
    .toSorted((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  const topStates = populatedStates.slice(0, 10);
  const visibleCodes = new Set(topStates.map((state) => state.code));
  const countsByCode = new Map(
    stateCounts.byState.map((state) => [state.code, state.count]),
  );
  const selectedOutsideTop = selectedStates
    .filter((code) => !visibleCodes.has(code))
    .map((code) => ({ code, count: countsByCode.get(code) ?? 0 }));
  const visibleStates = [...topStates, ...selectedOutsideTop];
  const visibleStateCodes = new Set(visibleStates.map((state) => state.code));
  const remainingStates = populatedStates.filter(
    (state) => !visibleStateCodes.has(state.code),
  );

  return (
    <FilterSection
      title="State"
      action={
        selectedStates.length > 0 ? (
          <button
            type="button"
            aria-label="Clear states"
            onClick={() => {
              onClear();
            }}
            className={cn(
              `text-[11.5px] font-medium text-slate-500 ${TRANSITION.fast} ${FOCUS_RING}`,
              "hover:text-slate-900",
            )}
          >
            Clear
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Loading state counts">
          {["w-16", "w-24", "w-20", "w-28"].map((width) => (
            <span
              key={width}
              className={cn("h-7 animate-pulse rounded-full bg-slate-100", width)}
            />
          ))}
        </div>
      ) : errorMessage !== null ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {errorMessage}
        </div>
      ) : stateCounts.lastSyncedAt === null ? (
        <p className="text-[12px] text-slate-500">
          State data hasn&apos;t synced from Salesforce yet.
        </p>
      ) : stateCounts.byState.length === 0 ? (
        <p className="text-[12px] text-slate-500">
          No one in this audience has a state on file.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {visibleStates.map(({ code, count }) => (
              <StatePill
                key={code}
                code={code}
                count={count}
                selected={selectedStates.includes(code)}
                onToggle={onToggle}
              />
            ))}
            {remainingStates.length > 0 ? (
              <StatePickerMenu states={remainingStates} onSelect={onToggle} />
            ) : null}
          </div>
          {selectedStates.length > 0 && stateCounts.noStateOnFile > 0 ? (
            <p className="mt-3 text-[12px] text-slate-500">
              {stateCounts.noStateOnFile.toLocaleString("en-US")} {stateCounts.noStateOnFile === 1 ? "person" : "people"} with no state on file {stateCounts.noStateOnFile === 1 ? "is" : "are"} left out.
            </p>
          ) : null}
        </>
      )}
    </FilterSection>
  );
}

function StatePill({
  code,
  count,
  selected,
  onToggle,
}: {
  readonly code: ResidenceStateCode;
  readonly count: number;
  readonly selected: boolean;
  readonly onToggle: (code: ResidenceStateCode) => void;
}) {
  const name = residenceStateNames[code];

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Toggle state ${name} (${code})`}
      onClick={() => {
        onToggle(code);
      }}
      className={cn(
        `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset ${TRANSITION.fast} ${FOCUS_RING}`,
        selected
          ? "bg-slate-900 text-white ring-slate-900 shadow-sm"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {selected ? (
        <Check className="size-2.5 shrink-0" aria-hidden="true" />
      ) : null}
      <span>{name}</span>
      <span className={cn("tabular-nums text-[11.5px]", selected ? "text-white/90" : "text-slate-500/90")}>
        {count.toLocaleString("en-US")}
      </span>
    </button>
  );
}

function StatePickerMenu({
  states,
  onSelect,
}: {
  readonly states: readonly { readonly code: ResidenceStateCode; readonly count: number }[];
  readonly onSelect: (code: ResidenceStateCode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add another state"
          className={cn(
            `inline-flex size-7 items-center justify-center rounded-full bg-white text-slate-600 ring-1 ring-inset ring-slate-200 ${TRANSITION.fast} ${FOCUS_RING}`,
            "hover:bg-slate-50 hover:text-slate-900",
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5" sideOffset={6}>
        <div className="max-h-64 overflow-y-auto">
          {states.map(({ code, count }) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                onSelect(code);
                setOpen(false);
              }}
              className={cn(
                `flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[12px] text-slate-700 ${TRANSITION.fast} ${FOCUS_RING}`,
                "hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <span>{residenceStateNames[code]}</span>
              <span className="tabular-nums text-slate-500">
                · {count.toLocaleString("en-US")}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterSection({
  title,
  aside,
  action,
  children,
}: {
  readonly title: string;
  readonly aside?: string | null;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <h4 className="pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h4>
        {action ?? aside ? (
          <div className="min-w-0 text-right">
            {action ?? (
              <p className="text-pretty text-[11px] leading-5 text-slate-500">
                {aside}
              </p>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ProjectOptionRow({
  project,
  selected,
  onSelect,
}: {
  readonly project: CampaignProjectOption;
  readonly selected: boolean;
  readonly onSelect: (projectId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Choose project ${project.name}`}
      aria-pressed={selected}
      onClick={() => {
        onSelect(project.id);
      }}
      className={cn(
        `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 ring-inset ${TRANSITION.fast} ${FOCUS_RING}`,
        selected
          ? "bg-slate-900 text-white ring-slate-900 shadow-sm"
          : "bg-slate-100 text-slate-700 ring-slate-300 hover:bg-slate-200",
      )}
    >
      {selected ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
      )}
      <span className="max-w-full truncate">{project.name}</span>
    </button>
  );
}

function LockedProjectRow({
  project,
}: {
  readonly project: CampaignProjectOption;
}) {
  return (
    <span
      role="status"
      aria-label={`Project ${project.name} is locked to this sender alias`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium shadow-sm ring-1 ring-inset ring-transparent",
        "bg-slate-900 text-white",
      )}
    >
      <Check className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

function StageStatusSection({
  color,
  statuses,
  statusCounts,
  selectedStatuses,
  onStatusToggle,
}: {
  readonly color: ToneNameV2;
  readonly statuses: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly selectedStatuses: readonly ExpeditionMemberStatus[];
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
}) {
  const tone = TONE_CLASSES[color];

  return (
    <section>
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((status) => {
          const selected = selectedStatuses.includes(status);
          const countForStatus = statusCounts[status] ?? 0;

          return (
            <button
              key={status}
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Toggle expedition-member status ${status}`}
              onClick={() => {
                onStatusToggle(status);
              }}
              className={cn(
                `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset ${TRANSITION.fast} ${FOCUS_RING}`,
                selected
                  ? `${tone.bg} text-white ring-transparent`
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {selected ? (
                <Check className="size-2.5 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
                  aria-hidden="true"
                />
              )}
              <span>{status}</span>
              <span
                className={cn(
                  "tabular-nums text-[11.5px]",
                  selected ? "text-white/90" : "text-slate-500/90",
                )}
              >
                {countForStatus.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
