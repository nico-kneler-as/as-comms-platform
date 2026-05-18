"use client";

import { AlertTriangle, CheckCircle2, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { AudienceCriteria, ExpeditionMemberStatus } from "@as-comms/contracts";

import type {
  AudienceCountData,
  AudiencePreviewRow,
  AudienceVolunteerSearchRow,
  CampaignProjectGroup,
} from "../../_lib/audience-data-source";
import { AudienceFilterPanel } from "./audience-filter-panel";
import { AudiencePreviewList } from "./audience-preview-list";

export type AudienceInitialFilter = "project_status" | "specific";

export type CampaignAudienceCriteria = AudienceCriteria & {
  readonly initialFilter?: AudienceInitialFilter;
};

interface AudienceBuilderStepProps {
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
  readonly projectGroups: readonly CampaignProjectGroup[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly onInitialFilterChange: (value: AudienceInitialFilter) => void;
  readonly onProjectChange: (projectId: string) => void;
  readonly onStatusToggle: (status: string) => void;
  readonly onVolunteerSearchQueryChange: (value: string) => void;
  readonly onVolunteerToggle: (contactId: string) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function AudienceBuilderStep({
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
  projectGroups,
  statusOptions,
  onInitialFilterChange,
  onProjectChange,
  onStatusToggle,
  onVolunteerSearchQueryChange,
  onVolunteerToggle,
  onBack,
  onContinue,
}: AudienceBuilderStepProps) {
  const initialFilter = criteria.initialFilter ?? "project_status";

  return (
    <section className="flex h-full flex-col">
      <div className="pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Step 3
        </p>
        <h2 className="mt-2 text-balance text-xl font-semibold text-slate-900">
          Build the audience
        </h2>
        <p className="mt-2 max-w-3xl text-pretty text-[13px] leading-relaxed text-slate-500">
          Live counts update from canonical contacts as you refine the project,
          status, and volunteer selection.
        </p>
      </div>

      <div className="space-y-4">
        <AudienceFilterPanel
          criteria={criteria}
          projectGroups={projectGroups}
          statusOptions={statusOptions}
          onProjectChange={onProjectChange}
          onStatusToggle={onStatusToggle}
        />

        <AudienceCountPanel countState={countState} loading={countLoading} />

        <InitialFilterSelector
          value={initialFilter}
          onChange={onInitialFilterChange}
        />

        {initialFilter === "specific" ? (
          <SpecificVolunteerSelector
            criteria={criteria}
            query={volunteerSearchQuery}
            rows={volunteerSearchRows}
            loading={volunteerSearchLoading}
            errorMessage={volunteerSearchErrorMessage}
            onQueryChange={onVolunteerSearchQueryChange}
            onToggle={onVolunteerToggle}
          />
        ) : null}

        <AudiencePreviewList
          rows={previewRows}
          loading={previewLoading}
          errorMessage={previewErrorMessage}
        />

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11.5px] text-slate-600">
          Always auto-excluded: unsubscribed contacts, hard-bounced addresses,
          and anyone without an email on file.
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Continue to compose</Button>
      </div>
    </section>
  );
}

function InitialFilterSelector({
  value,
  onChange,
}: {
  readonly value: AudienceInitialFilter;
  readonly onChange: (value: AudienceInitialFilter) => void;
}) {
  const modes: readonly {
    readonly id: AudienceInitialFilter;
    readonly title: string;
    readonly hint: string;
  }[] = [
    {
      id: "project_status",
      title: "Filter by project/status",
      hint: "Start with one project, then narrow with expedition-member status.",
    },
    {
      id: "specific",
      title: "Select individual volunteers",
      hint: "Search within the selected project and hand-pick recipients.",
    },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Audience mode
        </p>
      </div>
      <div className="grid divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {modes.map((mode) => {
          const selected = value === mode.id;

          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                onChange(mode.id);
              }}
              className={cn(
                "flex items-start gap-3 px-4 py-3.5 text-left transition-colors",
                selected ? "bg-slate-50" : "hover:bg-slate-50/70",
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
                  {mode.title}
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug text-slate-500">
                  {mode.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
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

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="min-w-0">
        <div
          aria-live="polite"
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
            tone === "neutral"
              ? "bg-white text-slate-600 ring-1 ring-slate-200"
              : tone === "positive"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
          )}
        >
          {tone === "neutral" ? (
            <Sparkles className="size-3.5" aria-hidden="true" />
          ) : tone === "positive" ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-3.5" aria-hidden="true" />
          )}
          {loading ? "Updating live count…" : "Live audience"}
        </div>
        <div className="mt-3 flex items-end gap-3">
          <span className="text-[32px] font-semibold leading-none tabular-nums text-slate-900">
            {countState.hasAppliedFilters
              ? countState.count.toLocaleString()
              : "—"}
          </span>
          <span className="pb-1 text-[12px] text-slate-500">
            recipients match · live as you change filters
          </span>
        </div>
        <p className="mt-2 text-[12.5px] text-slate-600">
          {!countState.hasAppliedFilters
            ? "Pick a project or volunteer selection to start."
            : countState.count > 0
              ? "The live audience is ready to inspect."
              : "No recipients match the current filters."}
        </p>
      </div>

      {countState.count > 5000 ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-white px-3 py-2.5 text-[12.5px] text-amber-800">
          This is a large send. Double-check the filters before continuing.
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
  if (criteria.projectId == null) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-[12.5px] text-slate-600">
        Pick a project first to search volunteers.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Select volunteers
        </p>
      </div>
      <div className="space-y-3 px-4 py-4">
        <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700">
          <Search className="size-4 text-slate-400" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => {
              onQueryChange(event.currentTarget.value);
            }}
            placeholder="Search volunteers by name or email"
            className="h-auto border-none bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            aria-label="Search volunteers by name or email"
          />
        </label>

        {(criteria.contactIds?.length ?? 0) > 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            {(criteria.contactIds?.length ?? 0).toLocaleString()} volunteer
            {(criteria.contactIds?.length ?? 0) === 1 ? "" : "s"} selected
          </div>
        ) : null}

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
            Type at least 2 characters to search within the selected project.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
            No matching volunteers found in this project.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const selected = (criteria.contactIds ?? []).includes(row.contactId);
              return (
                <button
                  key={row.contactId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onToggle(row.contactId);
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
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                      selected ? "border-slate-950 bg-slate-950" : "border-slate-300",
                    )}
                    aria-hidden="true"
                  >
                    {selected ? (
                      <CheckCircle2 className="size-3 text-white" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-slate-900">
                      {row.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">
                      {row.email}
                    </span>
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
