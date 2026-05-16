"use client";

import { Mail, MessageSquare, PanelTop } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { LaunchType } from "@as-comms/contracts";

interface LaunchTypeStepProps {
  readonly value: LaunchType;
  readonly onChange: (value: LaunchType) => void;
  readonly onContinue: () => void;
}

const OPTIONS = [
  {
    value: "normal_email",
    title: "Normal Email",
    description:
      "Quick to write, plain or lightly formatted. Best for project updates, calls to action, and short messages.",
    Icon: Mail,
    disabled: false,
    tag: "AVAILABLE NOW",
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
      <div>
        <p className="text-[11px] font-semibold uppercase text-slate-500">
          Step 1
        </p>
        <h2 className="mt-2 text-balance text-2xl font-semibold text-slate-900">
          Choose the launch type
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-500">
          Phase A ships the Normal Email path first, but the wizard makes the
          full campaign model visible now so operators know what is coming next.
        </p>
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-3">
        {OPTIONS.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="button"
              aria-disabled={option.disabled}
              disabled={option.disabled}
              onClick={() => {
                if (!option.disabled) {
                  onChange(option.value);
                }
              }}
              className={cn(
                "flex min-h-[220px] flex-col rounded-3xl border p-6 text-left transition-colors",
                option.disabled
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                  : selected
                    ? "border-[#253746] bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl",
                    option.disabled
                      ? "bg-white text-slate-400 ring-1 ring-slate-200"
                      : selected
                        ? "bg-white/10 text-white"
                        : "bg-slate-100 text-slate-700",
                  )}
                >
                  <option.Icon className="size-5" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                    option.disabled
                      ? "bg-white text-slate-500 ring-1 ring-slate-200"
                      : selected
                        ? "bg-white/10 text-white"
                        : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
                  )}
                >
                  {option.tag}
                </span>
              </div>

              <div className="mt-10">
                <h3 className="text-balance text-lg font-semibold">
                  {option.title}
                </h3>
                <p
                  className={cn(
                    "mt-3 text-pretty text-sm leading-6",
                    option.disabled
                      ? "text-slate-500"
                      : selected
                        ? "text-slate-200"
                        : "text-slate-600",
                  )}
                >
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        Phase A ships Normal Email only. HTML Email arrives once the drag-and-drop
        builder lands; SMS follows.
      </div>

      <div className="mt-auto flex justify-end border-t border-slate-200 pt-6">
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </section>
  );
}
