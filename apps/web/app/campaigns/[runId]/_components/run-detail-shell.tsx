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

export function RunDetailShell({ model }: { readonly model: RunDetailModel }) {
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
      <div className="flex min-h-dvh flex-col bg-slate-100">
        <RunDetailHeader
          run={model.run}
          senderAlias={model.senderAlias}
          kindLabel={model.kindLabel}
          dateLabel={model.dateLabel}
          dateIso={model.dateIso}
          canStopUnsent={model.canStopUnsent}
          canDuplicate={model.canDuplicate}
          onStopUnsent={() => {
            setCancelOpen(true);
          }}
        />

        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <MetricTiles model={model} />
              <RecipientsTable
                runId={model.run.id}
                rows={model.recipients}
                total={model.recipientTotal}
              />
            </div>
            <div className="space-y-4">
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
