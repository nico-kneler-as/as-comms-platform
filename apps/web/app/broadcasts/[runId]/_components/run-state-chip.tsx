import type { RunState } from "@as-comms/contracts";
import {
  Archive,
  Calendar,
  Check,
  Pencil,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const STATE_CLASS: Record<RunState, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  sending: "bg-amber-50 text-amber-800 ring-amber-200",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  finalized: "bg-slate-200 text-slate-700 ring-slate-300",
  cancelled: "bg-rose-50 text-rose-800 ring-rose-200",
};

const LIST_STATE_META: Record<
  RunState,
  { readonly Icon: LucideIcon; readonly className: string }
> = {
  draft: { Icon: Pencil, className: "text-slate-500" },
  scheduled: { Icon: Calendar, className: "text-indigo-600" },
  sending: { Icon: Send, className: "text-sky-600" },
  complete: { Icon: Check, className: "text-emerald-600" },
  finalized: { Icon: Archive, className: "text-slate-500" },
  cancelled: { Icon: X, className: "text-rose-600" },
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
    const { Icon, className } = LIST_STATE_META[state];

    return (
      <span
        role="status"
        aria-label={`Status: ${label}`}
        className={cn("inline-flex items-center gap-1 text-[11px] font-medium", className)}
      >
        <Icon aria-hidden="true" className="size-3" />
        {label}
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
