"use client";

import { Eye } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { AudiencePreviewRow } from "../../_lib/audience-data-source";

interface AudiencePreviewListProps {
  readonly rows: readonly AudiencePreviewRow[];
  readonly loading: boolean;
  readonly errorMessage: string | null;
}

// Cap rendered rows + lock the scroll viewport to ~4 rows tall.
const PREVIEW_ROW_CAP = 10;
const PREVIEW_VIEWPORT_HEIGHT = "max-h-[200px]";

export function AudiencePreviewList({
  rows,
  loading,
  errorMessage,
}: AudiencePreviewListProps) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <Eye className="size-3.5" aria-hidden="true" />
          Audience preview
        </div>
        <div className="space-y-3 px-4 py-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={`audience-preview-skeleton-${String(index)}`}
              className="flex items-center gap-3"
            >
              <Skeleton className="size-8 shrink-0 rounded-full bg-slate-200/70" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32 bg-slate-200/80" />
                <Skeleton className="h-2.5 w-44 bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (errorMessage !== null) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
        {errorMessage}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
        No matching recipients to preview yet.
      </div>
    );
  }

  const visibleRows = rows.slice(0, PREVIEW_ROW_CAP);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <Eye className="size-3.5" aria-hidden="true" />
        First {String(visibleRows.length)} recipients
      </div>
      <div className={cn(PREVIEW_VIEWPORT_HEIGHT, "overflow-y-auto")}>
        {visibleRows.map((row, index) => (
          <div
            key={row.contactId}
            className={cn(
              "grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-2.5 text-[12.5px]",
              index < visibleRows.length - 1 ? "border-b border-slate-100" : "",
            )}
            style={{ contentVisibility: "auto" }}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{row.name}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-slate-600">{row.email}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-slate-500">
                {row.projectAlias ?? row.project ?? "No project"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
