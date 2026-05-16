"use client";

import { CheckCircle2, MailOpen, Newspaper } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { CampaignKind } from "@as-comms/contracts";

interface CampaignKindStepProps {
  readonly isAdmin: boolean;
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
  isAdmin,
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

      <TooltipProvider delayDuration={200}>
        <div className="mt-8 grid gap-4 xl:grid-cols-2">
          {OPTIONS.map((option) => {
            const disabled = option.value === "newsletter" && !isAdmin;
            const selected = value === option.value && !disabled;
            const card = (
              <button
                key={option.value}
                type="button"
                aria-disabled={disabled}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  onChange(option.value);
                }}
                className={cn(
                  "relative flex min-h-[220px] flex-col rounded-2xl border p-6 text-left transition-colors",
                  selected
                    ? "border-slate-950 bg-white text-slate-950 shadow-sm ring-1 ring-slate-950"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
                  disabled
                    ? "cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white"
                    : "",
                )}
              >
                {selected ? (
                  <CheckCircle2
                    className="absolute right-4 top-4 size-5 text-slate-950"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl",
                      selected
                        ? "bg-slate-950 text-white"
                        : "bg-slate-100 text-slate-700",
                    )}
                  >
                    <option.Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                      selected
                        ? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                        : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
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
                      selected ? "text-slate-600" : "text-slate-600",
                    )}
                  >
                    {option.description}
                  </p>
                </div>
              </button>
            );

            if (!disabled) {
              return <div key={option.value}>{card}</div>;
            }

            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>{card}</TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-pretty">
                  Newsletter sends are admin-only. Ask an admin to launch this
                  campaign.
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

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
