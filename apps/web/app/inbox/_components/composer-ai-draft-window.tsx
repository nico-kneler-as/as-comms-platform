"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RADIUS, SHADOW, TRANSITION } from "@/app/_lib/design-tokens-v2";

import {
  BotIcon,
  LoaderIcon,
  RotateCcwIcon,
  SparkleIcon,
  XIcon,
} from "./icons";
import type { AiDraftStatus } from "./inbox-client-provider";

function DraftSkeleton() {
  return (
    <div className={`border border-violet-200 bg-violet-50/40 p-4 ${RADIUS.md}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {["Tier 1", "Tier 2", "Tier 3", "Tier 4"].map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-full border border-violet-200 bg-white px-2 py-1 text-[11px] text-violet-700"
          >
            <LoaderIcon className="mr-1 h-3 w-3 animate-spin" />
            {label}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-[88%] animate-pulse rounded bg-violet-100" />
        <div className="h-3 w-[72%] animate-pulse rounded bg-violet-100" />
        <div className="h-3 w-[81%] animate-pulse rounded bg-violet-100" />
        <div className="h-3 w-[64%] animate-pulse rounded bg-violet-100" />
      </div>
    </div>
  );
}

function LifecycleBanner({
  status,
  onDiscard,
  onRegenerate,
  onAbout,
}: {
  readonly status: Extract<AiDraftStatus, "inserted" | "edited-after-generation">;
  readonly onDiscard: () => void;
  readonly onRegenerate: () => void;
  readonly onAbout: () => void;
}) {
  const edited = status === "edited-after-generation";

  return (
    <div
      className={cn(
        `flex flex-col gap-3 border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${RADIUS.md} ${SHADOW.sm}`,
        edited
          ? "border-amber-200 bg-amber-50/70"
          : "border-emerald-200 bg-emerald-50/70",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            edited ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700",
          )}
        >
          {edited ? <BotIcon className="size-4" /> : <SparkleIcon className="size-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {edited ? "You've edited this draft" : "AI draft inserted"}
          </p>
          <p className="text-xs text-slate-600">
            {edited
              ? "Regenerate to replace your edits, or discard the AI state and keep writing."
              : "Review and keep editing before you send."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onAbout}>
          About this draft
        </Button>
        {edited ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onRegenerate}>
              <RotateCcwIcon className="size-4" />
              Regenerate
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
              Discard changes
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
            <XIcon className="size-4" />
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

export function ComposerAiDraftWindow({
  lifecycle,
  onDiscard,
  onRegenerate,
  onAbout,
}: {
  readonly lifecycle: AiDraftStatus;
  readonly onDiscard: () => void;
  readonly onRegenerate: () => void;
  readonly onAbout: () => void;
}) {
  if (lifecycle === "idle" || lifecycle === "discarded") {
    return null;
  }

  if (lifecycle === "generating" || lifecycle === "reprompting") {
    return (
      <div className={`mx-5 border-x border-slate-200 bg-white px-4 py-4 ${TRANSITION.reduceMotion}`}>
        <DraftSkeleton />
      </div>
    );
  }

  if (lifecycle === "inserted" || lifecycle === "edited-after-generation") {
    return (
      <div className={`mx-5 border-x border-slate-200 bg-white px-4 py-4 ${TRANSITION.reduceMotion}`}>
        <LifecycleBanner
          status={lifecycle}
          onDiscard={onDiscard}
          onRegenerate={onRegenerate}
          onAbout={onAbout}
        />
      </div>
    );
  }

  return null;
}
