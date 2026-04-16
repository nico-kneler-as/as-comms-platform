"use client";

/**
 * `/inbox/states` — Interactive showcase of every Inbox UI state.
 *
 * This page is for design review and QA. Each section renders a real
 * component in a specific state so reviewers can see every permutation
 * without clicking through the prototype. Controls at the top let you
 * drive the shared client context (loading flags, composer status, AI
 * draft lifecycle) so the live inbox layout also updates.
 *
 * States covered:
 *
 *  APP CHROME
 *    1. App loading (full-screen skeleton)
 *
 *  LIST COLUMN
 *    2. Queue loading skeleton
 *    3. Empty queue (all / new / opened)
 *    4. Search active with results
 *    5. Search active with no results
 *    6. New bucket tab
 *    7. Opened bucket tab
 *
 *  DETAIL WORKSPACE
 *    8. No contact selected
 *    9. Contact selected (happy path)
 *   10. Unresolved banner / expandable panel
 *   11. Timeline loading skeleton
 *   12. Needs Follow Up off
 *   13. Needs Follow Up on
 *
 *  COMPOSER
 *   14. Idle (default)
 *   15. Saving draft
 *   16. Draft saved
 *   17. Validation error
 *   18. Sending
 *   19. Sent success
 *   20. Send failure
 *
 *  AI DRAFTING
 *   21. AI idle (button ready)
 *   22. AI generating
 *   23. AI draft inserted into composer
 *   24. Reprompt action
 *   25. AI unavailable fallback
 *   26. AI error state
 *   27. Edited-after-generation
 *   28. Discarded AI draft
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ComposerStatus, AiDraftStatus } from "../../_components/claude-inbox-client-provider";
import { useClaudeInboxClient } from "../../_components/claude-inbox-client-provider";
import { ClaudeInboxAppLoading, QueueLoadingSkeleton, QueueRowSkeleton, TimelineSkeleton } from "../../_components/claude-inbox-loading";
import { ClaudeInboxEmptyState } from "../../_components/claude-inbox-empty-state";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BotIcon,
  CheckCircleIcon,
  InboxIcon,
  LoaderIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchXIcon,
  SendIcon,
  SparkleIcon,
  TrashIcon,
  WandIcon,
  WifiOffIcon,
  XCircleIcon,
  XIcon
} from "../../_components/claude-icons";

// ---------- Section wrapper ----------

function Section({
  id,
  number,
  title,
  children
}: {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white tabular-nums">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {children}
      </div>
    </section>
  );
}

// ---------- Live controls ----------

function LiveControls() {
  const {
    setQueueLoading,
    isQueueLoading,
    setTimelineLoading,
    isTimelineLoading,
    composerStatus,
    setComposerStatus,
    setComposerErrors,
    aiDraft,
    startAiGeneration,
    insertAiDraft,
    markAiDraftEdited,
    discardAiDraft,
    repromptAi,
    setAiUnavailable,
    setAiError,
    resetAiDraft,
    search,
    setSearchQuery,
    clearSearch,
    activeBucket,
    setActiveBucket
  } = useClaudeInboxClient();

  const composerStates: ComposerStatus[] = [
    "idle",
    "saving-draft",
    "draft-saved",
    "validation-error",
    "sending",
    "sent-success",
    "send-failure"
  ];

  const aiStates: { label: string; action: () => void }[] = [
    { label: "Idle", action: resetAiDraft },
    {
      label: "Generating",
      action: () => {
        startAiGeneration("Draft a helpful reply");
      }
    },
    {
      label: "Inserted",
      action: () => {
        startAiGeneration("Draft a helpful reply");
        setTimeout(() => {
          insertAiDraft(
            "Hi Maya,\n\nThanks for confirming. The kit list is attached — see you on the 22nd.\n\nBest,\nJordan"
          );
        }, 100);
      }
    },
    {
      label: "Reprompting",
      action: () => {
        repromptAi("Make it shorter");
      }
    },
    { label: "Unavailable", action: setAiUnavailable },
    {
      label: "Error",
      action: () => {
        setAiError("AI service timed out. Please try again.");
      }
    },
    { label: "Edited", action: markAiDraftEdited },
    { label: "Discarded", action: discardAiDraft }
  ];

  return (
    <div className="sticky top-0 z-50 rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
      <h2 className="text-sm font-bold text-slate-900">
        Live Controls — drives the real inbox layout
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Toggle these to see the inbox (behind this page) update in real-time.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Loading toggles */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Loading
          </p>
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip
              active={isQueueLoading}
              onClick={() => {
                setQueueLoading(!isQueueLoading);
              }}
            >
              Queue
            </ToggleChip>
            <ToggleChip
              active={isTimelineLoading}
              onClick={() => {
                setTimelineLoading(!isTimelineLoading);
              }}
            >
              Timeline
            </ToggleChip>
          </div>
        </div>

        {/* Bucket tabs */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Bucket
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "new", "opened"] as const).map((b) => (
              <ToggleChip
                key={b}
                active={activeBucket === b}
                onClick={() => {
                  setActiveBucket(b);
                }}
              >
                {b}
              </ToggleChip>
            ))}
          </div>
        </div>

        {/* Composer status */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Composer
          </p>
          <div className="flex flex-wrap gap-1.5">
            {composerStates.map((s) => (
              <ToggleChip
                key={s}
                active={composerStatus === s}
                onClick={() => {
                  if (s === "validation-error") {
                    setComposerErrors([
                      { field: "subject", message: "Subject is required" }
                    ]);
                  }
                  setComposerStatus(s);
                }}
              >
                {s}
              </ToggleChip>
            ))}
          </div>
        </div>

        {/* AI status */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            AI Draft
          </p>
          <div className="flex flex-wrap gap-1.5">
            {aiStates.map((s) => (
              <ToggleChip
                key={s.label}
                active={
                  aiDraft.status ===
                  s.label.toLowerCase().replace(/ /g, "-")
                }
                onClick={s.action}
              >
                {s.label}
              </ToggleChip>
            ))}
          </div>
        </div>

        {/* Search */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Search
          </p>
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip
              active={search.isActive && search.query === "Maya"}
              onClick={() => {
                setSearchQuery("Maya");
              }}
            >
              &ldquo;Maya&rdquo;
            </ToggleChip>
            <ToggleChip
              active={
                search.isActive && search.query === "zzz_no_match"
              }
              onClick={() => {
                setSearchQuery("zzz_no_match");
              }}
            >
              No results
            </ToggleChip>
            <ToggleChip
              active={!search.isActive}
              onClick={clearSearch}
            >
              Clear
            </ToggleChip>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  children
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      )}
    >
      {children}
    </button>
  );
}

