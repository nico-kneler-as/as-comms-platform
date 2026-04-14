import type { ClaudeAvatarTone } from "../_lib/view-models.js";

const TONE_CLASSES: Record<ClaudeAvatarTone, string> = {
  indigo: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  emerald: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  rose: "bg-rose-100 text-rose-800 ring-rose-200",
  sky: "bg-sky-100 text-sky-800 ring-sky-200",
  violet: "bg-violet-100 text-violet-800 ring-violet-200",
  teal: "bg-teal-100 text-teal-800 ring-teal-200",
  slate: "bg-slate-200 text-slate-700 ring-slate-300"
};

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base"
} as const;

interface ClaudeInboxAvatarProps {
  readonly initials: string;
  readonly tone: ClaudeAvatarTone;
  readonly size?: keyof typeof SIZE_CLASSES;
}

export function ClaudeInboxAvatar({
  initials,
  tone,
  size = "md"
}: ClaudeInboxAvatarProps) {
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
