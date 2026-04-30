"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import {
  LAYOUT,
  TONE_CLASSES,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import type {
  InboxWelcomeFollowUpEntryViewModel,
  InboxWelcomeProjectWorkloadViewModel,
  InboxWelcomeWorkloadViewModel,
} from "../_lib/view-models";
import { FIELD_QUOTES } from "../_lib/field-quotes";
import { projectToneFromName } from "../_lib/project-tone";
import { InboxAvatar } from "./inbox-avatar";
import { ArrowUpRightIcon, QuoteIcon, RefreshCwIcon } from "./icons";

interface InboxWelcomeWorkloadProps {
  readonly workload: InboxWelcomeWorkloadViewModel;
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
  firstName,
}: InboxWelcomeWorkloadProps) {
  const router = useRouter();
  const today = new Date();
  const initialQuoteIdx = today.getDate() % FIELD_QUOTES.length;
  const [quoteIdx, setQuoteIdx] = useState(initialQuoteIdx);
  const quote = FIELD_QUOTES[quoteIdx] ?? FIELD_QUOTES[0];

  const cycleQuote = () => {
    setQuoteIdx((current) => (current + 1) % FIELD_QUOTES.length);
  };

  const openProject = (projectId: string) => {
    router.push(`/inbox?projectId=${encodeURIComponent(projectId)}`);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/40">
      <header
        className={`flex ${LAYOUT.headerHeight} shrink-0 items-center border-b border-slate-200 bg-white px-10`}
      >
        <div className="flex w-full items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-900">
              Welcome back, {firstName}
            </h1>
            <p className={`mt-1 ${TYPE.caption}`}>Today is {formatDay(today)}</p>
          </div>
          <p className={`shrink-0 ${TYPE.caption}`}>Last synced just now</p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[920px] space-y-8 px-10 py-8">
        <QuoteCard
          quoteText={quote?.text ?? ""}
          author={quote?.author ?? ""}
          onCycle={cycleQuote}
        />

        <ProjectMiniDashboard
          projects={workload.projects}
          onOpenProject={openProject}
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
          <QuoteIcon className="h-5 w-5" />
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
          <RefreshCwIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface ProjectMiniDashboardProps {
  readonly projects: readonly InboxWelcomeProjectWorkloadViewModel[];
  readonly onOpenProject: (projectId: string) => void;
}

function ProjectMiniDashboard({
  projects,
  onOpenProject,
}: ProjectMiniDashboardProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-7 py-10 text-center">
        <SectionLabel as="h2" className="text-slate-500">
          Active project workload
        </SectionLabel>
        <p className={`mt-2 ${TYPE.caption}`}>
          No active projects are currently enabled. Activate projects in
          Settings to surface unread and follow-up counts here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel as="h2">Active project workload</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((project) => {
          const tone = projectToneFromName(project.projectName);
          const t = TONE_CLASSES[tone];
          return (
            <button
              key={project.projectId}
              type="button"
              onClick={() => {
                onOpenProject(project.projectId);
              }}
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left transition-all duration-200 hover:border-slate-300 hover:shadow-sm"
            >
              <span
                aria-hidden="true"
                className={`absolute left-0 top-0 h-full w-1 ${t.bg}`}
              />
              <div className="flex items-start justify-between gap-2 pl-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`}
                    />
                    <span className={`${TYPE.headingSm} truncate`}>
                      {project.projectName}
                    </span>
                  </div>
                </div>
                <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 pl-2">
                <Stat
                  label="Unread"
                  value={project.unreadCount}
                  emphasis={project.unreadCount > 0}
                  tone="slate"
                />
                <Stat
                  label="Follow-up"
                  value={project.needsFollowUpCount}
                  emphasis={project.needsFollowUpCount > 0}
                  tone="amber"
                />
              </div>
            </button>
          );
        })}
      </div>
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
                className={cn("h-1.5 w-1.5 rounded-full", tone.dot)}
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
      <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
    </button>
  );
}

interface StatProps {
  readonly label: string;
  readonly value: number;
  readonly emphasis: boolean;
  readonly tone: "slate" | "amber";
}

function Stat({ label, value, emphasis, tone }: StatProps) {
  const valueClass = emphasis
    ? tone === "amber"
      ? "text-amber-700"
      : "text-slate-900"
    : "text-slate-300";

  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("text-xl font-semibold tabular-nums", valueClass)}>
        {value.toLocaleString("en-US")}
      </span>
      <span className={TYPE.micro}>{label}</span>
    </div>
  );
}
