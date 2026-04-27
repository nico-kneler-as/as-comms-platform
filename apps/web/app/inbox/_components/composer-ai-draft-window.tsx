"use client";

import type { ReactNode } from "react";

import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import {
  CheckIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SparkleIcon,
  Trash2Icon,
} from "./icons";
import type { AiDraftState } from "./inbox-client-provider";

function DraftSkeleton() {
  return (
    <div className="mt-3 space-y-2" aria-label="AI draft is generating">
      <div className="h-3 w-[88%] animate-pulse rounded bg-violet-100" />
      <div className="h-3 w-[72%] animate-pulse rounded bg-violet-100" />
      <div className="h-3 w-[81%] animate-pulse rounded bg-violet-100" />
      <div className="h-3 w-[64%] animate-pulse rounded bg-violet-100" />
    </div>
  );
}

function AiDraftActionButton({
  children,
  disabled = false,
  onClick,
  tone = "ghost",
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly tone?: "ghost" | "danger" | "primary";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        `inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
        tone === "primary"
          ? "bg-violet-600 text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:text-white"
          : tone === "danger"
            ? "text-rose-600 hover:bg-rose-50 disabled:text-rose-300"
            : "text-slate-600 hover:bg-white/80 hover:text-slate-900 disabled:text-slate-300",
        disabled ? "cursor-not-allowed" : "",
      )}
    >
      {children}
    </button>
  );
}

function DraftPreview({ text }: { readonly text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-md border border-violet-100 bg-white px-3 py-2.5 text-[13px] italic leading-relaxed text-slate-600">
      {text}
    </div>
  );
}

export function ComposerAiDraftWindow({
  aiDraft,
  repromptText,
  isGeneratingAi,
  onRepromptTextChange,
  onOpenReprompt,
  onSubmitReprompt,
  onCancelReprompt,
  onDiscard,
  onApprove,
  onAbout,
}: {
  readonly aiDraft: AiDraftState;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onOpenReprompt: () => void;
  readonly onSubmitReprompt: () => void;
  readonly onCancelReprompt: () => void;
  readonly onDiscard: () => void;
  readonly onApprove: () => void;
  readonly onAbout: () => void;
}) {
  const status = aiDraft.status;

  if (
    status !== "generating" &&
    status !== "reviewable" &&
    status !== "reprompting"
  ) {
    return null;
  }

  const isReprompting = status === "reprompting";
  const trimmedReprompt = repromptText.trim();
  const canSubmitReprompt = trimmedReprompt.length > 0 && !isGeneratingAi;
  const canApprove = !isGeneratingAi && (!isReprompting || trimmedReprompt.length === 0);
  const canUseDraftActions = !isGeneratingAi;

  return (
    <section className="mx-5 mb-3 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-center gap-2">
        <SparkleIcon className="size-3.5 text-violet-700" />
        <p className="text-[12px] font-semibold text-slate-800">AI draft</p>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onAbout}
          className={`rounded px-1.5 py-1 text-[11px] text-violet-700 hover:underline ${FOCUS_RING}`}
        >
          About
        </button>
      </div>

      {status === "generating" ? <DraftSkeleton /> : null}

      {status === "reviewable" || isReprompting ? (
        <div className="mt-3">
          <DraftPreview text={aiDraft.generatedText} />

          {isReprompting ? (
            <div className="mt-3 flex items-start gap-2">
              <textarea
                autoFocus
                value={repromptText}
                onChange={(event) => {
                  onRepromptTextChange(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelReprompt();
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (canSubmitReprompt) {
                      onSubmitReprompt();
                    }
                  }
                }}
                placeholder="Type instructions..."
                disabled={isGeneratingAi}
                className={`min-h-[64px] flex-1 resize-none rounded-lg border border-violet-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:opacity-60 ${TRANSITION.reduceMotion}`}
              />
              <button
                type="button"
                aria-label="Regenerate AI draft"
                disabled={!canSubmitReprompt}
                onClick={onSubmitReprompt}
                className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${TRANSITION.fast} ${TRANSITION.reduceMotion}`}
              >
                <RotateCwIcon className="size-4" />
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-end gap-2">
            <AiDraftActionButton
              onClick={isReprompting ? onCancelReprompt : onOpenReprompt}
              disabled={!canUseDraftActions}
            >
              <RotateCcwIcon className="size-3.5" />
              {isReprompting ? "Cancel reprompt" : "Reprompt"}
            </AiDraftActionButton>
            <AiDraftActionButton
              tone="danger"
              onClick={onDiscard}
              disabled={!canUseDraftActions}
            >
              <Trash2Icon className="size-3.5" />
              Discard
            </AiDraftActionButton>
            <AiDraftActionButton
              tone="primary"
              onClick={onApprove}
              disabled={!canApprove}
            >
              <CheckIcon className="size-3.5" />
              Approve
            </AiDraftActionButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
