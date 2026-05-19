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

const LIST_STATE_CLASS: Record<RunState, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  scheduled: "bg-violet-50 text-violet-700 ring-violet-200",
  sending: "bg-sky-50 text-sky-700 ring-sky-200",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  finalized: "bg-slate-200 text-slate-700 ring-slate-300",
  cancelled: "bg-rose-50 text-rose-800 ring-rose-200",
};

const LIST_STATE_DOT_CLASS: Record<RunState, string> = {
  draft: "bg-slate-400",
  scheduled: "bg-violet-500",
  sending: "bg-sky-500",
  complete: "bg-emerald-500",
  finalized: "bg-slate-500",
  cancelled: "bg-rose-500",
};

const STATE_LABEL: Record<RunState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  complete: "Complete",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

export function RunStateChip({
  state,
  variant = "default",
}: {
  readonly state: RunState;
  readonly variant?: "default" | "list";
}) {
  const label = STATE_LABEL[state];
  if (variant === "list") {
    return (
      <span
        role="status"
        aria-label={`Status: ${label}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide ring-1 ring-inset",
          LIST_STATE_CLASS[state],
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", LIST_STATE_DOT_CLASS[state])}
        />
        {label.toUpperCase()}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
        STATE_CLASS[state],
      )}
    >
      {label}
    </span>
  );
}
