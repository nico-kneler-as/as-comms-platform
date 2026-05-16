"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { RunDetailModel } from "../_lib/run-detail";
import { CancelModal } from "./cancel-modal";
import { MetricTiles } from "./metric-tiles";
import { RecipientsTable } from "./recipients-table";
import { RepliesInInboxPanel } from "./replies-in-inbox-panel";
import { RunAuditLog } from "./run-audit-log";
import { RunDetailHeader } from "./run-detail-header";

export function RunDetailShell({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (model.run.state !== "sending") {
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
  }, [model.run.state, router]);

  return (
    <>
      <div className="flex min-h-dvh flex-col bg-slate-100 px-8 py-8">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
          <RunDetailHeader
            run={model.run}
            senderAlias={model.senderAlias}
            kindLabel={model.kindLabel}
            dateLabel={model.dateLabel}
            dateIso={model.dateIso}
            canStopUnsent={model.canStopUnsent}
            onStopUnsent={() => {
              setCancelOpen(true);
            }}
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <MetricTiles model={model} />
              <RecipientsTable rows={model.recipients} />
            </div>
            <div className="space-y-6">
              <RepliesInInboxPanel
                repliesCount={model.repliesCount}
                recentReplies={model.recentReplies}
                href={model.inboxRecipientsHref}
              />
              <RunAuditLog
                entries={model.auditEntries}
                audienceCriteria={model.audienceCriteria}
              />
            </div>
          </div>
        </div>
      </div>

      <CancelModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        runId={model.run.id}
        sentCount={model.sentCount}
        totalAudience={model.totalAudience}
      />
    </>
  );
}