// ---------- Isolated state previews ----------

function AppLoadingPreview() {
  return (
    <div className="h-80 overflow-hidden">
      <ClaudeInboxAppLoading />
    </div>
  );
}

function QueueLoadingPreview() {
  return (
    <div className="w-[22rem] border-r border-slate-200">
      <QueueLoadingSkeleton />
    </div>
  );
}

function EmptyQueuePreview({ variant }: { readonly variant: "all" | "new" | "opened" }) {
  const messages: Record<string, { title: string; description: string }> = {
    all: {
      title: "All caught up",
      description: "No conversations in your inbox right now."
    },
    new: {
      title: "No new conversations",
      description: "New messages from contacts will appear here."
    },
    opened: {
      title: "No opened conversations",
      description: "Conversations you've viewed and are working on will appear here."
    }
  };
  const msg = messages[variant]!;

  return (
    <div className="w-[22rem] px-5 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <InboxIcon className="h-6 w-6 text-slate-400" />
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700">{msg.title}</p>
      <p className="mt-1 text-xs text-slate-500">{msg.description}</p>
    </div>
  );
}

function SearchNoResultsPreview() {
  return (
    <div className="w-[22rem] px-5 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <SearchXIcon className="h-6 w-6 text-slate-400" />
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700">No results</p>
      <p className="mt-1 text-xs text-slate-500">
        Nothing matches &ldquo;zzz_no_match&rdquo;. Try a different search.
      </p>
    </div>
  );
}

