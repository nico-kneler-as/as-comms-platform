import type { AudienceCriteria } from "@as-comms/contracts";

import type { RunAuditEntry } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

function labelForAction(action: string): string {
  switch (action) {
    case "campaign_run.created":
      return "Created";
    case "campaign_run.duplicated":
      return "Duplicated";
    case "campaign_run.scheduled":
      return "Scheduled";
    case "campaign_run.send_started":
      return "Started";
    case "campaign_run.batch_sent":
      return "Batch sent";
    case "campaign_run.completed":
      return "Completed";
    case "campaign_run.cancelled":
      return "Cancelled";
    case "campaign_run.finalized":
      return "Finalized";
    default:
      return action;
  }
}

export function RunAuditLog({
  entries,
  audienceCriteria,
}: {
  readonly entries: readonly RunAuditEntry[];
  readonly audienceCriteria: AudienceCriteria;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Run audit log
        </h2>
        <div className="mt-3 space-y-3">
          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
              No audit entries recorded yet.
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <div className="text-[12.5px] font-medium text-slate-900">
                  {labelForAction(entry.action)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  <LocalDateTime iso={entry.occurredAt} /> · {entry.actorLabel}
                </div>
                {entry.detail ? (
                  <div className="mt-1 text-[12px] text-slate-600">
                    {entry.detail}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Audience criteria snapshot
        </h2>
        <pre className="mt-3 max-h-[260px] overflow-x-auto rounded-lg bg-slate-950 px-3 py-3 text-[11px] leading-5 text-slate-100">
          {JSON.stringify(audienceCriteria, null, 2)}
        </pre>
      </section>
    </div>
  );
}
