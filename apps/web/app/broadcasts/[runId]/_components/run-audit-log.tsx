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
    case "campaign_run.web_version_published":
      return "Web version published";
    case "campaign_run.web_version_unpublished":
      return "Web version unpublished";
    default:
      return action;
  }
}

export function RunAuditLog({
  entries,
}: {
  readonly entries: readonly RunAuditEntry[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Audit log
        </h2>
      </div>
      <ul className="space-y-2.5 px-4 py-3 text-[11.5px]">
        {entries.length === 0 ? (
          <li className="text-[11.5px] italic text-slate-500">
            No audit entries recorded yet.
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2">
              <span
                className="mt-1 size-1.5 shrink-0 rounded-full bg-slate-400"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {labelForAction(entry.action)}
                  </span>
                  <span className="text-[10.5px] tabular-nums text-slate-500">
                    <LocalDateTime iso={entry.occurredAt} />
                  </span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-slate-500">
                  {entry.actorLabel}
                </div>
                {entry.detail ? (
                  <div className="mt-0.5 text-[11px] italic text-slate-600">
                    "{entry.detail}"
                  </div>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
