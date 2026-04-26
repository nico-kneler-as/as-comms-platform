import type { ReactNode } from "react";
import { Check, Mail, Sparkles } from "lucide-react";

export function StepSuccess({
  aliasDraft,
  projectName,
  aliasesCount
}: {
  readonly aliasDraft: string;
  readonly projectName: string;
  readonly aliasesCount: number;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-emerald-50">
        <Check className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-[18px] font-semibold text-slate-900">
        {aliasDraft.trim()} is live
      </h2>
      <p className="mt-1 max-w-[420px] text-[13px] text-slate-500">
        {projectName} is now routing mail and the AI drafter has Notion context
        for every new thread.
      </p>
      <div className="mt-6 grid w-full max-w-[420px] grid-cols-3 gap-3">
        <SuccessStat
          icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />}
          label="Aliases"
          value={String(aliasesCount)}
        />
        <SuccessStat
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          label="Notion"
          value="Synced"
        />
        <SuccessStat
          icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
          label="Status"
          value="Live"
        />
      </div>
    </div>
  );
}

function SuccessStat({
  icon,
  label,
  value
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-[14px] font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}
