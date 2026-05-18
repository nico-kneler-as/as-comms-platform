"use client";

import { useState } from "react";

import { CheckCircle2, ChevronDown, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
    readonly selectable: boolean;
    readonly tooltip: string | null;
  }
> = {
  verified: {
    label: "verified",
    selectable: true,
    tooltip: null,
  },
  pending: {
    label: "pending DNS",
    selectable: false,
    tooltip:
      "Postmark is still verifying this sender's DKIM/Return-Path. Re-check in Settings -> Projects.",
  },
  unverified: {
    label: "unverified",
    selectable: false,
    tooltip:
      "This alias hasn't been verified in Postmark yet. Open Settings -> Projects to start verification.",
  },
  rejected: {
    label: "verification failed",
    selectable: false,
    tooltip: "Postmark rejected this sender. Check Settings -> Projects to retry.",
  },
};

function readSenderLabel(option: CampaignSenderOption): string {
  return `${option.email} - ${SENDER_STATUS_META[option.status].label}`;
}

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
  const [senderOpen, setSenderOpen] = useState(false);
  const selectedSender =
    (fromEmail === null
      ? null
      : (senderOptions.find(
          (option) =>
            option.email === fromEmail && option.status === "verified",
        ) ??
        senderOptions.find((option) => option.email === fromEmail) ??
        null)) ?? null;

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
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              Sending account
            </p>
            <p className="text-[10.5px] text-slate-500">
              Which email this campaign is sent from
            </p>
          </div>
          <div className="p-4">
            <TooltipProvider delayDuration={200}>
              <Popover
                open={frozen ? false : senderOpen}
                onOpenChange={setSenderOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    id="campaign-from-email"
                    type="button"
                    disabled={frozen}
                    className="flex h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-left font-mono text-[12.5px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <span
                      className={cn(
                        "truncate",
                        fromEmail === null ? "text-slate-500" : "text-slate-900",
                        selectedSender !== null &&
                          !SENDER_STATUS_META[selectedSender.status].selectable
                          ? "text-slate-500"
                          : "",
                      )}
                    >
                      {selectedSender === null
                        ? "Choose a verified sender"
                        : readSenderLabel(selectedSender)}
                    </span>
                    <ChevronDown
                      className="ml-2 size-3.5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] min-w-[24rem] p-1"
                >
                  <div role="listbox" aria-label="Sender aliases">
                    <button
                      type="button"
                      onClick={() => {
                        onFromEmailChange(null);
                        setSenderOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-slate-600 transition-colors hover:bg-slate-50",
                        fromEmail === null ? "bg-slate-50 text-slate-900" : "",
                      )}
                    >
                      <span>Choose a verified sender</span>
                    </button>
                    {senderOptions.map((option) => {
                      const meta = SENDER_STATUS_META[option.status];
                      const row = (
                        <div
                          role="option"
                          aria-disabled={!meta.selectable}
                          aria-selected={fromEmail === option.email}
                          aria-label={
                            meta.tooltip === null
                              ? readSenderLabel(option)
                              : `${readSenderLabel(option)}. ${meta.tooltip}`
                          }
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[12.5px]",
                            meta.selectable
                              ? "cursor-pointer text-slate-900 transition-colors hover:bg-slate-50"
                              : "cursor-not-allowed text-slate-500",
                            fromEmail === option.email ? "bg-slate-50" : "",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono font-medium">
                              {readSenderLabel(option)}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              {option.projectName}
                            </p>
                          </div>
                          {option.status === "verified" ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              <span className="size-1 rounded-full bg-emerald-500" />
                              Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                              <span className="size-1 rounded-full bg-amber-500" />
                              {meta.label}
                            </span>
                          )}
                        </div>
                      );

                      if (!meta.selectable) {
                        return (
                          <Tooltip key={`${option.projectId}:${option.email}`}>
                            <TooltipTrigger asChild>{row}</TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="max-w-72 text-pretty"
                            >
                              {meta.tooltip}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      return (
                        <button
                          key={`${option.projectId}:${option.email}`}
                          type="button"
                          onClick={() => {
                            onFromEmailChange(option.email);
                            setSenderOpen(false);
                          }}
                          className="block w-full"
                        >
                          {row}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
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
