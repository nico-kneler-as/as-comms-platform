"use client";

import { useState } from "react";

import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { cn } from "@/lib/utils";

import type {
  CampaignKind,
  CampaignRunRecord,
  PostmarkSenderStatus,
} from "@as-comms/contracts";

import type {
  CampaignSenderOption,
  ComposePreviewData,
} from "../../_lib/audience-data-source";

interface ReviewStepProps {
  readonly kind: CampaignKind;
  readonly projectChipLabel: string;
  readonly runName: string | null;
  readonly fromEmail: string | null;
  readonly preheader: string;
  readonly senderOptions: readonly CampaignSenderOption[];
  readonly selectedSenderVerified: boolean;
  readonly audienceSize: number | null;
  readonly previewData: ComposePreviewData | null;
  readonly previewExpanded: boolean;
  readonly sendMode: "now" | "later";
  readonly scheduleDate: string;
  readonly scheduleTime: string;
  readonly frozen: boolean;
  readonly frozenState: CampaignRunRecord["state"];
  readonly frozenScheduledAt: string | null;
  readonly confirmOpen: boolean;
  readonly submitPending: boolean;
  readonly onRunNameChange: (value: string) => void;
  readonly onFromEmailChange: (value: string | null) => void;
  readonly onBack: () => void;
  readonly onRerunAudience: () => void;
  readonly onPreviewExpandedChange: (open: boolean) => void;
  readonly onSendModeChange: (value: "now" | "later") => void;
  readonly onScheduleDateChange: (value: string) => void;
  readonly onScheduleTimeChange: (value: string) => void;
  readonly onConfirmOpenChange: (open: boolean) => void;
  readonly onSubmit: () => void;
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
      "Postmark is still verifying this sender's DKIM/Return-Path. Re-check in Settings → Projects.",
  },
  unverified: {
    label: "unverified",
    selectable: false,
    tooltip:
      "This alias hasn't been verified in Postmark yet. Open Settings → Projects to start verification.",
  },
  rejected: {
    label: "verification failed",
    selectable: false,
    tooltip:
      "Postmark rejected this sender. Check Settings → Projects to retry.",
  },
};

function readSenderLabel(option: CampaignSenderOption): string {
  return `${option.email} · ${SENDER_STATUS_META[option.status].label}`;
}

