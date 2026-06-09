"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { duplicateCampaignRun } from "../../actions";
import type { RunDetailHeaderModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

const STATE_CHIP_CLASS: Record<RunDetailHeaderModel["state"], string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  sending: "bg-amber-50 text-amber-800 ring-amber-200",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  finalized: "bg-slate-200 text-slate-700 ring-slate-300",
  cancelled: "bg-rose-50 text-rose-800 ring-rose-200",
};

const STATE_DOT_CLASS: Record<RunDetailHeaderModel["state"], string> = {
  draft: "bg-slate-400",
  scheduled: "bg-sky-500",
  sending: "bg-amber-500",
  complete: "bg-emerald-500",
  finalized: "bg-slate-400",
  cancelled: "bg-rose-500",
};

const STATE_LABEL: Record<RunDetailHeaderModel["state"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  complete: "Complete",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

export function RunDetailHeader({
  header,
  onStopUnsent,
}: {
  readonly header: RunDetailHeaderModel;
  readonly onStopUnsent: () => void;
}) {
  const router = useRouter();
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chipClass = STATE_CHIP_CLASS[header.state];
  const dotClass = STATE_DOT_CLASS[header.state];
  const stateLabel = STATE_LABEL[header.state];

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-8 py-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Link
            href="/broadcasts"
            className="mb-2 inline-flex text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            ‹ Broadcasts
          </Link>
          <h1 className="text-balance text-[20px] font-semibold tracking-tight text-slate-950">
            {header.subject}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span
              role="status"
              aria-label={`Status: ${stateLabel}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                chipClass,
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", dotClass)}
                aria-hidden="true"
              />
              {header.projectLabel ? (
                <>
                  <span className="max-w-[200px] truncate">
                    {header.projectLabel}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-3 opacity-60" />
                </>
              ) : null}
              <span>{stateLabel}</span>
            </span>
            <span className="text-[11.5px] text-slate-500">
              {header.dateLabel} <LocalDateTime iso={header.dateIso} />
            </span>
          </div>
          {duplicateError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              {duplicateError}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {header.canDuplicate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              className="gap-2"
              onClick={() => {
                startTransition(async () => {
                  const result = await duplicateCampaignRun(header.runId);
                  if (!result.ok) {
                    setDuplicateError(result.message);
                    return;
                  }

                  setDuplicateError(null);
                  router.push(
                    `/broadcasts/new?runId=${encodeURIComponent(result.data.runId)}`,
                  );
                });
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              {pending ? "Duplicating…" : "Duplicate"}
            </Button>
          ) : null}
          {header.canStopUnsent ? (
            <Button variant="destructive" size="sm" onClick={onStopUnsent}>
              Stop unsent
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
