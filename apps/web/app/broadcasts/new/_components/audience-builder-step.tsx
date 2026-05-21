"use client";

import {
  AlertTriangle,
  Filter,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { AudienceCriteria, ExpeditionMemberStatus } from "@as-comms/contracts";

import type {
  AudienceCountData,
  AudiencePreviewRow,
  AudienceStatusCounts,
  AudienceVolunteerSearchRow,
  CampaignProjectOption,
} from "../../_lib/audience-data-source";
import { AudienceFilterPanel } from "./audience-filter-panel";
import { AudiencePreviewList } from "./audience-preview-list";
import { StepHeader, WizardFooter } from "./wizard-shell";

export type AudienceInitialFilter =
  | "project_status"
  | "specific"
  | "all_approved";

export type CampaignAudienceCriteria = AudienceCriteria & {
  readonly initialFilter?: AudienceInitialFilter | undefined;
};

const MODE_META: Record<
  AudienceInitialFilter,
  {
    readonly title: string;
    readonly hint: string;
    readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  }
> = {
  project_status: {
    title: "Project / status",
    hint: "Start with one or more projects, then narrow by member status.",
    Icon: Filter,
  },
  specific: {
    title: "Individual volunteers",
    hint: "Search within the selected projects and hand-pick recipients.",
    Icon: User,
  },
  all_approved: {
    title: "All approved contacts",
    hint: "Every approved contact across all projects, minus auto-exclusions.",
    Icon: Users,
  },
};

interface AudienceBuilderStepProps {
  readonly availableModes: readonly AudienceInitialFilter[];
  readonly hasPickedMode: boolean;
  readonly criteria: CampaignAudienceCriteria;
  readonly countState: AudienceCountData;
  readonly previewRows: readonly AudiencePreviewRow[];
  readonly countLoading: boolean;
  readonly previewLoading: boolean;
  readonly previewErrorMessage: string | null;
  readonly volunteerSearchQuery: string;
  readonly volunteerSearchRows: readonly AudienceVolunteerSearchRow[];
  readonly volunteerSearchLoading: boolean;
  readonly volunteerSearchErrorMessage: string | null;
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly statusCounts: AudienceStatusCounts;
  readonly statusCountsLoading: boolean;
  readonly statusCountsErrorMessage: string | null;
  readonly onInitialFilterChange: (value: AudienceInitialFilter) => void;
  readonly onProjectChange: (projectId: string) => void;
  readonly onToggleAllStatuses: (selectAll: boolean) => void;
  readonly onStatusToggle: (status: ExpeditionMemberStatus) => void;
  readonly onVolunteerSearchQueryChange: (value: string) => void;
  readonly onVolunteerToggle: (contactId: string) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function AudienceBuilderStep({
  availableModes,
  hasPickedMode,
  criteria,
  countState,
  previewRows,
  countLoading,
  previewLoading,
  previewErrorMessage,
  volunteerSearchQuery,
  volunteerSearchRows,
  volunteerSearchLoading,
  volunteerSearchErrorMessage,
  projectOptions,
  statusOptions,
  statusCounts,
  statusCountsLoading,
  statusCountsErrorMessage,
  onInitialFilterChange,
  onProjectChange,
  onToggleAllStatuses,
  onStatusToggle,
  onVolunteerSearchQueryChange,
  onVolunteerToggle,
  onBack,
  onContinue,
}: AudienceBuilderStepProps) {
  const initialFilter = criteria.initialFilter;
  const canContinue =
    !countLoading &&
    initialFilter !== undefined &&
    (initialFilter === "project_status"
      ? [
          ...(criteria.projectId == null ? [] : [criteria.projectId]),
          ...criteria.projectIds,
        ].filter((projectId, index, values) => values.indexOf(projectId) === index)
          .length > 0 &&
        criteria.statuses.length > 0 &&
        countState.count > 0
      : initialFilter === "specific"
        ? (criteria.contactIds?.length ?? 0) > 0 && countState.count > 0
        : countState.count > 0);

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title="Build the audience"
        description="Live counts update from canonical contacts as you refine the audience mode, filters, and volunteer selection."
      />

      <div className="space-y-4">
        <AudienceCountPanel countState={countState} loading={countLoading} />

        {hasPickedMode ? (
          <>
            <ModeSegmentedControl
              modes={availableModes}
              value={initialFilter}
              onChange={onInitialFilterChange}
            />

            {initialFilter === "project_status" ? (
              <>
                <AudienceFilterPanel
                  criteria={criteria}
                  projectOptions={projectOptions}
                  statusOptions={statusOptions}
                  statusCounts={statusCounts}
                  statusCountsLoading={statusCountsLoading}
                  statusCountsErrorMessage={statusCountsErrorMessage}
                  onProjectChange={onProjectChange}
                  onToggleAllStatuses={onToggleAllStatuses}
                  onStatusToggle={onStatusToggle}
                />

                <AudiencePreviewList
                  rows={previewRows}
                  loading={previewLoading}
                  errorMessage={previewErrorMessage}
                />
              </>
            ) : null}

            {initialFilter === "specific" ? (
              <>
                <SpecificVolunteerSelector
                  criteria={criteria}
                  query={volunteerSearchQuery}
                  rows={volunteerSearchRows}
                  loading={volunteerSearchLoading}
                  errorMessage={volunteerSearchErrorMessage}
                  onQueryChange={onVolunteerSearchQueryChange}
                  onToggle={onVolunteerToggle}
                />

                <AudiencePreviewList
                  rows={previewRows}
                  loading={previewLoading}
                  errorMessage={previewErrorMessage}
                />
              </>
            ) : null}

            {initialFilter === "all_approved" ? (
              <>
                <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
                  <p className="text-[13px] leading-relaxed text-slate-600">
                    This broadcast goes to every approved contact across all
                    projects, minus auto-exclusions.
                  </p>
                </section>

                <AudiencePreviewList
                  rows={previewRows}
                  loading={previewLoading}
                  errorMessage={previewErrorMessage}
                />
              </>
            ) : null}
          </>
        ) : (
          <InitialFilterSelector
            modes={availableModes}
            value={undefined}
            onChange={onInitialFilterChange}
          />
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        primaryLabel="Continue"
        primaryAction={onContinue}
        primaryDisabled={!canContinue}
      />
    </section>
  );
}

function InitialFilterSelector({
  modes,
  value,
  onChange,
}: {
  readonly modes: readonly AudienceInitialFilter[];
  readonly value: AudienceInitialFilter | undefined;
  readonly onChange: (value: AudienceInitialFilter) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Audience mode
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Audience mode"
        className="grid gap-3 px-4 py-4 lg:grid-cols-2"
      >
        {modes.map((mode) => {
          const selected = value === mode;
          const meta = MODE_META[mode];

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(mode);
              }}
              className={cn(
                `flex min-h-[108px] items-start gap-3 border p-4 text-left ${RADIUS.lg} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING}`,
                selected
                  ? "border-slate-950 bg-slate-50 ring-1 ring-slate-950/10"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-slate-950" : "border-slate-300",
                )}
                aria-hidden="true"
              >
                {selected ? (
                  <span className="size-2 rounded-full bg-slate-950" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-900">
                  {meta.title}
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug text-slate-500">
                  {meta.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ModeSegmentedControl({
  modes,
  value,
  onChange,
}: {
  readonly modes: readonly AudienceInitialFilter[];
  readonly value: AudienceInitialFilter | undefined;
  readonly onChange: (value: AudienceInitialFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Audience mode"
      className="inline-flex rounded-md bg-slate-100 p-0.5 text-[12.5px]"
    >
      {modes.map((mode) => {
        const selected = value === mode;
        const Icon = MODE_META[mode].Icon;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onChange(mode);
            }}
            className={cn(
              `inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {MODE_META[mode].title}
          </button>
        );
      })}
    </div>
  );
}

export function AudienceCountPanel({
  countState,
  loading,
}: {
  readonly countState: AudienceCountData;
  readonly loading: boolean;
}) {
  const tone = !countState.hasAppliedFilters
    ? "neutral"
    : countState.count > 0
      ? "positive"
      : "warning";
  const helperText = loading
    ? "Calculating audience…"
    : !countState.hasAppliedFilters
      ? "Pick an audience mode to start."
      : countState.count > 0
        ? "recipients match"
        : "No recipients match the current filters.";

  return (
    <div
      aria-live="polite"
      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
    >
      <div className="flex items-baseline gap-3">
        {loading ? (
          <span
            aria-hidden="true"
            className="skeleton-pulse block h-7 w-16 rounded-md"
          />
        ) : (
          <span
            className={cn(
              "text-[28px] font-semibold leading-none tabular-nums",
              tone === "warning" ? "text-slate-400" : "text-slate-900",
            )}
          >
            {countState.hasAppliedFilters
              ? countState.count.toLocaleString()
              : "—"}
          </span>
        )}
        <span className="text-[12px] text-slate-500">{helperText}</span>
      </div>

      {!loading && countState.count > 5000 ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-[12px] text-amber-800">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            This is a large send. Double-check the filters before continuing.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SpecificVolunteerSelector({
  criteria,
  query,
  rows,
  loading,
  errorMessage,
  onQueryChange,
  onToggle,
}: {
  readonly criteria: CampaignAudienceCriteria;
  readonly query: string;
  readonly rows: readonly AudienceVolunteerSearchRow[];
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly onQueryChange: (value: string) => void;
  readonly onToggle: (contactId: string) => void;
}) {
  const selectedCount = criteria.contactIds?.length ?? 0;
  const selectedProjectIds = [
    ...(criteria.projectId == null ? [] : [criteria.projectId]),
    ...criteria.projectIds,
  ].filter((projectId, index, values) => values.indexOf(projectId) === index);

  if (selectedProjectIds.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-[12.5px] text-slate-600">
        No sender-scoped projects are available for volunteer search.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Find volunteers
        </p>
        <span className="text-[11.5px] font-semibold tabular-nums text-slate-500">
          {selectedCount.toLocaleString()} added
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700">
          <Search className="size-4 text-slate-400" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => {
              onQueryChange(event.currentTarget.value);
            }}
            placeholder="Search by name or email"
            className="h-auto border-none bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            aria-label="Search by name or email"
          />
        </label>

        {errorMessage !== null ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {errorMessage}
          </div>
        ) : loading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
            Searching volunteers…
          </div>
        ) : query.trim().length < 2 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
            Type at least 2 characters to search within this sender alias.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
            No matching volunteers found for this sender alias.
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="Volunteer search results"
            className="space-y-2"
          >
            {rows.map((row) => {
              const selected = (criteria.contactIds ?? []).includes(row.contactId);
              return (
                <button
                  key={row.contactId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onToggle(row.contactId);
                  }}
                  className={cn(
                    `flex w-full items-center justify-between gap-3 border px-3 py-3 text-left ${RADIUS.lg} ${TRANSITION.fast} ${FOCUS_RING}`,
                    selected
                      ? "border-slate-950 bg-slate-50 opacity-70 ring-1 ring-slate-950/10"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11.5px] font-semibold uppercase text-slate-700"
                      aria-hidden="true"
                    >
                      {deriveInitials(row.name, row.email)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-slate-900">
                        {row.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">
                        {row.email}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {row.projectAlias ?? row.project ?? "No project"}
                    </span>
                    {selected ? (
                      <span
                        className="inline-flex size-6 items-center justify-center rounded-full bg-slate-900 text-white"
                        aria-hidden="true"
                      >
                        <X className="size-3.5" />
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function deriveInitials(name: string, email: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length > 0) {
    return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  }

  return email.slice(0, 2).toUpperCase();
}
