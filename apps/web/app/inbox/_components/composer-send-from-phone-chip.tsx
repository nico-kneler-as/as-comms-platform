"use client";

import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
  TYPE,
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
          `flex min-h-11 w-full items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 text-left ${RADIUS.md} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
          errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
        )}
      >
        {sender ? (
          <span className="block min-w-0">
            <span className="block truncate text-[13px] font-medium text-slate-900">
              {sender.phoneE164}
            </span>
            <span className={`mt-0.5 block truncate ${TYPE.caption}`}>
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
