"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import {
  ArrowLeftIcon,
  CheckIcon,
  LoaderIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SparkleIcon,
  Trash2Icon,
} from "./icons";
import type { AiDraftState } from "./inbox-client-provider";

type AiDraftAccent = "violet" | "sky";

const INTENT_TEXTAREA_MIN_HEIGHT_PX = 44;
const INTENT_TEXTAREA_MAX_HEIGHT_PX = 132;
const INTENT_TEXTAREA_MIN_ROWS = 2;
const INTENT_TEXTAREA_MAX_ROWS = 6;

const AI_DRAFT_ACCENT_CLASSES = {
  violet: {
    section: "border-violet-200 ring-violet-100",
    header: "border-violet-100 bg-violet-50/40",
    iconWrap: "bg-violet-100 text-violet-700",
    icon: "text-violet-500",
    textareaFocus: "focus:ring-violet-300",
    repromptPlaceholder: "placeholder:text-violet-400/80",
    repromptRing: "ring-violet-200 focus:ring-violet-400",
    primary:
      "bg-violet-600 text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:text-white",
    footer: "border-violet-100 bg-violet-50/40",
  },
  sky: {
    section: "border-sky-200 ring-sky-100",
    header: "border-sky-100 bg-sky-50/50",
    iconWrap: "bg-sky-100 text-sky-700",
    icon: "text-sky-500",
    textareaFocus: "focus:ring-sky-300",
    repromptPlaceholder: "placeholder:text-sky-400/80",
    repromptRing: "ring-sky-200 focus:ring-sky-400",
    primary:
      "bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-300 disabled:text-white",
    footer: "border-sky-100 bg-sky-50/50",
  },
} as const;

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
  accent = "violet",
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly tone?: "ghost" | "danger" | "primary";
  readonly accent?: AiDraftAccent;
}) {
  const accentClasses = AI_DRAFT_ACCENT_CLASSES[accent];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        `inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
        tone === "primary"
          ? accentClasses.primary
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
    <div className="custom-scrollbar max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-800 ring-1 ring-inset ring-slate-200">
      {text}
    </div>
  );
}

function autosizeIntentTextarea(textarea: HTMLTextAreaElement | null) {
  if (textarea === null) {
    return;
  }

  const parsePx = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  const paddingBlock = parsePx(styles.paddingTop) + parsePx(styles.paddingBottom);
  const borderBlock = parsePx(styles.borderTopWidth) + parsePx(styles.borderBottomWidth);
  const hasMeasuredLineHeight = Number.isFinite(lineHeight) && lineHeight > 0;
  const minHeight = hasMeasuredLineHeight
    ? Math.max(
        INTENT_TEXTAREA_MIN_HEIGHT_PX,
        lineHeight * INTENT_TEXTAREA_MIN_ROWS + paddingBlock + borderBlock,
      )
    : INTENT_TEXTAREA_MIN_HEIGHT_PX;
  const maxHeight = hasMeasuredLineHeight
    ? Math.max(
        minHeight,
        lineHeight * INTENT_TEXTAREA_MAX_ROWS + paddingBlock + borderBlock,
      )
    : INTENT_TEXTAREA_MAX_HEIGHT_PX;

  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${String(Math.max(nextHeight, minHeight))}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function DraftActionTrigger({
  disabled,
  disabledReason,
  isGenerating,
  onRun,
  icon,
  label,
  accent = "violet",
}: {
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly isGenerating: boolean;
  readonly onRun: () => void;
  readonly icon: ReactNode;
  readonly label: string;
  readonly accent?: AiDraftAccent;
}) {
  const accentClasses = AI_DRAFT_ACCENT_CLASSES[accent];
  const button = (
    <Button
      type="button"
      disabled={disabled}
      onClick={onRun}
      className={cn(
        "h-8 shrink-0 rounded-md px-3 text-[12px] font-medium shadow-sm",
        accentClasses.primary,
      )}
    >
      {isGenerating ? (
        <>
          <LoaderIcon className="size-3.5 animate-spin" />
          {label === "Polish" ? "Polishing..." : "Drafting..."}
        </>
      ) : (
        <>
          {icon}
          {label}
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
  tone = "email",
  directivePlaceholder = 'Provide an intent first, or click the "Draft with AI" button directly',
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
  onEditPrompt,
  onDiscard,
  onApprove,
}: {
  readonly tone?: "email" | "sms";
  readonly directivePlaceholder?: string;
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
  readonly onEditPrompt: () => void;
  readonly onDiscard: () => void;
  readonly onApprove: () => void;
}) {
  const status = aiDraft.status;
  const isReprompting = status === "reprompting";
  const showsDraft = status === "reviewable" || isReprompting;
  const showsEmptyState = !showsDraft;
  const trimmedReprompt = repromptText.trim();
  const canSubmitReprompt = trimmedReprompt.length > 0 && !isGeneratingAi;
  const canApprove = !isGeneratingAi && (!isReprompting || trimmedReprompt.length === 0);
  const canUseDraftActions = !isGeneratingAi;
  const accent: AiDraftAccent = tone === "sms" ? "sky" : "violet";
  const accentClasses = AI_DRAFT_ACCENT_CLASSES[accent];
  const directiveTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    autosizeIntentTextarea(directiveTextareaRef.current);
  }, [directiveText]);

  return (
    <section
      className={cn(
        "mx-4 mt-3 min-w-0 overflow-hidden rounded-lg border bg-white ring-1",
        // overflow-hidden zeroes the flex min-height:auto content floor, so
        // inside the editor's min-h-0 flex chain this card can be crushed to
        // a sliver (clipping the header + intent row). Refuse to shrink in
        // the compact states; while a draft is under review the card stays
        // shrinkable so the 40vh preview can negotiate space with the editor.
        !showsDraft && "shrink-0",
        accentClasses.section,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-1.5",
          accentClasses.header,
        )}
      >
        <div
          className={cn(
            "flex size-5 items-center justify-center rounded-md",
            accentClasses.iconWrap,
          )}
        >
          <SparkleIcon className={cn("size-3.5", accentClasses.icon)} />
        </div>
        <p className="text-[12px] font-semibold text-slate-800">AI draft</p>
      </div>

      <div className="min-w-0 px-3 pb-2.5 pt-2">
        {showsEmptyState ? (
          <div className="flex min-w-0 items-start gap-2">
            <textarea
              ref={directiveTextareaRef}
              autoFocus
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
              placeholder={directivePlaceholder}
              rows={INTENT_TEXTAREA_MIN_ROWS}
              disabled={isGeneratingAi}
              className={cn(
                `min-h-[44px] min-w-0 flex-1 resize-none rounded-md bg-slate-50/60 px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-200 focus:outline-none disabled:opacity-60 ${TRANSITION.reduceMotion}`,
                accentClasses.textareaFocus,
              )}
            />
            <div className="flex shrink-0">
              <DraftActionTrigger
                disabled={runDraftDisabled}
                disabledReason={runDraftDisabledReason}
                isGenerating={isGeneratingAi}
                onRun={onRunDraft}
                icon={<SparkleIcon className="size-3.5" />}
                label="Draft with AI"
                accent={accent}
              />
            </div>
          </div>
        ) : null}

        {status === "generating" ? (
          <div className="mt-2">
            <DraftSkeleton />
          </div>
        ) : null}

        {showsDraft ? (
          <div className="min-h-0 space-y-3">
            <DraftPreview text={aiDraft.generatedText} />

            {isReprompting ? (
              <div className="flex min-w-0 items-start gap-2">
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
                  className={cn(
                    `min-h-[64px] min-w-0 flex-1 resize-none rounded-md bg-white px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-800 ring-1 ring-inset focus:outline-none disabled:opacity-60 ${TRANSITION.reduceMotion}`,
                    accentClasses.repromptPlaceholder,
                    accentClasses.repromptRing,
                  )}
                />
                <button
                  type="button"
                  aria-label="Regenerate AI draft"
                  disabled={!canSubmitReprompt}
                  onClick={onSubmitReprompt}
                  className={cn(
                    `inline-flex size-9 shrink-0 items-center justify-center rounded-md p-2 shadow-sm disabled:cursor-not-allowed ${FOCUS_RING} ${TRANSITION.fast} ${TRANSITION.reduceMotion}`,
                    accentClasses.primary,
                  )}
                >
                  <RotateCwIcon className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showsDraft ? (
        <div
          className={cn(
            "flex items-center gap-2 border-t px-3 py-1.5",
            accentClasses.footer,
          )}
        >
          <div className="ml-auto flex items-center gap-1">
            {!isReprompting ? (
              <AiDraftActionButton
                onClick={onEditPrompt}
                disabled={!canUseDraftActions}
              >
                <ArrowLeftIcon className="size-3.5" />
                Edit prompt
              </AiDraftActionButton>
            ) : null}
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
              accent={accent}
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
