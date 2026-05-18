"use client";

import { Check, Circle, Megaphone } from "lucide-react";

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

export function WizardRail({
  steps,
  currentStep,
  statusLabel,
  onStepChange,
}: WizardRailProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-slate-50 lg:w-[286px] lg:border-b-0 lg:border-r">
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#253746] text-white">
            <Megaphone className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">
              New campaign
            </p>
            <p className="text-[11.5px] text-slate-500">
              Step {String(currentStep + 1)} of {String(steps.length)}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] font-medium text-emerald-800">
          <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />
          {statusLabel}
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
                  "relative z-10 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left",
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
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
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

      <div className="border-t border-slate-200 px-5 py-4 max-lg:hidden">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          You&apos;ll set up
        </div>
        <ul className="mt-2 space-y-1 text-[11.5px] text-slate-600">
          {steps.map((step, index) => (
            <ChecklistRow
              key={step.id}
              label={step.title}
              ok={index <= currentStep}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ChecklistRow({
  label,
  ok,
}: {
  readonly label: string;
  readonly ok: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
      ) : (
        <Circle className="size-3.5 text-slate-300" aria-hidden="true" />
      )}
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </li>
  );
}
