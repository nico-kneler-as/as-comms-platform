"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import {
  CheckIcon,
  LoaderIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SparkleIcon,
  Trash2Icon,
} from "./icons";
import type { AiDraftState } from "./inbox-client-provider";

function DraftSkeleton() {
  return (
    <div className="space-y-1.5 rounded-md bg-slate-50/60 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <div className="h-2.5 w-[92%] animate-pulse rounded bg-slate-200/80" />
      <div className="h-2.5 w-[78%] animate-pulse rounded bg-slate-200/70" />
      <div className="h-2.5 w-[86%] animate-pulse rounded bg-slate-200/80" />
      <div className="h-2.5 w-[64%] animate-pulse rounded bg-slate-200/70" />
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
        `inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
        tone === "primary"
          ? "bg-violet-600 text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:text-white"
          : tone === "danger"
            ? "text-rose-600 hover:bg-rose-50 disabled:text-rose-300"
            : "text-slate-700 hover:bg-white disabled:text-slate-300",
        disabled ? "cursor-not-allowed" : "",
      )}
    >
      {children}
    </button>
  );
}

function DraftPreview({ text }: { readonly text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-md bg-slate-50/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-800 ring-1 ring-inset ring-slate-200">
      {text}
    </div>
  );
}

function DraftActionTrigger({
  disabled,
  disabledReason,
  isGenerating,
  onRun,
}: {
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly isGenerating: boolean;
  readonly onRun: () => void;
}) {
  const button = (
    <Button
      type="button"
      disabled={disabled}
      onClick={onRun}
      className="h-8 shrink-0 rounded-md bg-violet-600 px-3 text-[12px] font-medium text-white shadow-sm hover:bg-violet-700 disabled:bg-violet-300"
    >
      {isGenerating ? (
        <>
          <LoaderIcon className="size-3.5 animate-spin" />
          Drafting...
        </>
      ) : (
        <>
          <SparkleIcon className="size-3.5" />
          Draft with AI
        </>
      )}
    </Button>
  );

  if (disabledReason === null) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-pretty">
        {disabledReason}
      </TooltipContent>
    </Tooltip>
  );
}

export function ComposerAiDraftWindow({
  aiDraft,
  directiveText,
  repromptText,
  isGeneratingAi,
  runDraftDisabled,
  runDraftDisabledReason,
  onDirectiveTextChange,
  onRepromptTextChange,
  onRunDraft,
  onOpenReprompt,
  onSubmitReprompt,
  onCancelReprompt,
  onDiscard,
  onApprove,
  onAbout,
}: {
  readonly aiDraft: AiDraftState;
  readonly directiveText: string;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly runDraftDisabled: boolean;
  readonly runDraftDisabledReason: string | null;
  readonly onDirectiveTextChange: (value: string) => void;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onRunDraft: () => void;
  readonly onOpenReprompt: () => void;
  readonly onSubmitReprompt: () => void;
  readonly onCancelReprompt: () => void;
  readonly onDiscard: () => void;
  readonly onApprove: () => void;
  readonly onAbout: () => void;
}) {
  const status = aiDraft.status;
  const isReprompting = status === "reprompting";
  const showsDraft = status === "reviewable" || isReprompting;
  const showsEmptyState = !showsDraft;
  const trimmedReprompt = repromptText.trim();
  const canSubmitReprompt = trimmedReprompt.length > 0 && !isGeneratingAi;
  const canApprove = !isGeneratingAi && (!isReprompting || trimmedReprompt.length === 0);
  const canUseDraftActions = !isGeneratingAi;

  return (
    <section className="mx-4 mt-3 overflow-hidden rounded-xl border border-violet-200 bg-white ring-1 ring-violet-100">
      <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/40 px-3 py-2">
        <div className="flex size-5 items-center justify-center rounded-md bg-violet-100 text-violet-700">
          <SparkleIcon className="size-3.5" />
        </div>
        <p className="text-[12px] font-semibold text-slate-800">AI draft</p>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onAbout}
          className={`rounded px-1.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 ${FOCUS_RING}`}
        >
          About
        </button>
      </div>

      <div className="px-3 pb-3 pt-2">
        {showsEmptyState ? (
          <div className="flex items-start gap-2">
            <textarea
              value={directiveText}
              onChange={(event) => {
                onDirectiveTextChange(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !runDraftDisabled
                ) {
                  event.preventDefault();
                  onRunDraft();
                }
              }}
              placeholder='Optional: nudge the draft (e.g. "keep it brief, offer May 14 slot"). Or just click Draft with AI.'
              rows={2}
              disabled={isGeneratingAi}
              className={`flex-1 resize-none rounded-md bg-slate-50/60 px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-200 focus:outline-none focus:ring-violet-300 disabled:opacity-60 ${TRANSITION.reduceMotion}`}
            />
            <DraftActionTrigger
              disabled={runDraftDisabled}
              disabledReason={runDraftDisabledReason}
              isGenerating={isGeneratingAi}
              onRun={onRunDraft}
            />
          </div>
        ) : null}

        {status === "generating" ? (
          <div className="mt-2">
            <DraftSkeleton />
          </div>
        ) : null}

        {showsDraft ? (
          <div className="space-y-3">
            <DraftPreview text={aiDraft.generatedText} />

            {isReprompting ? (
              <div className="flex items-start gap-2">
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
                  placeholder='Reprompt — "shorter", "warmer tone", "add the meeting link"...'
                  disabled={isGeneratingAi}
                  className={`min-h-[64px] flex-1 resize-none rounded-md bg-white px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-800 placeholder:text-violet-400/80 ring-1 ring-inset ring-violet-200 focus:outline-none focus:ring-violet-400 disabled:opacity-60 ${TRANSITION.reduceMotion}`}
                />
                <button
                  type="button"
                  aria-label="Regenerate AI draft"
                  disabled={!canSubmitReprompt}
                  onClick={onSubmitReprompt}
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-violet-600 p-2 text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300 ${FOCUS_RING} ${TRANSITION.fast} ${TRANSITION.reduceMotion}`}
                >
                  <RotateCwIcon className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showsDraft ? (
        <div className="flex items-center gap-2 border-t border-violet-100 bg-violet-50/40 px-3 py-1.5">
          <div className="ml-auto flex items-center gap-1">
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