function SearchWithResultsPreview() {
  return (
    <div className="w-[22rem]">
      <div className="border-b border-slate-100 px-5 py-2">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">2</span> results for
          &ldquo;Maya&rdquo;
        </p>
      </div>
      <div className="flex gap-3 border-b border-slate-100 bg-sky-50/60 px-5 py-3.5 ring-1 ring-inset ring-sky-200">
        <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-semibold text-indigo-800">
          MP
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">
              <mark className="rounded bg-yellow-200/60 px-0.5">Maya</mark> Patel
            </p>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-sky-700">
              9:22 AM
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-medium text-slate-800">
            Re: Whitebark Pine — training confirmation
          </p>
        </div>
      </div>
    </div>
  );
}

function NoContactSelectedPreview() {
  return (
    <div className="h-64">
      <ClaudeInboxEmptyState />
    </div>
  );
}

function TimelineLoadingPreview() {
  return (
    <div className="bg-slate-50/40 p-6">
      <TimelineSkeleton />
    </div>
  );
}

function UnresolvedBannerPreview() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-amber-200 bg-amber-50/80">
      <button
        type="button"
        onClick={() => {
          setExpanded((e) => !e);
        }}
        className="flex w-full items-center gap-2 px-6 py-2.5 text-left transition-colors hover:bg-amber-100/60"
      >
        <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="flex-1 text-sm font-medium text-amber-900">
          Unresolved items need attention
        </span>
        <span className="text-xs text-amber-600">
          {expanded ? "Hide" : "Details"}
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-amber-200 px-6 py-3">
          <p className="text-xs leading-5 text-amber-800">
            This contact has open items that require action before the
            conversation can be considered resolved.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function FollowUpPreview({ isOn }: { readonly isOn: boolean }) {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <Button
        variant="outline"
        size="sm"
        aria-pressed={isOn}
        className={cn(
          "gap-1.5",
          isOn &&
            "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-800"
        )}
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
          ↩
        </span>
        Needs Follow Up
      </Button>
      <span className="text-xs text-slate-500">
        {isOn ? "Active — rose accent on list row" : "Inactive — default style"}
      </span>
    </div>
  );
}

