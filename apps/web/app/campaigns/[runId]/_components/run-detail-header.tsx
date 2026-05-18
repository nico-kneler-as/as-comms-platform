"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

import { duplicateCampaignRun } from "../../actions";
import type { RunDetailHeaderModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";
import { RunStateChip } from "./run-state-chip";

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

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-6 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Link
            href="/campaigns"
            className="mb-2 inline-flex text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            ‹ Campaigns
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <RunStateChip state={header.state} />
            <Chip tone="neutral">{header.kindLabel}</Chip>
            {header.senderAlias ? (
              <span className="font-mono text-xs text-slate-500">
                {header.senderAlias}
              </span>
            ) : null}
          </div>
          <h1 className="mt-2 text-balance text-[20px] font-semibold tracking-tight text-slate-950">
            {header.subject}
          </h1>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1.5 text-[12px] text-slate-600">
            {header.preheader ? (
              <>
                <span>{header.preheader}</span>
                <span className="text-slate-400">·</span>
              </>
            ) : null}
            <span>
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
                    `/campaigns/new?runId=${encodeURIComponent(result.data.runId)}`,
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
