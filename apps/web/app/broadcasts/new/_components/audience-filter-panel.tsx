"use client";

import { Check } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TONE_CLASSES,
  TRANSITION,
  type ToneNameV2,
} from "@/app/_lib/design-tokens-v2";
import type { ExpeditionMemberStatus } from "@as-comms/contracts";

import { cn } from "@/lib/utils";

import type {
  AudienceStatusCounts,
  CampaignProjectGroup,
} from "../../_lib/audience-data-source";
import type { CampaignAudienceCriteria } from "./audience-builder-step";

const STAGE_GROUPS = {
  top: {
    label: "Top-funnel",
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
    label: "Mid-funnel",
    color: "sky",
    statuses: ["In Progress", "Trip Planning", "In the Field"],
  },
  bottom: {
    label: "Bottom-funnel",
    color: "violet",
    statuses: ["Successful", "Completed", "Returning Gear"],
  },
  off: {
    label: "Off-funnel",
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

const SELECTED_RING_CLASSES: Record<ToneNameV2, string> = {
  slate: "ring-slate-600",
  sky: "ring-sky-600",
  indigo: "ring-indigo-600",
  emerald: "ring-emerald-600",
  amber: "ring-amber-500",
  rose: "ring-rose-500",
  violet: "ring-violet-500",
  teal: "ring-teal-600",
};

interface AudienceFilterPanelProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly projectGroups: readonly CampaignProjectGroup[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly statusCountsErrorMessage: string | null;
  readonly showProjectSection?: boolean;
  readonly showStatusSection?: boolean;
  readonly onProjectChange: (projectId: string) => void;
  readonly onSelectAllStatuses: () => void;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
}

export function AudienceFilterPanel({
  criteria,
  projectGroups,
  statusOptions,
  statusCounts,
  statusCountsErrorMessage,
  showProjectSection = true,
  showStatusSection = true,
  onProjectChange,
  onSelectAllStatuses,
  onStatusToggle,
}: AudienceFilterPanelProps) {
  const selectedProjectIds = [
    ...(criteria.projectId == null ? [] : [criteria.projectId]),
    ...criteria.projectIds,
  ].filter((projectId, index, values) => values.indexOf(projectId) === index);
  const selectedProjectIdSet = new Set(selectedProjectIds);
  const populatedStatuses = statusOptions.filter((status) => {
    return selectedProjectIds.length > 0 && (statusCounts[status] ?? 0) > 0;
  });
  const allPopulatedStatusesSelected =
    populatedStatuses.length > 0 &&
    populatedStatuses.every((status) => criteria.statuses.includes(status));
  const knownStatuses = new Set(statusOptions);
  const stageSections = Object.values(STAGE_GROUPS)
    .map((group) => {
      const statuses = group.statuses.filter(
        (status) =>
          knownStatuses.has(status) && (statusCounts[status] ?? 0) > 0,
      );
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

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Audience filters</h3>
        <p className="mt-1 text-pretty text-[11.5px] leading-5 text-slate-500">
          Pick one or more projects, then narrow by expedition-member status.
        </p>
      </div>

      <div className="space-y-6 px-4 py-4">
        {showProjectSection ? (
          <FilterSection
            title="Project"
            description="Connected sub-projects stay separate choices even when they share the same alias."
          >
            <div className="space-y-2">
              {projectGroups.map((group) => (
                <div key={group.host.id} className="space-y-2">
                  <ProjectOptionRow
                    id={group.host.id}
                    name={group.host.name}
                    aliasHint={group.host.aliasHint}
                    selected={selectedProjectIdSet.has(group.host.id)}
                    onSelect={onProjectChange}
                  />
                  {group.connectedSubs.map((subProject) => (
                    <div key={subProject.id} className="pl-5">
                      <ProjectOptionRow
                        id={subProject.id}
                        name={subProject.name}
                        aliasHint={subProject.aliasHint}
                        selected={selectedProjectIdSet.has(subProject.id)}
                        onSelect={onProjectChange}
                        isSubProject
                      />
                    </div>
                  ))}
                </div>
              ))}
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
                  onClick={onSelectAllStatuses}
                  disabled={allPopulatedStatusesSelected}
                  className={cn(
                    `text-[11.5px] font-medium text-slate-500 ${TRANSITION.fast} ${FOCUS_RING}`,
                    allPopulatedStatusesSelected
                      ? "cursor-not-allowed opacity-50"
                      : "hover:text-slate-900",
                  )}
                >
                  Select all
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
            ) : stageSections.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-500">
                No populated member statuses were found for the selected
                projects.
              </div>
            ) : (
              <div className="space-y-4">
                {stageSections.map((group) => (
                  <StageStatusSection
                    key={group.label}
                    count={group.count}
                    label={group.label}
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
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h4>
        {action}
      </div>
      {description ? (
        <p className="mt-1 text-pretty text-[11px] leading-5 text-slate-500">
          {description}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ProjectOptionRow({
  id,
  name,
  aliasHint,
  selected,
  onSelect,
  isSubProject = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly aliasHint: string | null;
  readonly selected: boolean;
  readonly onSelect: (projectId: string) => void;
  readonly isSubProject?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Choose project ${name}`}
      aria-pressed={selected}
      onClick={() => {
        onSelect(id);
      }}
      className={cn(
        `flex w-full items-start gap-3 border px-3 py-3 text-left ${RADIUS.lg} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING}`,
        selected
          ? "border-slate-950 bg-slate-50 ring-1 ring-slate-950/10"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-slate-950" : "border-slate-300",
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3 text-slate-950" /> : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-[12.5px] text-slate-900",
            isSubProject ? "font-medium" : "font-semibold",
          )}
        >
          {name}
        </span>
        {aliasHint ? (
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {aliasHint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function StageStatusSection({
  label,
  color,
  statuses,
  statusCounts,
  selectedStatuses,
  count,
  onStatusToggle,
}: {
  readonly label: string;
  readonly color: ToneNameV2;
  readonly statuses: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly selectedStatuses: readonly ExpeditionMemberStatus[];
  readonly count: number;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
}) {
  const tone = TONE_CLASSES[color];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <span className="text-[11.5px] font-medium tabular-nums text-slate-500">
          {count.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
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
                `inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold ${RADIUS.full} ${TRANSITION.fast} ${FOCUS_RING}`,
                selected
                  ? `${tone.bg} text-white ring-1 ${SELECTED_RING_CLASSES[color]}`
                  : `${tone.subtle} ${tone.subtleText} ring-1 ${tone.ring} hover:opacity-90`,
              )}
            >
              {selected ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  className={cn("size-2 shrink-0 rounded-full", tone.dot)}
                  aria-hidden="true"
                />
              )}
              <span className="flex items-center gap-2">
                <span>{status}</span>
                <span className="tabular-nums">{countForStatus}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
