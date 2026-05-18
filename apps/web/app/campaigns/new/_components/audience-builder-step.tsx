"use client";

import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  AudienceCriteria,
  AudienceLastActivityWindow,
  AudienceTriState,
  ExpeditionMemberStatus,
} from "@as-comms/contracts";

import type {
  AudienceCountData,
  AudiencePreviewRow,
  CampaignExpeditionOption,
  CampaignProjectGroup,
} from "../../_lib/audience-data-source";
import { AudienceFilterPanel } from "./audience-filter-panel";
import { AudiencePreviewList } from "./audience-preview-list";

export type AudienceInitialFilter =
  | "all_approved"
  | "project_status"
  | "specific";

export type CampaignAudienceCriteria = AudienceCriteria & {
  readonly initialFilter?: AudienceInitialFilter;
};

interface AudienceBuilderStepProps {
  readonly criteria: CampaignAudienceCriteria;
  readonly countState: AudienceCountData;
  readonly previewRows: readonly AudiencePreviewRow[];
  readonly countLoading: boolean;
  readonly previewLoading: boolean;
  readonly previewOpen: boolean;
  readonly previewErrorMessage: string | null;
  readonly projectGroups: readonly CampaignProjectGroup[];
  readonly expeditionOptions: readonly CampaignExpeditionOption[];
  readonly statusOptions: readonly ExpeditionMemberStatus[];
  readonly isAdmin: boolean;
  readonly onInitialFilterChange: (value: AudienceInitialFilter) => void;
  readonly onProjectToggle: (projectId: string) => void;
  readonly onStatusToggle: (status: string) => void;
  readonly onExpeditionToggle: (expeditionId: string) => void;
  readonly onLastActivityChange: (value: AudienceLastActivityWindow) => void;
  readonly onHasRepliedChange: (value: AudienceTriState) => void;
  readonly onHasClickedChange: (value: AudienceTriState) => void;
  readonly onPreviewToggle: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function AudienceBuilderStep({
  criteria,
  countState,
  previewRows,
  countLoading,
  previewLoading,
  previewOpen,
  previewErrorMessage,
  projectGroups,
  expeditionOptions,
  statusOptions,
  isAdmin,
  onInitialFilterChange,
  onProjectToggle,
  onStatusToggle,
  onExpeditionToggle,
  onLastActivityChange,
  onHasRepliedChange,
  onHasClickedChange,
  onPreviewToggle,
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
          Live counts come from the server on every filter change. The preview
          panel lets operators sanity-check the first matching recipients before
          moving into compose.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <AudienceFilterPanel
            criteria={criteria}
            projectGroups={projectGroups}
            expeditionOptions={expeditionOptions}
            statusOptions={statusOptions}
            onProjectToggle={onProjectToggle}
            onStatusToggle={onStatusToggle}
            onExpeditionToggle={onExpeditionToggle}
            onLastActivityChange={onLastActivityChange}
            onHasRepliedChange={onHasRepliedChange}
            onHasClickedChange={onHasClickedChange}
          />
        </div>

        <div className="min-h-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <AudienceCountPanel
            countState={countState}
            loading={countLoading}
            previewOpen={previewOpen}
            onPreviewToggle={onPreviewToggle}
          />

          <InitialFilterSelector
            value={initialFilter}
            isAdmin={isAdmin}
            onChange={onInitialFilterChange}
          />

          {previewOpen ? (
            <div>
              <AudiencePreviewList
                rows={previewRows}
                loading={previewLoading}
                errorMessage={previewErrorMessage}
              />
            </div>
          ) : null}

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11.5px] text-slate-600">
            Always auto-excluded: unsubscribed contacts, hard-bounced addresses,
            and anyone without an email on file.
          </div>
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
  isAdmin,
  onChange,
}: {
  readonly value: AudienceInitialFilter;
  readonly isAdmin: boolean;
  readonly onChange: (value: AudienceInitialFilter) => void;
}) {
  const modes: readonly {
    readonly id: AudienceInitialFilter;
    readonly title: string;
    readonly hint: string;
  }[] = [
    {
      id: "all_approved",
      title: "All approved contacts",
      hint: "Newsletter subscribers and approved org-wide contacts.",
    },
    {
      id: "project_status",
      title: "Filter by project and status",
      hint: "Pick projects, then narrow by member status.",
    },
    {
      id: "specific",
      title: "Specific recipients",
      hint: "Hand-picked recipients keep project footer scope.",
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            Initial filter
          </p>
        </div>
        <div className="grid divide-y divide-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {modes.map((mode) => {
            const selected = value === mode.id;
            const disabled = mode.id === "all_approved" && !isAdmin;
            const option = (
              <label
                key={mode.id}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2 px-4 py-3.5 font-normal transition-colors",
                  selected ? "bg-slate-50" : "hover:bg-slate-50/70",
                  disabled ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <input
                    type="radio"
                    name="campaign-initial-filter"
                    value={mode.id}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => {
                      if (!disabled) {
                        onChange(mode.id);
                      }
                    }}
                  />
                  <span className="text-[13px] font-semibold text-slate-900">
                    {mode.title}
                  </span>
                </div>
                <span className="text-[11.5px] leading-snug text-slate-500">
                  {mode.hint}
                </span>
              </label>
            );

            if (!disabled) {
              return option;
            }

            return (
              <Tooltip key={mode.id}>
                <TooltipTrigger asChild>{option}</TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-pretty">
                  Newsletter sends are admin-only. Ask an admin to launch this
                  campaign.
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>
    </TooltipProvider>
  );
}

export function AudienceCountPanel({
  countState,
  loading,
  previewOpen,
  onPreviewToggle,
}: {
  readonly countState: AudienceCountData;
  readonly loading: boolean;
  readonly previewOpen: boolean;
  readonly onPreviewToggle: () => void;
}) {
  const tone = !countState.hasAppliedFilters
    ? "neutral"
    : countState.count > 0
      ? "positive"
      : "warning";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
              ? "Pick filters to start"
              : countState.count > 0
                ? "The live audience is ready to inspect."
                : "No recipients match the current filters."}
          </p>
        </div>

        <Button variant="outline" onClick={onPreviewToggle}>
          {previewOpen ? "Hide preview" : "Preview audience"}
        </Button>
      </div>

      {countState.count > 5000 ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-white px-3 py-2.5 text-[12.5px] text-amber-800">
          This is a large send. Double-check the filters before continuing.
        </div>
      ) : null}
    </div>
  );
}
