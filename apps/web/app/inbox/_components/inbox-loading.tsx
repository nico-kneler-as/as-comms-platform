import { Skeleton } from "@/components/ui/skeleton";
import { SPACING, TONE } from "@/app/_lib/design-tokens";
import { LAYOUT } from "@/app/_lib/design-tokens-v2";
import {
  EMAIL_BUBBLE_MAX_W,
  TIMELINE_GRID_COLUMNS,
  TIMELINE_OUTER_MAX_W,
} from "./inbox-timeline-bubble";

/**
 * Full-screen app loading skeleton for the inbox home (`/inbox`).
 * Mirrors the 3-column shell + welcome dashboard so the user sees a
 * recognizable structure while data loads. The detail route
 * (`/inbox/[contactId]`) overrides this with `InboxDetailLoading`.
 */
export function InboxAppLoading() {
  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-slate-100 antialiased">
      {/* Icon rail skeleton */}
      <div
        className={`flex ${LAYOUT.iconRailWidth} shrink-0 flex-col items-center border-r border-slate-200 bg-white py-4`}
      >
        <Skeleton className="size-9 rounded-xl" />
        <div className="mt-4 flex flex-1 flex-col items-center gap-1">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="size-10 rounded-xl" />
        </div>
        <Skeleton className="mt-2 size-9 rounded-full" />
      </div>

      {/* List column skeleton */}
      <div
        className={`flex ${LAYOUT.listWidth} shrink-0 flex-col border-r border-slate-200 bg-white`}
      >
        <div className="border-b border-slate-200 px-4">
          <div className={`flex ${LAYOUT.headerHeight} items-center gap-2`}>
            <Skeleton className="h-5 w-24" />
            <div className="flex-1" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <div className="py-2.5">
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <QueueRowSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Welcome workload skeleton (right pane) */}
      <WelcomeWorkloadSkeleton />
    </div>
  );
}

/**
 * Skeleton for the inbox welcome dashboard. Mirrors the layout of
 * `InboxWelcomeWorkload`: header strip, quote card, active-project
 * mini-dashboard grid, and follow-up rail rows.
 */
export function WelcomeWorkloadSkeleton() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/40"
      role="status"
      aria-label="Loading welcome dashboard"
    >
      {/* Header strip — matches `Welcome back, X` + sync indicator */}
      <header
        className={`flex ${LAYOUT.welcomeHeaderHeight} shrink-0 items-center border-b border-slate-200 bg-white px-10`}
      >
        <div className="flex w-full items-baseline justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-3 w-28" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[920px] space-y-8 px-10 py-8">
        {/* Quote card */}
        <div className="rounded-xl border border-slate-200 bg-white p-7">
          <div className="flex items-start gap-5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-[80%]" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        {/* Active project lifecycle tiles — 3 stacked full-width tiles */}
        <div>
          <Skeleton className="h-3 w-44" />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ProjectLifecycleTileSkeleton key={i} />
            ))}
          </div>
        </div>

        {/* Follow-up rail — section label + 3 rows */}
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 3 }).map((_, i) => (
                <FollowUpRailRowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">Loading welcome dashboard...</span>
    </section>
  );
}

function ProjectLifecycleTileSkeleton() {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5 bg-slate-200"
      />
      <div className="grid gap-4 py-5 pl-6 pr-5 lg:grid-cols-[minmax(0,220px)_1fr]">
        <div className="flex min-w-0 flex-col items-start gap-2 rounded-xl px-2 py-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-20" />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProjectMetricTileSkeleton key={i} />
          ))}
        </div>
      </div>
    </article>
  );
}

function ProjectMetricTileSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <Skeleton className="h-3 w-16" />
      <div className="mt-2 flex items-baseline gap-2">
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="mt-3 flex items-end gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-1.5" />
        ))}
      </div>
    </div>
  );
}

function FollowUpRailRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24 rounded-full" />
        </div>
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-3 w-10 shrink-0" />
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
    </div>
  );
}

/**
 * Detail-pane loading state for contact route transitions. Keeps the inbox
 * shell stable and only placeholders the message-history workspace.
 */
export function InboxDetailLoading() {
  return (
    <div
      className="flex min-h-0 flex-1"
      role="status"
      aria-label="Loading conversation history"
    >
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <div
          className={`min-h-0 flex-1 overflow-y-auto ${TONE.slate.subtle} ${SPACING.container}`}
        >
          <TimelineSkeleton />
        </div>
      </section>
    </div>
  );
}

/**
 * Skeleton for a single queue row — avatar + 3 text lines.
 * Used inside both the full app loading state and the queue-only reload.
 */
export function QueueRowSkeleton() {
  return (
    <div className={`flex gap-3 border-b border-slate-100 ${SPACING.listItem}`}>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-2.5 w-3/4" />
      </div>
    </div>
  );
}

/**
 * Queue loading state: renders 5 skeleton rows inside the existing list
 * column chrome (header stays real, only rows pulse).
 */
export function QueueLoadingSkeleton({
  rowCount = 5,
  label = "Loading inbox conversations",
}: {
  readonly rowCount?: number;
  readonly label?: string;
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      role="status"
      aria-label={label}
    >
      {Array.from({ length: rowCount }).map((_, i) => (
        <QueueRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function QueueLoadMoreSkeleton({
  rowCount = 3,
}: {
  readonly rowCount?: number;
}) {
  return (
    <div className="pt-3" role="status" aria-label="Loading more conversations">
      <div className="space-y-0">
        {Array.from({ length: rowCount }).map((_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-48 max-w-full" />
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading timeline">
      <div
        className={`mx-auto grid w-full gap-x-2.5 gap-y-3 ${TIMELINE_OUTER_MAX_W} ${TIMELINE_GRID_COLUMNS}`}
      >
        <TimelineBubbleSkeleton
          direction="inbound"
          lineWidths={["w-full", "w-5/6", "w-3/4"]}
        />
        <TimelineBubbleSkeleton
          direction="outbound"
          lineWidths={["w-full", "w-5/6", "w-2/3"]}
        />
        <li className={`col-span-3 grid ${TIMELINE_GRID_COLUMNS}`}>
          <div className="col-start-2 flex py-1">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2">
              <Skeleton className="h-3 w-40 rounded-full" />
            </div>
          </div>
        </li>
        <TimelineBubbleSkeleton
          direction="inbound"
          lineWidths={["w-full", "w-4/5", "w-3/5"]}
        />
      </div>
      <span className="sr-only">Loading conversation...</span>
    </div>
  );
}

function TimelineBubbleSkeleton({
  direction,
  lineWidths,
}: {
  readonly direction: "inbound" | "outbound";
  readonly lineWidths: readonly string[];
}) {
  const isInbound = direction === "inbound";

  return (
    <li className={`col-span-3 grid ${TIMELINE_GRID_COLUMNS}`}>
      <div
        className={`row-span-1 self-end ${
          isInbound
            ? "col-start-1 flex justify-center"
            : "col-start-3 flex justify-center"
        }`}
      >
        <div aria-hidden="true" className="size-9 rounded-full bg-slate-200" />
      </div>
      <div
        className={`${
          isInbound
            ? "col-start-2 justify-self-start"
            : "col-start-2 justify-self-end"
        } w-full ${EMAIL_BUBBLE_MAX_W}`}
      >
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="space-y-2">
            {lineWidths.map((width, index) => (
              <Skeleton
                key={`${direction}-${index.toString()}`}
                className={`h-3 ${width}`}
              />
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}
