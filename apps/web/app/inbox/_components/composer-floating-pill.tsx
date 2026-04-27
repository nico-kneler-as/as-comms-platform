"use client";

import {
  FOCUS_RING,
  RADIUS,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import type { ComposerPaneState } from "../_lib/composer-ui";
import { ChevronUpIcon, MailIcon, NoteIcon, XIcon } from "./icons";
import { useInboxClient } from "./inbox-client-provider";

export function resolveFloatingComposerLabel(
  composerPane: ComposerPaneState,
): string {
  if (composerPane.mode === "new-draft") {
    return "New message";
  }

  if (composerPane.mode === "replying") {
    if (composerPane.initialTab === "note") {
      return `Note about ${composerPane.replyContext.contactDisplayName}`;
    }

    const subject = composerPane.replyContext.subject.trim();
    const base =
      subject.length > 0
        ? subject
        : composerPane.replyContext.contactDisplayName;

    return /^re:/iu.test(base) ? base : `Re: ${base}`;
  }

  return "Composer";
}

export function ComposerFloatingPill() {
  const { composerPane, composerView, closeComposer, expandComposer } =
    useInboxClient();

  if (composerView !== "pill" || composerPane.mode === "closed") {
    return null;
  }

  const isNote =
    composerPane.mode === "replying" && composerPane.initialTab === "note";
  const label = resolveFloatingComposerLabel(composerPane);

  return (
    <aside
      role="region"
      aria-label="Minimized composer"
      className={cn(
        `fixed bottom-4 right-4 z-40 flex h-11 w-[300px] items-center gap-2 border border-slate-200 bg-white px-3 shadow-xl ring-1 ring-slate-900/5 ${RADIUS.lg}`,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500"
      >
        {isNote ? (
          <NoteIcon className="size-3.5" />
        ) : (
          <MailIcon className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-800">
        {label}
      </span>
      <button
        type="button"
        aria-label="Expand composer"
        className={cn(
          `inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-100 hover:text-slate-700`,
        )}
        onClick={expandComposer}
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close composer"
        className={cn(
          `inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-100 hover:text-slate-700`,
        )}
        onClick={closeComposer}
      >
        <XIcon className="size-3.5" />
      </button>
    </aside>
  );
}
