import { Check, Circle, Plus, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import { ACTIVATION_WIZARD_STEPS } from "./shared";

interface SidebarChecklistState {
  readonly 0: boolean;
  readonly 1: boolean;
  readonly 2: boolean;
  readonly 3: boolean;
}

export function SidebarChecklist({
  currentStep,
  stepValid,
  activated
}: {
  readonly currentStep: number;
  readonly stepValid: SidebarChecklistState;
  readonly activated: boolean;
}) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-slate-100 bg-slate-50/70">
      <div className="border-b border-slate-100 px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">
              Activate project
            </p>
            <p className="text-[11.5px] text-slate-500">
              Step {String(Math.min(currentStep + 1, ACTIVATION_WIZARD_STEPS.length))} of{" "}
              {String(ACTIVATION_WIZARD_STEPS.length)}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-3 py-4">
        {ACTIVATION_WIZARD_STEPS.map((step, index) => {
          const state = activated
            ? "done"
            : index < currentStep
              ? "done"
              : index === currentStep
                ? "current"
                : "upcoming";
          const lineDone = activated || index < currentStep;

          return (
            <div key={step.title} className="relative">
              {index < ACTIVATION_WIZARD_STEPS.length - 1 ? (
                <span
                  className={cn(
                    "absolute left-[21px] top-8 h-[calc(100%-14px)] w-px",
                    lineDone ? "bg-emerald-300" : "bg-slate-200"
                  )}
                  aria-hidden="true"
                />
              ) : null}

              <div
                className={cn(
                  "relative z-10 flex items-start gap-3 rounded-xl px-3 py-3",
                  state === "current"
                    ? "bg-white shadow-sm ring-1 ring-slate-200"
                    : ""
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    state === "done"
                      ? "bg-emerald-500 text-white"
                      : state === "current"
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-400 ring-1 ring-slate-200"
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
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
                        : "font-medium text-slate-900"
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    {step.subtitle}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="m-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          Activation checklist
        </div>
        <ul className="mt-3 space-y-2 text-[11.5px]">
          <ChecklistRow label="Alias set" ok={stepValid[0]} />
          <ChecklistRow label="Primary inbox alias" ok={stepValid[1]} />
          <ChecklistRow label="Email signature" ok={stepValid[2]} />
          <ChecklistRow label="Notion knowledge synced" ok={stepValid[3]} />
        </ul>
      </div>
    </aside>
  );
}

function ChecklistRow({
  label,
  ok
}: {
  readonly label: string;
  readonly ok: boolean;
}) {
  return (
    <li className="flex items-center gap-2 text-slate-600">
      {ok ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
      ) : (
        <Circle className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
      )}
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </li>
  );
}
