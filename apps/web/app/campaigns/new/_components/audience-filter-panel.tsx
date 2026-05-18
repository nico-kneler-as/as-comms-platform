"use client";

import { ChevronDown } from "lucide-react";

import type {
  AudienceLastActivityWindow,
  AudienceTriState,
  ExpeditionMemberStatus,
} from "@as-comms/contracts";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type {
  CampaignExpeditionOption,
  CampaignProjectGroup,
} from "../../_lib/audience-data-source";
import type { CampaignAudienceCriteria } from "./audience-builder-step";

interface AudienceFilterPanelProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly projectGroups: readonly CampaignProjectGroup[];
  readonly expeditionOptions: readonly CampaignExpeditionOption[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly onProjectToggle: (projectId: string) => void;
  readonly onStatusToggle: (status: string) => void;
  readonly onExpeditionToggle: (expeditionId: string) => void;
  readonly onLastActivityChange: (value: AudienceLastActivityWindow) => void;
  readonly onHasRepliedChange: (value: AudienceTriState) => void;
  readonly onHasClickedChange: (value: AudienceTriState) => void;
}

const LAST_ACTIVITY_OPTIONS: readonly {
  readonly value: AudienceLastActivityWindow;
  readonly label: string;
}[] = [
  { value: "all_time", label: "All time" },
  { value: "last_year", label: "Last year" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "last_30_days", label: "Last 30 days" },
];

const TRI_STATE_OPTIONS: readonly {
  readonly value: AudienceTriState;
  readonly label: string;
}[] = [
  { value: "either", label: "Either" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function AudienceFilterPanel({
  criteria,
  projectGroups,
  expeditionOptions,
  statusOptions,
  onProjectToggle,
  onStatusToggle,
  onExpeditionToggle,
  onLastActivityChange,
  onHasRepliedChange,
  onHasClickedChange,
}: AudienceFilterPanelProps) {
  const selectedExpeditionLabels = expeditionOptions
    .filter((option) => criteria.expeditionIds.includes(option.id))
    .map((option) => option.name);
  const expeditionSummary =
    selectedExpeditionLabels.length === 0
      ? "All recent expeditions"
      : selectedExpeditionLabels.length === 1
        ? selectedExpeditionLabels[0] ?? "1 selected"
        : `${String(selectedExpeditionLabels.length)} expeditions`;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Audience filters</h3>
        <p className="mt-1 text-pretty text-[11.5px] leading-5 text-slate-500">
          Filter against canonical contacts and live campaign engagement signals.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <FilterSection
          title="Project"
          description="Connected subs are equal-rank picks. Checking a host does not auto-include its subs."
        >
          <div className="space-y-2">
            {projectGroups.map((group) => (
              <div key={group.host.id} className="space-y-2">
                <ProjectCheckboxRow
                  id={group.host.id}
                  name={group.host.name}
                  aliasHint={group.host.aliasHint}
                  checked={criteria.projectIds.includes(group.host.id)}
                  onToggle={onProjectToggle}
                />
                {group.connectedSubs.map((subProject) => (
                  <div key={subProject.id} className="pl-5">
                    <ProjectCheckboxRow
                      id={subProject.id}
                      name={subProject.name}
                      aliasHint={subProject.aliasHint}
                      checked={criteria.projectIds.includes(subProject.id)}
                      onToggle={onProjectToggle}
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

        <FilterSection title="Expedition">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Select expeditions"
                className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-[12.5px] text-slate-700"
              >
                <span className="truncate">{expeditionSummary}</span>
                <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 rounded-lg p-1.5">
              {expeditionOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-500">
                  No recent expeditions found yet.
                </div>
              ) : (
                expeditionOptions.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={criteria.expeditionIds.includes(option.id)}
                      onChange={() => {
                        onExpeditionToggle(option.id);
                      }}
                      aria-label={`Toggle expedition ${option.name}`}
                    />
                    <span>{option.name}</span>
                  </label>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </FilterSection>

        <FilterSection title="Last Activity">
          <fieldset className="space-y-2">
            <legend className="sr-only">Last Activity</legend>
            {LAST_ACTIVITY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[12.5px] text-slate-700"
              >
                <input
                  type="radio"
                  name="last-activity"
                  checked={criteria.lastActivityWindow === option.value}
                  onChange={() => {
                    onLastActivityChange(option.value);
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
        </FilterSection>

        <FilterSection title="Has Replied to prior campaign">
          <SegmentedTriState
            value={criteria.hasReplied}
            onChange={onHasRepliedChange}
            ariaLabel="Filter by whether the contact replied to a prior campaign"
          />
        </FilterSection>

        <FilterSection title="Has Clicked prior campaign">
          <SegmentedTriState
            value={criteria.hasClicked}
            onChange={onHasClickedChange}
            ariaLabel="Filter by whether the contact clicked a prior campaign"
          />
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
    <section className="border-b border-slate-100 py-4 last:border-b-0 first:pt-0">
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

function ProjectCheckboxRow({
  id,
  name,
  aliasHint,
  checked,
  onToggle,
  isSubProject = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly aliasHint: string | null;
  readonly checked: boolean;
  readonly onToggle: (projectId: string) => void;
  readonly isSubProject?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 text-[12.5px] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {
          onToggle(id);
        }}
        aria-label={`Toggle project ${name}`}
      />
      <span className="min-w-0">
        <span className={cn("block", isSubProject ? "font-medium" : "")}>{name}</span>
        {aliasHint ? (
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {aliasHint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function SegmentedTriState({
  value,
  onChange,
  ariaLabel,
}: {
  readonly value: AudienceTriState;
  readonly onChange: (value: AudienceTriState) => void;
  readonly ariaLabel: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string" && next.length > 0) {
          onChange(next as AudienceTriState);
        }
      }}
      className="grid w-full grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-0.5"
      aria-label={ariaLabel}
    >
      {TRI_STATE_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          variant="outline"
          size="sm"
          className="rounded border-0 text-[11.5px] data-[state=on]:bg-[#253746] data-[state=on]:text-white"
          aria-label={`${ariaLabel}: ${option.label}`}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
