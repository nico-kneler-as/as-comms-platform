"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TONE_CLASSES,
  LAYOUT,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import type {
  InboxWelcomeFollowUpEntryViewModel,
  InboxWelcomeWorkloadViewModel,
} from "../_lib/view-models";
import { FIELD_QUOTES } from "../_lib/field-quotes";
import type { InboxWelcomeSalesforceLifecycleData } from "../_lib/home-dashboard";
import type { MetricKey } from "../_lib/project-lifecycle-metrics";
import { projectToneFromName } from "../_lib/project-tone";
import { InboxAvatar } from "./inbox-avatar";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  DatabaseIcon,
  QuoteIcon,
  RefreshCwIcon,
} from "./icons";
import { ProjectLifecycleTile } from "./project-lifecycle-tile";

interface InboxWelcomeWorkloadProps {
  readonly workload: InboxWelcomeWorkloadViewModel;
  readonly salesforceLifecycle: InboxWelcomeSalesforceLifecycleData;
  readonly firstName: string;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function InboxWelcomeWorkload({
  workload,
  salesforceLifecycle,
  firstName,
}: InboxWelcomeWorkloadProps) {
  const router = useRouter();
  const today = new Date();
  const initialQuoteIdx = today.getDate() % FIELD_QUOTES.length;
  const [quoteIdx, setQuoteIdx] = useState(initialQuoteIdx);
  const [, setPendingMetric] = useState<{
    readonly projectId: string;
    readonly metricKey: MetricKey;
  } | null>(null);
  const quote = FIELD_QUOTES[quoteIdx] ?? FIELD_QUOTES[0];

  const cycleQuote = () => {
    setQuoteIdx((current) => (current + 1) % FIELD_QUOTES.length);
  };

  const openProject = (projectId: string) => {
    router.push(`/inbox?projectId=${encodeURIComponent(projectId)}`);
  };

  const freshnessBadge = readFreshnessBadge(salesforceLifecycle, today);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/40">
      <header
        className={`flex ${LAYOUT.welcomeHeaderHeight} shrink-0 items-center border-b border-slate-200 bg-white px-10`}
      >
        <div className="flex w-full items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-900">
              Welcome back, {firstName}
            </h1>
            <p className={`mt-1 ${TYPE.caption}`}>Today is {formatDay(today)}</p>
          </div>
          <p
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${freshnessBadge.className}`}
          >
            {freshnessBadge.label}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[920px] space-y-8 px-10 py-8">
        <QuoteCard
          quoteText={quote?.text ?? ""}
          author={quote?.author ?? ""}
          onCycle={cycleQuote}
        />

        <ProjectLifecycleDashboard
          salesforceLifecycle={salesforceLifecycle}
          onOpenProject={openProject}
          onOpenMetric={(projectId, metricKey) => {
            setPendingMetric({ projectId, metricKey });
          }}
        />

        {workload.followUpRail.totalCount > 0 ? (
          <FollowUpRail
            rail={workload.followUpRail}
            onOpenContact={(contactId) => {
              router.push(`/inbox/${encodeURIComponent(contactId)}`);
            }}
            onViewAll={() => {
              router.push("/inbox?filter=follow-up");
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function readFreshnessBadge(
  salesforceLifecycle: InboxWelcomeSalesforceLifecycleData,
  now: Date,
): {
  readonly label: string;
  readonly className: string;
} {
  switch (salesforceLifecycle.freshness) {
    case "fresh": {
      if (salesforceLifecycle.lastSuccessAt === null) {
        return {
          label: "Up to date",
          className: "border-emerald-200 bg-emerald-50 text-emerald-800",
        };
      }

      const ageMs = Math.max(
        0,
        now.getTime() - salesforceLifecycle.lastSuccessAt.getTime(),
      );
      const ageMinutes = Math.floor(ageMs / 60_000);

      return {
        label:
          ageMinutes <= 0
            ? "Last synced just now"
            : `Last synced ${ageMinutes.toString()} min ago`,
        className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      };
    }
    case "stale-30m":
      return {
        label: "Last synced over 30 min ago",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    case "stale-2h":
      return {
        label: "Last synced over 2 hr ago",
        className: "border-slate-200 bg-slate-50 text-slate-600",
      };
    case "unknown":
      return {
        label: "Salesforce sync status unavailable",
        className: "border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}

interface QuoteCardProps {
  readonly quoteText: string;
  readonly author: string;
  readonly onCycle: () => void;
}

function QuoteCard({ quoteText, author, onCycle }: QuoteCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, #0ea5a4 0%, transparent 40%), radial-gradient(circle at 80% 70%, #6366f1 0%, transparent 40%)",
        }}
      />
      <div className="relative flex items-start gap-5 p-7">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
          <QuoteIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <SectionLabel as="h2" className="text-teal-700">
            Field note of the day
          </SectionLabel>
          <blockquote className="mt-2 font-message-body text-[19px] leading-snug text-slate-900">
            &ldquo;{quoteText}&rdquo;
          </blockquote>
          <p className={`mt-2 ${TYPE.caption}`}>— {author}</p>
        </div>
        <button
          type="button"
          aria-label="Show another quote"
          onClick={onCycle}
          className="text-slate-400 opacity-0 transition-opacity duration-150 hover:text-slate-700 group-hover:opacity-100"
        >
          <RefreshCwIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

interface ProjectLifecycleDashboardProps {
  readonly salesforceLifecycle: InboxWelcomeSalesforceLifecycleData;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenMetric: (projectId: string, metricKey: MetricKey) => void;
}

function ProjectLifecycleDashboard({
  salesforceLifecycle,
  onOpenProject,
  onOpenMetric,
}: ProjectLifecycleDashboardProps) {
  const { tiles, freshness } = salesforceLifecycle;

  return (
    <div>
      {freshness === "stale-2h" ? (
        <div
          role="alert"
          className="mb-3 flex min-h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-amber-900"
        >
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm font-medium">
            Salesforce sync delayed — numbers may be stale.
          </p>
        </div>
      ) : null}

      <SectionLabel as="h2">Active Projects · Last 7 Days</SectionLabel>
      {tiles.length === 0 ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-7 py-10 text-center">
          <EmptyState
            size="sm"
            icon={<DatabaseIcon className="size-6 text-slate-400" />}
            title="No active projects yet — activate one in Settings"
            description={<span aria-hidden="true">&nbsp;</span>}
            className="px-0 py-10"
          />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {tiles.map((tile) => (
            <ProjectLifecycleTile
              key={tile.projectId}
              tile={tile}
              onOpenProject={onOpenProject}
              onOpenMetric={onOpenMetric}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FollowUpRailProps {
  readonly rail: InboxWelcomeWorkloadViewModel["followUpRail"];
  readonly onOpenContact: (contactId: string) => void;
  readonly onViewAll: () => void;
}

function FollowUpRail({
  rail,
  onOpenContact,
  onViewAll,
}: FollowUpRailProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel as="h2">
          {`\u{1F6A9} These need follow-up · ${rail.totalCount.toString()}`}
        </SectionLabel>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          View all →
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {rail.entries.map((entry) => (
            <FollowUpRailRow
              key={entry.contactId}
              entry={entry}
              onOpenContact={onOpenContact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface FollowUpRailRowProps {
  readonly entry: InboxWelcomeFollowUpEntryViewModel;
  readonly onOpenContact: (contactId: string) => void;
}

function FollowUpRailRow({ entry, onOpenContact }: FollowUpRailRowProps) {
  const tone =
    entry.projectLabel === null
      ? null
      : TONE_CLASSES[projectToneFromName(entry.projectLabel)];

  return (
    <button
      type="button"
      onClick={() => {
        onOpenContact(entry.contactId);
      }}
      aria-label={`Open conversation with ${entry.displayName}`}
      className="group relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/80"
    >
      <InboxAvatar
        initials={entry.initials}
        tone={entry.avatarTone}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">
            {entry.displayName}
          </span>
          {entry.projectLabel !== null && tone !== null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                tone.subtle,
                tone.subtleText,
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", tone.dot)}
              />
              {entry.projectLabel}
            </span>
          ) : null}
        </div>
        <p className={cn(TYPE.caption, "truncate")}>{entry.latestSubject}</p>
      </div>
      <span className={cn(TYPE.micro, "shrink-0 whitespace-nowrap")}>
        {entry.lastActivityLabel}
      </span>
      <ArrowUpRightIcon className="size-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
    </button>
  );
}
