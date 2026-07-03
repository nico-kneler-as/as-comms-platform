"use client";

import { Info } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { LaunchType, PostmarkSenderStatus } from "@as-comms/contracts";

import type {
  ActiveSmsSender,
  CampaignSenderOption,
} from "../../_lib/audience-data-source";
import { SectionPanel, StepHeader, WizardFooter } from "./wizard-shell";

interface NameAndSenderStepProps {
  readonly launchType: LaunchType;
  readonly name: string;
  readonly fromEmail: string | null;
  readonly senderOptions: readonly CampaignSenderOption[];
  readonly activeSmsSender: ActiveSmsSender | null;
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
    chipClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
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
    tooltip:
      "Postmark rejected this sender. Check Settings -> Projects to retry.",
  },
};

export function NameAndSenderStep({
  launchType,
  name,
  fromEmail,
  senderOptions,
  activeSmsSender,
  frozen,
  onNameChange,
  onFromEmailChange,
  onBack,
  onContinue,
}: NameAndSenderStepProps) {
  const isSmsLaunch = launchType === "sms";
  const canContinue =
    name.trim().length > 0 &&
    (isSmsLaunch
      ? activeSmsSender !== null
      : (fromEmail?.trim().length ?? 0) > 0);
  const groupedSenderOptions = [
    {
      id: "project",
      label: "Project aliases",
      options: senderOptions.filter(
        (option) => option.senderType === "project",
      ),
    },
    {
      id: "org",
      label: "Organization",
      options: senderOptions.filter((option) => option.senderType === "org"),
    },
  ].filter((group) => group.options.length > 0);

  function renderSenderOption(option: CampaignSenderOption) {
    const meta = SENDER_STATUS_META[option.status];
    const selected = fromEmail === option.email;
    const card = (
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors",
          selected
            ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/10"
            : "border-slate-200 bg-white",
          meta.selectable
            ? "hover:border-slate-300 hover:bg-slate-50"
            : "text-slate-500",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-slate-900" : "border-slate-300",
          )}
          aria-hidden="true"
        >
          {selected ? (
            <span className="size-2 rounded-full bg-slate-900" />
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
        <Tooltip key={`${option.projectId ?? option.email}:${option.email}`}>
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
        key={`${option.projectId ?? option.email}:${option.email}`}
        type="button"
        aria-pressed={selected}
        disabled={frozen}
        onClick={() => {
          onFromEmailChange(option.email);
        }}
        className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
      >
        {card}
      </button>
    );
  }

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title={isSmsLaunch ? "Name and SMS sender" : "Name and sender"}
        description={
          isSmsLaunch
            ? "Set the internal broadcast name and confirm the active SMS sender the platform will use."
            : "Set the internal broadcast name and choose the sender that recipients will see in their inbox."
        }
      />

      <div className="space-y-4">
        <SectionPanel label="Broadcast name" bodyClassName="px-4 py-4">
          <label htmlFor="campaign-name" className="sr-only">
            Broadcast name
          </label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(event) => {
              onNameChange(event.currentTarget.value);
            }}
            disabled={frozen}
            placeholder="e.g. Whitebark Pine - June kickoff"
            className="h-11 text-base font-semibold tracking-tight"
          />
          <p className="mt-2 text-[11px] text-slate-500">
            Internal name only — recipients see the subject line.
          </p>
        </SectionPanel>

        <SectionPanel
          label={isSmsLaunch ? "SMS sender" : "Sending account"}
          bodyClassName="p-4"
        >
          {isSmsLaunch ? (
            activeSmsSender === null ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-[12px] leading-relaxed text-rose-800">
                No active SMS sender configured. Add or activate one in Settings
                before continuing.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                  Sends from
                </p>
                <p className="mt-1 text-[14px] font-semibold text-slate-900">
                  {activeSmsSender.displayName}
                </p>
                <p className="mt-1 font-mono text-[12px] text-slate-600">
                  {activeSmsSender.phoneE164}
                </p>
              </div>
            )
          ) : (
            <TooltipProvider delayDuration={200}>
              <div className="space-y-2">
                {groupedSenderOptions.map((group) => (
                  <div key={group.id} className="space-y-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                      {group.label}
                    </p>
                    {group.options.map((option) => renderSenderOption(option))}
                  </div>
                ))}
              </div>
            </TooltipProvider>
          )}
        </SectionPanel>

        <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
          <Info
            className="mt-0.5 size-3.5 shrink-0 text-slate-500"
            aria-hidden="true"
          />
          <span>
            {isSmsLaunch
              ? "SMS replies route through the same active sender. Change the configured number in Settings."
              : "Replies route to the same address. To add a new verified sender, ask an admin in Settings."}
          </span>
        </p>
      </div>

      <WizardFooter
        onBack={onBack}
        primaryLabel="Continue"
        primaryAction={onContinue}
        primaryDisabled={!canContinue}
      />
    </section>
  );
}
