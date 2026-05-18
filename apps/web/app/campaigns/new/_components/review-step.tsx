"use client";

import { CheckCircle2, Clock, Send } from "lucide-react";

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
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { cn } from "@/lib/utils";

import type { CampaignKind, CampaignRunRecord } from "@as-comms/contracts";

interface ReviewStepProps {
  readonly kind: CampaignKind;
  readonly projectChipLabel: string;
  readonly runName: string | null;
  readonly fromEmail: string | null;
  readonly subject: string;
  readonly selectedSenderVerified: boolean;
  readonly audienceSize: number | null;
  readonly sendMode: "now" | "later";
  readonly scheduleDate: string;
  readonly scheduleTime: string;
  readonly frozen: boolean;
  readonly frozenState: CampaignRunRecord["state"];
  readonly frozenScheduledAt: string | null;
  readonly confirmOpen: boolean;
  readonly submitPending: boolean;
  readonly onBack: () => void;
  readonly onSendModeChange: (value: "now" | "later") => void;
  readonly onScheduleDateChange: (value: string) => void;
  readonly onScheduleTimeChange: (value: string) => void;
  readonly onConfirmOpenChange: (open: boolean) => void;
  readonly onSubmit: () => void;
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 text-[12.5px]">
      <span className="w-20 shrink-0 text-[10.5px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-w-0 text-slate-800">{value}</span>
    </div>
  );
}

export function ReviewStep({
  kind,
  projectChipLabel,
  runName,
  fromEmail,
  subject,
  selectedSenderVerified,
  audienceSize,
  sendMode,
  scheduleDate,
  scheduleTime,
  frozen,
  frozenState,
  frozenScheduledAt,
  confirmOpen,
  submitPending,
  onBack,
  onSendModeChange,
  onScheduleDateChange,
  onScheduleTimeChange,
  onConfirmOpenChange,
  onSubmit,
}: ReviewStepProps) {
  const submitLabel = sendMode === "later" ? "Schedule send" : "Send now";
  const confirmationLine =
    sendMode === "later"
      ? `Send ${audienceSize?.toLocaleString() ?? "0"} emails from ${
          fromEmail ?? "the selected sender"
        } at ${scheduleDate} ${scheduleTime} Denver?`
      : `Send ${audienceSize?.toLocaleString() ?? "0"} emails from ${
          fromEmail ?? "the selected sender"
        } right now?`;

  return (
    <section className="flex h-full flex-col">
      <div className="pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Step 6
        </p>
        <h2 className="mt-2 text-balance text-xl font-semibold text-slate-900">
          Review and send
        </h2>
        <p className="mt-2 max-w-3xl text-pretty text-[13px] leading-relaxed text-slate-500">
          Final check before launch. Content and audience freeze after this
          point.
        </p>
      </div>

      <div className="space-y-4">
        <Section title="FINAL CHECK">
          <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
            <div className="space-y-2.5">
              <SummaryRow label="Name" value={runName ?? "Untitled campaign"} />
              <SummaryRow
                label="Kind"
                value={kind === "newsletter" ? "Newsletter" : "Project email"}
              />
              <SummaryRow
                label="From"
                value={
                  <span className="font-mono">
                    {fromEmail ?? "Choose a verified sender"}
                  </span>
                }
              />
            </div>
            <div className="space-y-2.5">
              <SummaryRow
                label="Audience"
                value={
                  <span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {(audienceSize ?? 0).toLocaleString()}
                    </span>{" "}
                    recipients
                  </span>
                }
              />
              <SummaryRow
                label="Scope"
                value={kind === "newsletter" ? "All AS" : projectChipLabel}
              />
              <SummaryRow
                label="Sender"
                value={
                  selectedSenderVerified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-800">
                      <span className="size-1 rounded-full bg-emerald-500" />
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-800">
                      Verification required
                    </span>
                  )
                }
              />
            </div>
          </div>
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-2 text-[10.5px] text-slate-500">
            Audience freezes at launch. Auto-excludes unsubscribed,
            hard-bounced, and contacts without an email on file.
          </div>
        </Section>

        <Section title="Email content">
          <div className="space-y-1.5 px-4 py-3 text-[12.5px]">
            <SummaryRow
              label="Subject"
              value={
                subject.trim().length > 0 ? (
                  <span className="font-medium text-slate-900">{subject}</span>
                ) : (
                  <span className="italic text-slate-500">(no subject)</span>
                )
              }
            />
          </div>
        </Section>

        {frozen ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-900">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>
                This campaign is {frozenState} for{" "}
                {formatDenverTimestamp(frozenScheduledAt)}. Content and audience
                are locked. To edit, cancel and start a new draft.
              </p>
            </div>
          </section>
        ) : (
          <Section title="When to send">
            <div className="grid gap-3 p-4 md:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "flex gap-3 rounded-lg border p-3 text-left transition-colors",
                  sendMode === "now"
                    ? "border-slate-950 bg-white text-slate-950 ring-1 ring-slate-950/20"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                )}
                onClick={() => {
                  onSendModeChange("now");
                }}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    sendMode === "now" ? "border-slate-950" : "border-slate-300",
                  )}
                  aria-hidden="true"
                >
                  {sendMode === "now" ? (
                    <span className="size-2 rounded-full bg-slate-950" />
                  ) : null}
                </span>
                <Send
                  className="mt-0.5 size-4 shrink-0 text-slate-700"
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-[13px] font-semibold">
                    Send now
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-slate-500">
                    Recipients start receiving immediately.
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex gap-3 rounded-lg border p-3 text-left transition-colors",
                  sendMode === "later"
                    ? "border-slate-950 bg-white text-slate-950 ring-1 ring-slate-950/20"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                )}
                onClick={() => {
                  onSendModeChange("later");
                }}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    sendMode === "later"
                      ? "border-slate-950"
                      : "border-slate-300",
                  )}
                  aria-hidden="true"
                >
                  {sendMode === "later" ? (
                    <span className="size-2 rounded-full bg-slate-950" />
                  ) : null}
                </span>
                <Clock
                  className="mt-0.5 size-4 shrink-0 text-slate-700"
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-[13px] font-semibold">
                    Schedule for later
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-slate-500">
                    Pick a date and time. Locked to America/Denver.
                  </span>
                </span>
              </button>
            </div>

            {sendMode === "later" ? (
              <div className="grid gap-3 border-t border-slate-200 px-4 py-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="campaign-send-date"
                    className="text-[12px] font-medium text-slate-900"
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
                <div className="space-y-1.5">
                  <label
                    htmlFor="campaign-send-time"
                    className="text-[12px] font-medium text-slate-900"
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

      <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-5">
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
            <DialogTitle>
              {sendMode === "later"
                ? "Schedule this campaign?"
                : "Send this campaign now?"}
            </DialogTitle>
            <DialogDescription>{confirmationLine}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onConfirmOpenChange(false);
              }}
            >
              Keep editing
            </Button>
            <Button
              onClick={onSubmit}
              disabled={submitPending || !fromEmail || !selectedSenderVerified}
            >
              {submitPending ? "Working..." : submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