function formatDenverTimestamp(value: string | null): string {
  if (value === null) {
    return "the selected time";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: ORG_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </h3>
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

export function ReviewStep({
  kind,
  projectChipLabel,
  runName,
  fromEmail,
  preheader,
  senderOptions,
  selectedSenderVerified,
  audienceSize,
  previewData,
  previewExpanded,
  sendMode,
  scheduleDate,
  scheduleTime,
  frozen,
  frozenState,
  frozenScheduledAt,
  confirmOpen,
  submitPending,
  onRunNameChange,
  onFromEmailChange,
  onBack,
  onRerunAudience,
  onPreviewExpandedChange,
  onSendModeChange,
  onScheduleDateChange,
  onScheduleTimeChange,
  onConfirmOpenChange,
  onSubmit,
}: ReviewStepProps) {
  const [senderOpen, setSenderOpen] = useState(false);
  const selectedSender =
    (fromEmail === null
      ? null
      : senderOptions.find(
            (option) => option.email === fromEmail && option.status === "verified",
          ) ??
        senderOptions.find((option) => option.email === fromEmail) ??
        null) ?? null;
  const submitLabel = sendMode === "later" ? "Schedule send" : "Send now";
  const confirmationLine =
    sendMode === "later"
      ? `Send ${audienceSize?.toLocaleString() ?? "0"} emails from ${fromEmail ?? "the selected sender"} at ${scheduleDate} ${scheduleTime} Denver?`
      : `Send ${audienceSize?.toLocaleString() ?? "0"} emails from ${fromEmail ?? "the selected sender"} right now?`;

  return (
    <section className="flex h-full flex-col">
      <div className="pb-6">
        <p className="text-[11px] font-semibold uppercase text-slate-500">
          Step 5
        </p>
        <h2 className="mt-2 text-balance text-2xl font-semibold text-slate-900">
          Review and send
        </h2>
        <p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-slate-500">
          This is the frozen checkpoint before launch. Confirm the sender,
          audience, rendered content, and send timing.
        </p>
      </div>

      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
              {kind === "newsletter" ? "Newsletter" : projectChipLabel}
            </span>
          </div>
          <Input
            value={runName ?? ""}
            onChange={(event) => {
              onRunNameChange(event.currentTarget.value);
            }}
            disabled={frozen}
            placeholder="Untitled campaign"
            className="mt-4 h-auto border-none px-0 py-0 text-3xl font-semibold text-slate-900 shadow-none focus-visible:ring-0"
            aria-label="Campaign name"
          />
          <p className="mt-2 text-sm text-slate-500">
            Internal name only — recipients see the subject line.
          </p>
        </section>

        <Section title="Sender">
          <TooltipProvider delayDuration={200}>
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="campaign-from-email"
                  className="text-sm font-medium text-slate-900"
                >
                  From
                </label>
                <Popover open={frozen ? false : senderOpen} onOpenChange={setSenderOpen}>
                  <PopoverTrigger asChild>
                    <button
                      id="campaign-from-email"
                      type="button"
                      disabled={frozen}
                      className="flex h-11 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
                          ? "Choose a sender alias"
                          : readSenderLabel(selectedSender)}
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-slate-400" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] min-w-[24rem] p-1"
                  >
                    <div role="listbox" aria-label="Sender aliases" className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          onFromEmailChange(null);
                          setSenderOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50",
                          fromEmail === null ? "bg-slate-50 text-slate-900" : "",
                        )}
                      >
                        <span>Choose a sender alias</span>
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
                              "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm",
                              meta.selectable
                                ? "cursor-pointer text-slate-900 transition-colors hover:bg-slate-50"
                                : "cursor-not-allowed text-slate-500",
                              fromEmail === option.email ? "bg-slate-50" : "",
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {readSenderLabel(option)}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {option.projectName}
                              </p>
                            </div>
                          </div>
                        );

                        if (!meta.selectable) {
                          return (
                            <Tooltip key={`${option.projectId}:${option.email}`}>
                              <TooltipTrigger asChild>{row}</TooltipTrigger>
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
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Reply-To
                </p>
                <p className="mt-2 text-sm text-slate-800">
                  {fromEmail ?? "Choose a sender alias first"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Replies route to the same address as the sender.
                </p>
              </div>
            </div>
          </TooltipProvider>
        </Section>

        <Section title="Audience">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-4xl font-semibold tabular-nums text-slate-900">
                {(audienceSize ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Frozen at launch · Auto-excludes unsubscribed, bounced, no-email
              </p>
            </div>
            <button
              type="button"
              className={cn(
                "text-sm font-medium text-slate-600 underline underline-offset-2",
                frozen ? "cursor-not-allowed opacity-50" : "",
              )}
              onClick={onRerunAudience}
              disabled={frozen}
            >
              Re-run audience
            </button>
          </div>
        </Section>

        <Section title="Email Content">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-800"
            onClick={() => {
              onPreviewExpandedChange(!previewExpanded);
            }}
          >
            <span>{previewExpanded ? "Collapse" : "Expand"}</span>
            {previewExpanded ? (
              <ChevronUp className="size-4 text-slate-500" />
            ) : (
              <ChevronDown className="size-4 text-slate-500" />
            )}
          </button>

          {previewExpanded ? (
            <div className="mt-4 rounded-3xl border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
                <p>
                  <span className="font-medium text-slate-900">Subject:</span>{" "}
                  {previewData?.sample?.subject ?? "—"}
                </p>
                <p className="mt-2">
                  <span className="font-medium text-slate-900">Preheader:</span>{" "}
                  {preheader.trim().length > 0 ? preheader : "—"}
                </p>
              </div>
              <div className="px-4 py-4">
                {previewData?.sample == null ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Preview unavailable until the audience resolves.
                  </div>
                ) : (
                  <article
                    className={cn(
                      "prose prose-sm max-w-none rounded-2xl border border-slate-200 bg-white p-4 text-slate-800",
                      "[&_a]:text-sky-700 [&_a]:underline [&_hr]:border-slate-200",
                    )}
                    dangerouslySetInnerHTML={{
                      __html: previewData.sample.html,
                    }}
                  />
                )}
              </div>
            </div>
          ) : null}
        </Section>

        {frozen ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>
                This campaign is {frozenState} for{" "}
                {formatDenverTimestamp(frozenScheduledAt)}. Content and audience
                are locked. To edit, cancel and start a new draft.
              </p>
            </div>
          </section>
        ) : (
          <Section title="When To Send">
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-2xl border px-4 py-4 text-left transition-colors",
                  sendMode === "now"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                )}
                onClick={() => {
                  onSendModeChange("now");
                }}
              >
                <p className="font-semibold">Send now</p>
                <p className="mt-2 text-sm opacity-80">
                  Recipients start receiving immediately
                </p>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-2xl border px-4 py-4 text-left transition-colors",
                  sendMode === "later"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                )}
                onClick={() => {
                  onSendModeChange("later");
                }}
              >
                <p className="font-semibold">Schedule for later</p>
                <p className="mt-2 text-sm opacity-80">
                  Pick a date and time. Locked to {ORG_TIMEZONE}.
                </p>
              </button>
            </div>

            {sendMode === "later" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="campaign-send-date"
                    className="text-sm font-medium text-slate-900"
                  >
                    Date
                  </label>
                  <Input
                    id="campaign-send-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(event) => {
                      onScheduleDateChange(event.currentTarget.value);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="campaign-send-time"
                    className="text-sm font-medium text-slate-900"
                  >
                    Time
                  </label>
                  <Input
                    id="campaign-send-time"
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => {
                      onScheduleTimeChange(event.currentTarget.value);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </Section>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-6">
        <Button variant="outline" onClick={onBack} disabled={frozen}>
          Back
        </Button>
        {frozen ? null : (
          <Button
            onClick={() => {
              onConfirmOpenChange(true);
            }}
            disabled={!fromEmail || !selectedSenderVerified}
          >
            {submitLabel}
          </Button>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{submitLabel}</DialogTitle>
            <DialogDescription>{confirmationLine}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onConfirmOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={submitPending || !fromEmail || !selectedSenderVerified}
            >
              {submitPending ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
