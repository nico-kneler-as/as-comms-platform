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
      <div className="flex min-h-dvh flex-col bg-slate-100">
        <RunDetailHeader
          header={header}
          onStopUnsent={() => {
            setCancelOpen(true);
          }}
        />

        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-5">
          {metricsSection}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {emailContentSection}
              {recipientsSection}
            </div>
            <div className="space-y-4">{rightRailSection}</div>
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={`metric-skeleton-${String(index)}`}
            className="space-y-3 border-b border-slate-200 px-3.5 py-3 md:border-r xl:border-b-0"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DetailCardSkeleton() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </section>
  );
}

export function RecipientsTableSkeleton() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3.5 w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={`filter-skeleton-${String(index)}`}
            className="h-7 w-16 rounded-full"
          />
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-slate-200">
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
      </div>
    </section>
  );
}

export function RightRailSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }, (_, index) => (
        <section
          key={`rail-skeleton-${String(index)}`}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <Skeleton className="h-4 w-28" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </section>
      ))}
    </div>
  );
}
