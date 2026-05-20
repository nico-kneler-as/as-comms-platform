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

export function AudiencePreviewList({
  rows,
  loading,
  errorMessage,
}: AudiencePreviewListProps) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-500">
          <Eye className="size-3.5" aria-hidden="true" />
          Audience preview
        </div>
        <div className="space-y-3 px-4 py-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={`audience-preview-skeleton-${String(index)}`}
              className="flex items-center gap-3"
            >
              <Skeleton className="size-10 shrink-0 rounded-full bg-slate-200/70" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3.5 w-32 bg-slate-200/80" />
                  <Skeleton className="h-5 w-20 rounded-full bg-slate-200/70" />
                </div>
                <Skeleton className="h-3 w-44 bg-slate-100" />
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

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-500">
        <Eye className="size-3.5" aria-hidden="true" />
        First {String(rows.length)} recipients
      </div>
      <div className="max-h-[340px] overflow-y-auto">
        {rows.map((row, index) => (
          <div
            key={row.contactId}
            className={cn(
              "grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm",
              index < rows.length - 1 ? "border-b border-slate-100" : "",
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
