"use client";

import { FOCUS_RING, RADIUS, SHADOW, TRANSITION } from "@/app/_lib/design-tokens-v2";

import { MailIcon, NoteIcon } from "./icons";

export function ComposerCollapsedPill({
  personName,
  onExpand,
  onNote,
}: {
  readonly personName: string;
  readonly onExpand: () => void;
  readonly onNote: () => void;
}) {
  return (
    <div className="border-t border-slate-200 bg-white px-5 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExpand}
          className={`group flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:border-slate-300 hover:shadow`}
        >
          <MailIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-500" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-400">
            Reply to {personName}...
          </span>
          <span
            className={`hidden items-center gap-1 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline-flex ${RADIUS.sm}`}
          >
            R
          </span>
        </button>
        <button
          type="button"
          onClick={onNote}
          className={`flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-500 ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-700`}
        >
          <NoteIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Note</span>
        </button>
      </div>
    </div>
  );
}
