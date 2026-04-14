import type { ReactNode } from "react";

type ChipTone = "neutral" | "info" | "warn" | "success";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200"
};

interface ClaudeInboxChipProps {
  readonly tone?: ChipTone;
  readonly children: ReactNode;
  readonly icon?: ReactNode;
}

export function ClaudeInboxChip({
  tone = "neutral",
  children,
  icon
}: ClaudeInboxChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {icon ? <span className="flex h-3 w-3 items-center">{icon}</span> : null}
      {children}
    </span>
  );
}
