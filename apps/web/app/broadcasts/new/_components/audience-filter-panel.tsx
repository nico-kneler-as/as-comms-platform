"use client";

import { Check, LoaderCircle, Lock } from "lucide-react";

import {
  FOCUS_RING,
  TONE_CLASSES,
  TRANSITION,
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
    label: "TOP-FUNNEL",
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
    label: "MID-FUNNEL",
    color: "sky",
    statuses: ["In Progress", "Trip Planning", "In the Field"],
  },
  bottom: {
    label: "BOTTOM-FUNNEL",
    color: "violet",
    statuses: ["Successful", "Completed", "Returning Gear"],
  },
  off: {
    label: "OFF-FUNNEL",
    color: "rose",
    statuses: ["Denied", "Aborted", "Soft Denied", "Failed"],
  },
} as const satisfies Record<
  string,
  {
    readonly label: string;
    readonly color: ToneNameV2;
    readonly statuses: readonly ExpeditionMemberStatus[];
  }
>;

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
        count: statuses.reduce(
          (total, status) => total + (statusCounts[status] ?? 0),
          0,
        ),
      };
    })
    .filter((group) => group.statuses.length > 0);

  const visibleStatuses = stageSections.flatMap((group) => group.statuses);
  const allVisibleStatusesSelected =
    visibleStatuses.length > 0 &&
    visibleStatuses.every((status) => criteria.statuses.includes(status));

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Audience filters</h3>
        <p className="mt-1 text-pretty text-[11.5px] leading-5 text-slate-500">
          Pick one or more projects, then narrow by expedition-member status.
        </p>
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
            <div className="space-y-2.5">
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
                    key={group.label}
                    count={group.count}
                    color={group.color}
                    label={group.label}
                    loading={statusCountsLoading}
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
  const aliasAddress = readAliasAddress(project);

  return (
    <button
      type="button"
      aria-label={`Choose project ${project.name}`}
      aria-pressed={selected}
      onClick={() => {
        onSelect(project.id);
      }}
      className={cn(
        `flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${TRANSITION.fast} ${FOCUS_RING}`,
        selected
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white hover:text-slate-900",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProjectSelectionIndicator selected={selected} />
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            selected ? "bg-white/70" : "bg-slate-300",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{project.name}</p>
          {aliasAddress ? (
            <p
              className={cn(
                "truncate text-[11.5px]",
                selected ? "text-white/70" : "text-slate-500",
              )}
            >
              {aliasAddress}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function LockedProjectRow({
  project,
}: {
  readonly project: CampaignProjectOption;
}) {
  const aliasAddress = readAliasAddress(project);

  return (
    <div
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left"
      aria-label={`Project ${project.name} is locked to this sender alias`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
        <Lock className="size-4" aria-hidden="true" />
      </span>
      <span className="size-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-slate-900">
          {project.name}
        </p>
        {aliasAddress ? (
          <p className="truncate text-[11.5px] text-slate-500">{aliasAddress}</p>
        ) : null}
      </div>
    </div>
  );
}

function StageStatusSection({
  label,
  color,
  statuses,
  statusCounts,
  selectedStatuses,
  count,
  loading,
  onStatusToggle,
}: {
  readonly label: string;
  readonly color: ToneNameV2;
  readonly statuses: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly selectedStatuses: readonly ExpeditionMemberStatus[];
  readonly count: number;
  readonly loading: boolean;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
}) {
  const tone = TONE_CLASSES[color];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 pb-2">
        <p className="text-[10.5px] font-semibold tracking-wider text-slate-500">
          {label}
        </p>
        {loading ? (
          <LoaderCircle
            className={cn(`size-3.5 animate-spin ${tone.text}`)}
            aria-label={`Loading ${label} total`}
          />
        ) : (
          <span className="text-[12px] font-medium tabular-nums text-slate-500">
            {count.toLocaleString()}
          </span>
        )}
      </div>

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
              {loading ? (
                <span
                  aria-hidden="true"
                  className="skeleton-pulse block h-3.5 w-5 shrink-0 rounded"
                />
              ) : (
                <span
                  className={cn(
                    "tabular-nums text-[11.5px]",
                    selected ? "text-white/90" : "text-slate-500/90",
                  )}
                >
                  {countForStatus.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ProjectSelectionIndicator({
  selected,
}: {
  readonly selected: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        selected
          ? "border-white/20 bg-white/15 text-white"
          : "border-slate-300 bg-white text-transparent",
      )}
      aria-hidden="true"
    >
      {selected ? <Check className="size-3" aria-hidden="true" /> : null}
    </span>
  );
}

function readAliasAddress(project: CampaignProjectOption): string | null {
  if (project.aliasHint === null) {
    return null;
  }

  return `${project.aliasHint}adventurescientists.org`;
}
