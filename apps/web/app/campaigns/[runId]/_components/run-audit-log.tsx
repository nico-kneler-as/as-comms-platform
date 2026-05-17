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
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Run audit log
        </h2>
        <div className="mt-4 space-y-4">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              No audit entries recorded yet.
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="border-l-2 border-slate-200 pl-4">
                <div className="text-sm font-medium text-slate-900">
                  {labelForAction(entry.action)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  <LocalDateTime iso={entry.occurredAt} /> · {entry.actorLabel}
                </div>
                {entry.detail ? (
                  <div className="mt-1 text-sm text-slate-600">
                    {entry.detail}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Audience criteria snapshot
        </h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
          {JSON.stringify(audienceCriteria, null, 2)}
        </pre>
      </section>
    </div>
  );
}
