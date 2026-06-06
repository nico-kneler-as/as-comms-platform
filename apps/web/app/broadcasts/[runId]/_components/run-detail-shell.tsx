"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";

import type { RunDetailHeaderModel } from "../_lib/run-detail";
import { CancelModal } from "./cancel-modal";
import { RunDetailHeader } from "./run-detail-header";

export function RunDetailShell({
  header,
  metricsSection,
  emailContentSection,
  recipientsSection,
  rightRailSection,
}: {
  readonly header: RunDetailHeaderModel;
  readonly metricsSection: ReactNode;
  readonly emailContentSection: ReactNode;
  readonly recipientsSection: ReactNode;
  readonly rightRailSection: ReactNode;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (header.state !== "sending") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [header.state, router]);

  return (
    <>
      <div className="flex min-h-dvh flex-col bg-slate-50">
        <RunDetailHeader
          header={header}
          onStopUnsent={() => {
            setCancelOpen(true);
          }}
        />

        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-8 py-6">
          {metricsSection}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              {emailContentSection}
              {recipientsSection}
            </div>
            <div className="space-y-5">{rightRailSection}</div>
          </div>
        </div>
      </div>

      <CancelModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        runId={header.runId}
        sentCount={null}
        totalAudience={header.totalAudience}
      />
    </>
  );
}

export function MetricTilesSkeleton() {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={`metric-skeleton-${String(index)}`}
          className="space-y-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-start justify-between">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </section>
  );
}

export function DetailCardSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="space-y-3 px-4 py-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </section>
  );
}

export function RecipientsTableSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-[260px]" />
      </div>
      <div className="flex gap-2 border-b border-slate-200 px-3 py-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={`filter-skeleton-${String(index)}`}
            className="h-7 w-16 rounded-md"
          />
        ))}
      </div>
      <div className="space-y-3 px-4 py-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={`recipient-skeleton-${String(index)}`}
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_150px] gap-3"
          >
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RightRailSkeleton() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }, (_, index) => (
        <section
          key={`rail-skeleton-${String(index)}`}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="space-y-3 px-4 py-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </section>
      ))}
    </div>
  );
}
