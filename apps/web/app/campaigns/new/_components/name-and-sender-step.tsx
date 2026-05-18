"use client";

import { CheckCircle2, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { PostmarkSenderStatus } from "@as-comms/contracts";

import type { CampaignSenderOption } from "../../_lib/audience-data-source";

interface NameAndSenderStepProps {
  readonly name: string;
  readonly fromEmail: string | null;
  readonly senderOptions: readonly CampaignSenderOption[];
  readonly frozen: boolean;
  readonly onNameChange: (value: string) => void;
  readonly onFromEmailChange: (value: string | null) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

const SENDER_STATUS_META: Record<
  PostmarkSenderStatus,
  {
    readonly label: string;
    readonly chipLabel: string;
    readonly selectable: boolean;
    readonly chipClassName: string;
    readonly tooltip: string | null;
  }
> = {
  verified: {
    label: "verified",
    chipLabel: "Verified",
    selectable: true,
    chipClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-800",
    tooltip: null,
  },
  pending: {
    label: "pending",
    chipLabel: "Pending",
    selectable: false,
    chipClassName: "border-amber-200 bg-amber-50 text-amber-800",
    tooltip:
      "Postmark is still verifying this sender's DKIM/Return-Path. Re-check in Settings -> Projects.",
  },
  unverified: {
    label: "unverified",
    chipLabel: "Unverified",
    selectable: false,
    chipClassName: "border-slate-200 bg-slate-100 text-slate-700",
    tooltip:
      "This alias hasn't been verified in Postmark yet. Open Settings -> Projects to start verification.",
  },
  rejected: {
    label: "verification failed",
    chipLabel: "Unverified",
    selectable: false,
    chipClassName: "border-slate-200 bg-slate-100 text-slate-700",
    tooltip: "Postmark rejected this sender. Check Settings -> Projects to retry.",
  },
};

export function NameAndSenderStep({
  name,
  fromEmail,
  senderOptions,
  frozen,
  onNameChange,
  onFromEmailChange,
  onBack,
  onContinue,
}: NameAndSenderStepProps) {
  return (
    <section className="flex h-full flex-col">
      <div className="pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Step 2
        </p>
        <h2 className="mt-2 text-balance text-xl font-semibold text-slate-900">
          Name and sender
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-[13px] leading-relaxed text-slate-500">
          Set the internal campaign name and choose the verified alias that
          recipients will see in their inbox.
        </p>
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <label
            htmlFor="campaign-name"
            className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500"
          >
            Campaign name
          </label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(event) => {
              onNameChange(event.currentTarget.value);
            }}
            disabled={frozen}
            placeholder="e.g. Whitebark Pine - June kickoff"
            className="mt-2 h-11 text-lg font-semibold tracking-tight"
          />
          <p className="mt-1.5 text-[11.5px] text-slate-500">
            Internal name only; recipients see the subject line.
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              Sending account
            </p>
          </div>
          <div className="p-4">
            <TooltipProvider delayDuration={200}>
              <div className="space-y-2">
                {senderOptions.map((option) => {
                  const meta = SENDER_STATUS_META[option.status];
                  const selected = fromEmail === option.email;
                  const card = (
                    <div
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                        selected
                          ? "border-slate-950 bg-slate-50 ring-1 ring-slate-950/10"
                          : "border-slate-200 bg-white",
                        meta.selectable
                          ? "hover:border-slate-300 hover:bg-slate-50"
                          : "text-slate-500",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                          selected ? "border-slate-950" : "border-slate-300",
                        )}
                        aria-hidden="true"
                      >
                        {selected ? (
                          <span className="size-2 rounded-full bg-slate-950" />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12.5px] font-medium text-slate-900">
                          {option.email}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {option.projectAliasLabel}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          meta.chipClassName,
                        )}
                      >
                        <span
                          className={cn(
                            "size-1 rounded-full",
                            option.status === "verified"
                              ? "bg-emerald-500"
                              : option.status === "pending"
                                ? "bg-amber-500"
                                : "bg-slate-400",
                          )}
                        />
                        {meta.chipLabel}
                      </span>
                    </div>
                  );

                  if (!meta.selectable) {
                    return (
                      <Tooltip key={`${option.projectId}:${option.email}`}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="block w-full cursor-not-allowed text-left"
                          >
                            {card}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-72 text-pretty">
                          {meta.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <button
                      key={`${option.projectId}:${option.email}`}
                      type="button"
                      aria-pressed={selected}
                      disabled={frozen}
                      onClick={() => {
                        onFromEmailChange(option.email);
                      }}
                      className="block w-full text-left disabled:cursor-not-allowed"
                    >
                      {card}
                    </button>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </section>

        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 text-[12px] text-slate-600">
          <Info className="mr-1.5 inline size-3.5 text-slate-500" />
          Replies route to the same address. To add a new verified sender, ask
          an admin in Settings.
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-5">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>
          Continue
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
