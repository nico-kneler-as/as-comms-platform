"use client";

import { CheckCircle2, Mail, MessageSquare, PanelTop } from "lucide-react";

import { cn } from "@/lib/utils";

import type { LaunchType } from "@as-comms/contracts";

import { StepHeader, WizardFooter } from "./wizard-shell";

interface LaunchTypeStepProps {
  readonly value: LaunchType;
  readonly onChange: (value: LaunchType) => void;
  readonly onContinue: () => void;
}

const OPTIONS = [
  {
    value: "normal_email",
    title: "Normal Email",
    description: "Quick to write, plain or lightly formatted.",
    Icon: Mail,
    disabled: false,
    tag: null,
  },
  {
    value: "html_email",
    title: "HTML Email",
    description:
      "Drag-and-drop newsletter-quality emails with images and richer layout.",
    Icon: PanelTop,
    disabled: true,
    tag: "COMING SOON",
  },
  {
    value: "sms",
    title: "SMS",
    description: "Short text messages sent to volunteers' phones.",
    Icon: MessageSquare,
    disabled: true,
    tag: "COMING SOON",
  },
] as const;

export function LaunchTypeStep({
  value,
  onChange,
  onContinue,
}: LaunchTypeStepProps) {
  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title="Choose the launch type"
        description="Phase A ships the Normal Email path first; the wizard previews the full broadcast model so the next options are visible up front."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {OPTIONS.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={!option.disabled && selected}
              aria-disabled={option.disabled}
              disabled={option.disabled}
              onClick={() => {
                if (!option.disabled) {
                  onChange(option.value);
                }
              }}
              className={cn(
                "relative flex min-h-[190px] flex-col rounded-xl border bg-white p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                option.disabled
                  ? "cursor-not-allowed border-dashed border-slate-200 bg-slate-50/60 text-slate-400"
                  : selected
                    ? "border-slate-900 text-slate-950 shadow-sm ring-1 ring-slate-900/15"
                    : "border-slate-200 text-slate-900 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              {selected ? (
                <CheckCircle2
                  className="absolute right-4 top-4 size-5 text-slate-900"
                  aria-hidden="true"
                />
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-lg",
                    option.disabled
                      ? "bg-white text-slate-400 ring-1 ring-slate-200"
                      : selected
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700",
                  )}
                >
                  <option.Icon className="size-5" aria-hidden="true" />
                </span>
                {option.tag ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                    {option.tag}
                  </span>
                ) : null}
              </div>

              <div className="mt-8">
                <h3 className="text-balance text-[14px] font-semibold">
                  {option.title}
                </h3>
                <p className="mt-2 text-pretty text-[12px] leading-relaxed text-slate-600">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
        Phase A ships Normal Email only. HTML Email arrives once the
        drag-and-drop builder lands; SMS follows.
      </p>

      <WizardFooter primaryLabel="Continue" primaryAction={onContinue} />
    </section>
  );
}
