import type { RunState } from "@as-comms/contracts";

import { cn } from "@/lib/utils";

const STATE_CLASS: Record<RunState, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  sending: "bg-amber-50 text-amber-800 ring-amber-200",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  finalized: "bg-slate-200 text-slate-700 ring-slate-300",
  cancelled: "bg-rose-50 text-rose-800 ring-rose-200",
};

const STATE_LABEL: Record<RunState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  complete: "Complete",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

export function RunStateChip({ state }: { readonly state: RunState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
        STATE_CLASS[state],
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}
