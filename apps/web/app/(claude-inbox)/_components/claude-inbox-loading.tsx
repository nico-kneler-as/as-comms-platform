import { Skeleton } from "@/components/ui/skeleton";
import { LAYOUT, SPACING, TONE } from "@/app/_lib/design-tokens";

/**
 * Full-screen app loading skeleton. Mirrors the 3-column layout
 * (icon rail + list column + detail workspace) with pulsing placeholders
 * so the user sees a recognizable structure while data loads.
 */
export function ClaudeInboxAppLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 antialiased">
      {/* Icon rail skeleton */}
      <div className={`flex ${LAYOUT.iconRailWidth} shrink-0 flex-col items-center border-r border-slate-200 bg-white py-4`}>
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="mt-4 flex flex-1 flex-col items-center gap-1">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <Skeleton className="mt-2 h-9 w-9 rounded-full" />
      </div>

      {/* List column skeleton */}
      <div className={`flex ${LAYOUT.listWidth} shrink-0 flex-col border-r border-slate-200 bg-white`}>
        <div className="border-b border-slate-200 px-5">
          <div className={`flex ${LAYOUT.headerHeight} items-center gap-2`}>
            <Skeleton className="h-5 w-24" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <div className="pb-4 pt-1">
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <QueueRowSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Detail workspace skeleton */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className={`flex ${LAYOUT.headerHeight} items-center gap-4 border-b border-slate-200 px-6`}>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="hidden h-4 w-px sm:block" />
          <Skeleton className="hidden h-4 w-48 sm:block" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className={`flex-1 ${TONE.slate.subtle} ${SPACING.container}`}>
          <TimelineSkeleton />
        </div>
        <div className="border-t border-slate-200 px-5 py-4">
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
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
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
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
export function QueueLoadingSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <QueueRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Timeline loading skeleton. Mirrors the alternating left/right bubble
 * pattern of the real timeline.
 */
export function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading timeline">
      {/* Inbound bubble (left) */}
      <div className="flex w-full flex-col items-start">
        <Skeleton className="mb-1 h-3 w-24" />
        <Skeleton className="h-20 w-[70%] rounded-2xl rounded-bl-md" />
        <Skeleton className="mt-1 h-3 w-16" />
      </div>

      {/* Outbound bubble (right) */}
      <div className="flex w-full flex-col items-end">
        <Skeleton className="mb-1 h-3 w-20" />
        <Skeleton className="h-16 w-[65%] rounded-2xl rounded-br-md" />
        <Skeleton className="mt-1 h-3 w-14" />
      </div>

      {/* System event (centered-left) */}
      <div className="flex w-full items-center justify-start">
        <Skeleton className="h-6 w-56 rounded-full" />
      </div>

      {/* Outbound bubble (right) */}
      <div className="flex w-full flex-col items-end">
        <Skeleton className="mb-1 h-3 w-28" />
        <Skeleton className="h-24 w-[75%] rounded-2xl rounded-br-md" />
        <Skeleton className="mt-1 h-3 w-16" />
      </div>

      {/* Inbound bubble (left) */}
      <div className="flex w-full flex-col items-start">
        <Skeleton className="mb-1 h-3 w-20" />
        <Skeleton className="h-14 w-[60%] rounded-2xl rounded-bl-md" />
        <Skeleton className="mt-1 h-3 w-12" />
      </div>

      <span className="sr-only">Loading conversation...</span>
    </div>
  );
}
