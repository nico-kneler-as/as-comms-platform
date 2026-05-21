"use client";

import { Check, Megaphone } from "lucide-react";

import { cn } from "@/lib/utils";

export type CampaignWizardStepId =
  | "launch"
  | "setup"
  | "audience"
  | "compose"
  | "preview"
  | "review";

export interface CampaignWizardStepDefinition {
  readonly id: CampaignWizardStepId;
  readonly title: string;
  readonly subtitle: string;
}

interface WizardRailProps {
  readonly steps: readonly CampaignWizardStepDefinition[];
  readonly currentStep: number;
  readonly statusLabel: string;
  readonly onStepChange: (index: number) => void;
}

function readStatusTone(
  statusLabel: string,
): "saving" | "error" | "saved" | "dirty" {
  if (/sav(ing|e failed|ailed)|fail/i.test(statusLabel)) {
    if (/fail/i.test(statusLabel)) {
      return "error";
    }
    return "saving";
  }
  if (/unsaved/i.test(statusLabel)) {
    return "dirty";
  }
  return "saved";
}

const STATUS_TONE_CLASS: Record<
  ReturnType<typeof readStatusTone>,
  { container: string; dot: string }
> = {
  saved: {
    container: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  saving: {
    container: "border-slate-200 bg-white text-slate-600",
    dot: "bg-slate-400 animate-pulse",
  },
  dirty: {
    container: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  error: {
    container: "border-rose-200 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
};

const PROGRESS_LINE_WIDTH = 286;

export function WizardRail({
  steps,
  currentStep,
  statusLabel,
  onStepChange,
}: WizardRailProps) {
  const tone = readStatusTone(statusLabel);
  const toneClass = STATUS_TONE_CLASS[tone];
  const progressPercent = Math.round(((currentStep + 1) / steps.length) * 100);

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-slate-50 lg:w-[286px] lg:border-b-0 lg:border-r"
      style={{ minWidth: PROGRESS_LINE_WIDTH }}
    >
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#253746] text-white">
            <Megaphone className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-900">
              New broadcast
            </p>
            <p className="text-[11px] tabular-nums text-slate-500">
              Step {String(currentStep + 1)} of {String(steps.length)}
            </p>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="mt-4 h-1 overflow-hidden rounded-full bg-slate-200"
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${String(progressPercent)}%` }}
          />
        </div>

        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[11.5px] font-medium",
            toneClass.container,
          )}
        >
          <span
            className={cn("inline-block size-1.5 rounded-full", toneClass.dot)}
            aria-hidden="true"
          />
          <span className="truncate">{statusLabel}</span>
        </div>
      </div>

      <div className="flex-1 px-3 py-3 max-lg:hidden">
        {steps.map((step, index) => {
          const state =
            index < currentStep
              ? "done"
              : index === currentStep
                ? "current"
                : "upcoming";
          const lineDone = index < currentStep;

          return (
            <div key={step.id} className="relative">
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[20px] top-8 h-[calc(100%-14px)] w-px",
                    lineDone ? "bg-emerald-300" : "bg-slate-200",
                  )}
                />
              ) : null}

              <button
                type="button"
                onClick={() => {
                  onStepChange(index);
                }}
                disabled={index > currentStep}
                aria-current={index === currentStep ? "step" : undefined}
                className={cn(
                  "relative z-10 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                  state === "current"
                    ? "bg-white shadow-sm ring-1 ring-slate-200"
                    : "",
                  index > currentStep
                    ? "cursor-not-allowed opacity-70"
                    : "transition-colors hover:bg-white/70",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                    state === "done"
                      ? "bg-emerald-500 text-white"
                      : state === "current"
                        ? "bg-[#253746] text-white"
                        : "bg-white text-slate-400 ring-1 ring-slate-200",
                  )}
                >
                  {state === "done" ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : (
                    String(index + 1)
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[12.5px]",
                      state === "upcoming"
                        ? "text-slate-500"
                        : "font-medium text-slate-900",
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                    {step.subtitle}
                  </p>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
