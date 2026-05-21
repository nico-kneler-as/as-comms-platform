"use client";

import { Check } from "lucide-react";

import {
  FOCUS_RING,
  TONE_CLASSES,
  TRANSITION,
  type ToneClassesV2,
  type ToneNameV2,
} from "@/app/_lib/design-tokens-v2";
import type { ExpeditionMemberStatus } from "@as-comms/contracts";

import { cn } from "@/lib/utils";

import type {
  AudienceStatusCounts,
  CampaignProjectOption,
} from "../../_lib/audience-data-source";
import type { CampaignAudienceCriteria } from "./audience-builder-step";

const STAGE_GROUPS = {
  top: {
    color: "emerald",
    statuses: [
      "Waitlist",
      "Lead",
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

const PROJECT_PILL_TONES = [
  "emerald",
  "sky",
  "violet",
  "amber",
  "rose",
  "indigo",
  "teal",
] as const satisfies readonly ToneNameV2[];

interface AudienceFilterPanelProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly statusCountsLoading: boolean;
  readonly statusCountsErrorMessage: string | null;
  readonly showProjectSection?: boolean;
  readonly showStatusSection?: boolean;
  readonly onProjectChange: (projectId: string) => void;
  readonly onToggleAllStatuses: (selectAll: boolean) => void;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
}

export function AudienceFilterPanel({
  criteria,
  projectOptions,
  statusOptions,
  statusCounts,
  statusCountsLoading,
  statusCountsErrorMessage,
  showProjectSection = true,
  showStatusSection = true,
  onProjectChange,
  onToggleAllStatuses,
  onStatusToggle,
}: AudienceFilterPanelProps) {
  const selectedProjectIds = [
    ...(criteria.projectId == null ? [] : [criteria.projectId]),
    ...criteria.projectIds,
  ].filter((projectId, index, values) => values.indexOf(projectId) === index);
  const selectedProjectIdSet = new Set(selectedProjectIds);
  const knownStatuses = new Set(statusOptions);
  const projectAliasHint = projectOptions[0]?.aliasHint ?? null;
  const hasSingleLockedProject = projectOptions.length === 1;
  const shouldRenderStatusShell =
    selectedProjectIds.length > 0 && statusCountsLoading;

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
            aside={
              projectAliasHint === null ? null : hasSingleLockedProject ? (
                `Inherited from ${projectAliasHint}`
              ) : (
                `Inherited from ${projectAliasHint} · pick one or more sub-projects`
              )
            }
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
      </div>
    </div>
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
  const tone = readProjectTone(project.id);

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
          ? `${tone.bg} text-white ring-transparent shadow-sm`
          : `${tone.subtle} ${tone.subtleText} ${tone.ring} hover:opacity-90`,
      )}
    >
      {selected ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone.dot,
          )}
          aria-hidden="true"
        />
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
  // Locked projects always render in violet so operators read them as
  // "fixed to this sender alias" regardless of which project they belong to.
  const tone = TONE_CLASSES.violet;

  return (
    <span
      role="status"
      aria-label={`Project ${project.name} is locked to this sender alias`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium shadow-sm ring-1 ring-inset ring-transparent",
        tone.bg,
        "text-white",
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

function readProjectTone(projectId: string): ToneClassesV2 {
  const hash = Array.from(projectId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const toneName = PROJECT_PILL_TONES.at(hash % PROJECT_PILL_TONES.length) ?? "emerald";
  return TONE_CLASSES[toneName];
}

