"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { CampaignRunRecord } from "@as-comms/contracts";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

import { duplicateCampaignRun } from "../../actions";
import { LocalDateTime } from "./local-date-time";
import { RunStateChip } from "./run-state-chip";

export function RunDetailHeader({
  run,
  senderAlias,
  kindLabel,
  dateLabel,
  dateIso,
  canStopUnsent,
  onStopUnsent,
}: {
  readonly run: CampaignRunRecord;
  readonly senderAlias: string | null;
  readonly kindLabel: "Project" | "Newsletter";
  readonly dateLabel: string;
  readonly dateIso: string;
  readonly canStopUnsent: boolean;
  readonly onStopUnsent: () => void;
}) {
  const router = useRouter();
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <RunStateChip state={run.state} />
            <Chip tone="neutral">{kindLabel}</Chip>
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-slate-950">
            {run.subjectTemplate?.trim() ?? "Untitled campaign"}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            <span>Sender {senderAlias ?? "Not set yet"}</span>
            <span>
              {dateLabel} <LocalDateTime iso={dateIso} />
            </span>
          </div>
          {duplicateError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {duplicateError}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await duplicateCampaignRun(run.id);
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
            {pending ? "Duplicating…" : "Duplicate"}
          </Button>
          {canStopUnsent ? (
            <Button variant="destructive" onClick={onStopUnsent}>
              Stop unsent
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
