"use client";

import { CheckCircle2 } from "lucide-react";

import type { ExpeditionMemberStatus } from "@as-comms/contracts";

import { cn } from "@/lib/utils";

import type { CampaignProjectGroup } from "../../_lib/audience-data-source";
import type { CampaignAudienceCriteria } from "./audience-builder-step";

interface AudienceFilterPanelProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly projectGroups: readonly CampaignProjectGroup[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly onProjectChange: (projectId: string) => void;
  readonly onStatusToggle: (status: string) => void;
}

export function AudienceFilterPanel({
  criteria,
  projectGroups,
  statusOptions,
  onProjectChange,
  onStatusToggle,
}: AudienceFilterPanelProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Audience filters</h3>
        <p className="mt-1 text-pretty text-[11.5px] leading-5 text-slate-500">
          Pick one project, then narrow by expedition-member status.
        </p>
      </div>

      <div className="space-y-6 px-4 py-4">
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
                  selected={criteria.projectId === group.host.id}
                  onSelect={onProjectChange}
                />
                {group.connectedSubs.map((subProject) => (
                  <div key={subProject.id} className="pl-5">
                    <ProjectOptionRow
                      id={subProject.id}
                      name={subProject.name}
                      aliasHint={subProject.aliasHint}
                      selected={criteria.projectId === subProject.id}
                      onSelect={onProjectChange}
                      isSubProject
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Expedition-member status">
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((status) => {
              const selected = criteria.statuses.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  aria-label={`Toggle expedition-member status ${status}`}
                  aria-pressed={selected}
                  onClick={() => {
                    onStatusToggle(status);
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                    selected
                      ? "bg-[#253746] text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  {status}
                </button>
              );
            })}
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

function FilterSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h4>
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
        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
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
        {selected ? <CheckCircle2 className="size-3 text-slate-950" /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[12.5px] text-slate-900", isSubProject ? "font-medium" : "font-semibold")}>
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