function ComposerStatusPreview({
  status,
  label
}: {
  readonly status: ComposerStatus;
  readonly label: string;
}) {
  const StatusMap: Record<
    ComposerStatus,
    { icon: React.ReactNode; text: string; className: string }
  > = {
    idle: {
      icon: null,
      text: "Ready to compose",
      className: "text-slate-500"
    },
    "saving-draft": {
      icon: <LoaderIcon className="h-3 w-3 animate-spin" />,
      text: "Saving draft…",
      className: "text-slate-500"
    },
    "draft-saved": {
      icon: <CheckCircleIcon className="h-3 w-3" />,
      text: "Draft saved",
      className: "text-emerald-700"
    },
    "validation-error": {
      icon: <AlertCircleIcon className="h-3 w-3" />,
      text: "Fix errors above",
      className: "text-red-600"
    },
    sending: {
      icon: <LoaderIcon className="h-3 w-3 animate-spin" />,
      text: "Sending…",
      className: "text-slate-500"
    },
    "sent-success": {
      icon: <CheckCircleIcon className="h-3 w-3" />,
      text: "Message sent",
      className: "text-emerald-700"
    },
    "send-failure": {
      icon: <XCircleIcon className="h-3 w-3" />,
      text: "Failed to send",
      className: "text-red-600"
    }
  };

  const s = StatusMap[status];

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <span className={cn("flex items-center gap-1.5 text-xs", s.className)}>
        {s.icon}
        {s.text}
      </span>
      <div className="flex items-center gap-2">
        {status === "saving-draft" ? (
          <Button variant="ghost" size="sm" disabled>
            <LoaderIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Saving…
          </Button>
        ) : status === "draft-saved" ? (
          <Button variant="ghost" size="sm">
            <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
            Saved
          </Button>
        ) : (
          <Button variant="ghost" size="sm">
            Save draft
          </Button>
        )}
        <Button
          size="sm"
          className="gap-1.5"
          disabled={status === "sending" || status === "sent-success"}
        >
          {status === "sending" ? (
            <>
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Sending…
            </>
          ) : status === "sent-success" ? (
            <>
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Sent
            </>
          ) : (
            <>
              <SendIcon className="h-3.5 w-3.5" />
              Send
            </>
          )}
        </Button>
        {status === "send-failure" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-red-700"
          >
            <RefreshCwIcon className="mr-1 h-3 w-3" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ValidationErrorPreview() {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs">
        <label className="font-medium text-slate-700">Subject:</label>
        <input
          type="text"
          placeholder="Add a subject"
          className="flex-1 bg-transparent text-sm text-red-700 placeholder:text-red-400 focus:outline-none"
          readOnly
        />
      </div>
      <div className="border-t border-red-100 bg-red-50/50 px-5 py-2">
        <p className="flex items-center gap-1.5 text-xs text-red-700">
          <AlertCircleIcon className="h-3 w-3 shrink-0" />
          Subject is required
        </p>
      </div>
    </div>
  );
}

function AiStatePreview({
  status,
  children
}: {
  readonly status: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="border-b border-violet-200 bg-violet-50/50">
      {children}
    </div>
  );
}

// ---------- Page component ----------

export default function InboxStatesPage() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Inbox UI States
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Every product state rendered in isolation. Use the live controls
            to also drive the inbox layout visible in the background.
          </p>
        </div>

        {/* Live controls */}
        <LiveControls />

        {/* Table of contents */}
        <nav className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            States
          </h2>
          <div className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold tabular-nums text-slate-600">
                  {item.number}
                </span>
                {item.title}
              </a>
            ))}
          </div>
        </nav>

        {/* ===== APP CHROME ===== */}
        <div className="pt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            App Chrome
          </h2>
        </div>

        <Section id="app-loading" number={1} title="App Loading">
          <AppLoadingPreview />
        </Section>

        {/* ===== LIST COLUMN ===== */}
        <div className="pt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            List Column
          </h2>
        </div>

        <Section id="queue-loading" number={2} title="Queue Loading">
          <QueueLoadingPreview />
        </Section>

        <Section id="empty-queue-all" number={3} title="Empty Queue — All">
          <EmptyQueuePreview variant="all" />
        </Section>

        <Section id="empty-queue-new" number={4} title="Empty Queue — New">
          <EmptyQueuePreview variant="new" />
        </Section>

        <Section id="empty-queue-opened" number={5} title="Empty Queue — Opened">
          <EmptyQueuePreview variant="opened" />
        </Section>

        <Section
          id="search-with-results"
          number={6}
          title="Search Active — With Results"
        >
          <SearchWithResultsPreview />
        </Section>

        <Section
          id="search-no-results"
          number={7}
          title="Search Active — No Results"
        >
          <SearchNoResultsPreview />
        </Section>

        {/* ===== DETAIL WORKSPACE ===== */}
        <div className="pt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Detail Workspace
          </h2>
        </div>

        <Section
          id="no-contact-selected"
          number={8}
          title="No Contact Selected"
        >
          <NoContactSelectedPreview />
        </Section>

        <Section
          id="unresolved-banner"
          number={9}
          title="Unresolved Detail Banner / Panel"
        >
          <UnresolvedBannerPreview />
        </Section>

        <Section
          id="timeline-loading"
          number={10}
          title="Timeline Loading"
        >
          <TimelineLoadingPreview />
        </Section>

        <Section
          id="follow-up-off"
          number={11}
          title="Needs Follow Up — Off"
        >
          <FollowUpPreview isOn={false} />
        </Section>

        <Section
          id="follow-up-on"
          number={12}
          title="Needs Follow Up — On"
        >
          <FollowUpPreview isOn={true} />
        </Section>

        {/* ===== COMPOSER ===== */}
        <div className="pt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Composer
          </h2>
        </div>

        <Section id="composer-idle" number={13} title="Composer — Idle">
          <ComposerStatusPreview status="idle" label="Idle" />
        </Section>

        <Section
          id="composer-saving"
          number={14}
          title="Composer — Saving Draft"
        >
          <ComposerStatusPreview status="saving-draft" label="Saving" />
        </Section>

        <Section
          id="composer-saved"
          number={15}
          title="Composer — Draft Saved"
        >
          <ComposerStatusPreview status="draft-saved" label="Saved" />
        </Section>

        <Section
          id="composer-validation"
          number={16}
          title="Composer — Validation Error"
        >
          <ValidationErrorPreview />
          <ComposerStatusPreview
            status="validation-error"
            label="Validation Error"
          />
        </Section>

        <Section
          id="composer-sending"
          number={17}
          title="Composer — Sending"
        >
          <ComposerStatusPreview status="sending" label="Sending" />
        </Section>

        <Section
          id="composer-sent"
          number={18}
          title="Composer — Sent Success"
        >
          <ComposerStatusPreview status="sent-success" label="Sent" />
        </Section>

        <Section
          id="composer-failure"
          number={19}
          title="Composer — Send Failure"
        >
          <ComposerStatusPreview status="send-failure" label="Failure" />
        </Section>

        {/* ===== AI DRAFTING ===== */}
        <div className="pt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            AI Drafting
          </h2>
        </div>

        <Section id="ai-idle" number={20} title="AI — Idle (Button Ready)">
          <div className="flex items-center justify-end px-5 py-3">
            <Button variant="outline" size="sm" className="gap-1.5">
              <SparkleIcon className="h-3.5 w-3.5 text-violet-600" />
              Draft with AI
            </Button>
          </div>
        </Section>

        <Section
          id="ai-generating"
          number={21}
          title="AI — Generating"
        >
          <AiStatePreview status="generating">
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
                <BotIcon className="h-4 w-4 text-violet-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-violet-900">
                  Drafting a reply…
                </p>
                <div className="mt-1.5 flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          </AiStatePreview>
        </Section>

        <Section
          id="ai-inserted"
          number={22}
          title="AI Draft — Inserted into Composer"
        >
          <AiStatePreview status="inserted">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100">
                  <WandIcon className="h-4 w-4 text-violet-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-violet-800">
                    AI Draft Ready
                  </p>
                  <div className="mt-2 rounded-lg border border-violet-200 bg-white p-3">
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                      Hi Maya,{"\n\n"}Thanks for confirming. The kit list is
                      attached — see you on the 22nd.{"\n\n"}Best,{"\n"}Jordan
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                    >
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      Insert into composer
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <TrashIcon className="h-3.5 w-3.5" />
                      Discard
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 pl-11">
                <input
                  type="text"
                  placeholder="Adjust: 'Make it shorter', 'More formal'…"
                  className="flex-1 rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
                  readOnly
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <RotateCcwIcon className="h-3 w-3" />
                  Reprompt
                </Button>
              </div>
            </div>
          </AiStatePreview>
        </Section>

        <Section
          id="ai-reprompting"
          number={23}
          title="AI — Reprompt Action"
        >
          <AiStatePreview status="reprompting">
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
                <BotIcon className="h-4 w-4 text-violet-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-violet-900">
                  Regenerating draft…
                </p>
                <div className="mt-1.5 flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          </AiStatePreview>
        </Section>

        <Section
          id="ai-unavailable"
          number={24}
          title="AI — Unavailable Fallback"
        >
          <div className="p-4">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <WifiOffIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-600">
                AI drafting is currently unavailable. You can compose your
                reply manually, or try again later.
              </p>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-slate-400"
                disabled
              >
                <WifiOffIcon className="h-3.5 w-3.5" />
                AI unavailable
              </Button>
            </div>
          </div>
        </Section>

        <Section id="ai-error" number={25} title="AI — Error State">
          <div className="p-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircleIcon className="h-4 w-4 shrink-0 text-red-600" />
              <p className="flex-1 text-xs text-red-700">
                AI service timed out. Please try again.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-red-700 hover:text-red-900"
              >
                <RefreshCwIcon className="mr-1 h-3 w-3" />
                Try again
              </Button>
            </div>
          </div>
        </Section>

        <Section
          id="ai-edited"
          number={26}
          title="AI — Edited After Generation"
        >
          <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <PencilIcon className="h-3 w-3" />
              Edited
            </span>
            <span className="text-[11px] text-slate-400">
              Draft was generated by AI, then manually edited by the operator
            </span>
          </div>
        </Section>

        <Section
          id="ai-discarded"
          number={27}
          title="AI — Discarded Draft"
        >
          <div className="border-b border-violet-200 bg-violet-50/50">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <TrashIcon className="h-3 w-3" />
                AI draft discarded
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </Section>

        {/* Footer */}
        <div className="pb-10 pt-4 text-center text-xs text-slate-400">
          27 states — end of showcase
        </div>
      </div>
    </div>
  );
}

