"use client";

import { MailOpen, Newspaper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CampaignKind } from "@as-comms/contracts";

interface CampaignKindStepProps {
  readonly value: CampaignKind;
  readonly onChange: (value: CampaignKind) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

const OPTIONS = [
  {
    value: "project",
    title: "Project email",
    description: "A targeted message for a specific project's volunteers.",
    tag: "PRIMARY USE CASE IN PHASE A",
    Icon: MailOpen,
  },
  {
    value: "newsletter",
    title: "Newsletter",
    description: "The monthly AS newsletter.",
    tag: "MIGRATING FROM MAILCHIMP IN PHASE C",
    Icon: Newspaper,
  },
] as const;

export function CampaignKindStep({
  value,
  onChange,
  onBack,
  onContinue,
}: CampaignKindStepProps) {
  return (
    <section className="flex h-full flex-col">
      <div>
        <p className="text-[11px] font-semibold uppercase text-slate-500">
          Step 2
        </p>
        <h2 className="mt-2 text-balance text-2xl font-semibold text-slate-900">
          Choose the campaign kind
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-500">
          This choice controls the unsubscribe footer wording and is part of the
          frozen record operators inspect later.
        </p>
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
              }}
              className={cn(
                "flex min-h-[220px] flex-col rounded-3xl border p-6 text-left transition-colors",
                selected
                  ? "border-[#253746] bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl",
                    selected ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700",
                  )}
                >
                  <option.Icon className="size-5" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                    selected
                      ? "bg-white/10 text-white"
                      : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
                  )}
                >
                  {option.tag}
                </span>
              </div>

              <div className="mt-10">
                <h3 className="text-balance text-lg font-semibold">{option.title}</h3>
                <p
                  className={cn(
                    "mt-3 text-pretty text-sm leading-6",
                    selected ? "text-slate-200" : "text-slate-600",
                  )}
                >
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        The kind you pick changes the unsubscribe footer wording. Project emails
        offer two unsubscribe scopes (this project / all AS); newsletter offers
        just one.
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-6">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </section>
  );
}
