"use client";

import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";

import type { InboxSmsSenderOption } from "../_lib/view-models";

export function SendFromPhoneChip({
  sender,
  errorMessage,
}: {
  readonly sender: InboxSmsSenderOption | null;
  readonly errorMessage?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div
        aria-invalid={errorMessage ? true : undefined}
        className={cn(
          `inline-flex min-h-8 max-w-full items-center gap-2 border border-slate-200 bg-white px-2.5 py-1 text-left ${RADIUS.md} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
          errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
        )}
      >
        {sender ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-sky-400" />
            <span className="truncate text-[13px] font-medium text-slate-900">
              {sender.phoneE164}
            </span>
            <span className="shrink-0 text-[13px] text-slate-400">·</span>
            <span className="truncate text-[13px] text-slate-600">
              {sender.displayName}
            </span>
          </span>
        ) : (
          <span className="text-[13px] text-slate-400">
            No active sender configured
          </span>
        )}
      </div>
      {errorMessage ? (
        <p className="text-xs text-rose-700">{errorMessage}</p>
      ) : null}
    </div>
  );
}