// ---------- Table of contents data ----------

const TOC = [
  { id: "app-loading", number: 1, title: "App Loading" },
  { id: "queue-loading", number: 2, title: "Queue Loading" },
  { id: "empty-queue-all", number: 3, title: "Empty Queue — All" },
  { id: "empty-queue-new", number: 4, title: "Empty Queue — New" },
  { id: "empty-queue-opened", number: 5, title: "Empty Queue — Opened" },
  { id: "search-with-results", number: 6, title: "Search — Results" },
  { id: "search-no-results", number: 7, title: "Search — No Results" },
  { id: "no-contact-selected", number: 8, title: "No Contact Selected" },
  { id: "unresolved-banner", number: 9, title: "Unresolved Banner" },
  { id: "timeline-loading", number: 10, title: "Timeline Loading" },
  { id: "follow-up-off", number: 11, title: "Follow Up — Off" },
  { id: "follow-up-on", number: 12, title: "Follow Up — On" },
  { id: "composer-idle", number: 13, title: "Composer — Idle" },
  { id: "composer-saving", number: 14, title: "Composer — Saving" },
  { id: "composer-saved", number: 15, title: "Composer — Saved" },
  { id: "composer-validation", number: 16, title: "Composer — Validation" },
  { id: "composer-sending", number: 17, title: "Composer — Sending" },
  { id: "composer-sent", number: 18, title: "Composer — Sent" },
  { id: "composer-failure", number: 19, title: "Composer — Failure" },
  { id: "ai-idle", number: 20, title: "AI — Idle" },
  { id: "ai-generating", number: 21, title: "AI — Generating" },
  { id: "ai-inserted", number: 22, title: "AI — Inserted" },
  { id: "ai-reprompting", number: 23, title: "AI — Reprompt" },
  { id: "ai-unavailable", number: 24, title: "AI — Unavailable" },
  { id: "ai-error", number: 25, title: "AI — Error" },
  { id: "ai-edited", number: 26, title: "AI — Edited" },
  { id: "ai-discarded", number: 27, title: "AI — Discarded" }
];
