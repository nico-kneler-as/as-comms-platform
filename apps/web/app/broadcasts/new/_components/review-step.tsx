"use client";

import { CheckCircle2, Clock, Send } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

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

import { SectionPanel, StepHeader, WizardFooter } from "./wizard-shell";

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

function SummaryRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-2.5 text-[12.5px]">
      <dt className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-slate-800">{value}</dd>
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
      <StepHeader
        title="Review and send"
        description="Final check before launch. Content and audience freeze after this point."
      />

      <div className="space-y-4">
        <SectionPanel label="Final check">
          <dl className="divide-y divide-slate-100">
            <SummaryRow label="Name" value={runName ?? "Untitled broadcast"} />
            <SummaryRow
              label="From"
              value={
                <span className="font-mono">
                  {fromEmail ?? "Choose a verified sender"}
                </span>
              }
            />
            <SummaryRow
              label="To"
              value={
                <span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {(audienceSize ?? 0).toLocaleString()}
                  </span>{" "}
                  recipients in{" "}
                  <span className="text-slate-900">
                    {kind === "newsletter" ? "All AS" : projectChipLabel}
                  </span>
                </span>
              }
            />
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
          </dl>
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
            Audience freezes at launch. Auto-excludes unsubscribed,
            hard-bounced, and contacts without an email on file.
          </div>
        </SectionPanel>

        {frozen ? (
          <section
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] leading-relaxed text-emerald-900"
          >
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              This broadcast is {frozenState} for{" "}
              {formatDenverTimestamp(frozenScheduledAt)}. Content and audience
              are locked. To edit, cancel and start a new draft.
            </p>
          </section>
        ) : (
          <SectionPanel label="When to send">
            <div
              role="radiogroup"
              aria-label="Send timing"
              className="grid gap-3 p-4 md:grid-cols-2"
            >
              <SendModeOption
                selected={sendMode === "now"}
                title="Send now"
                description="Recipients start receiving immediately."
                Icon={Send}
                onSelect={() => {
                  onSendModeChange("now");
                }}
              />
              <SendModeOption
                selected={sendMode === "later"}
                title="Schedule for later"
                description="Pick a date and time. Locked to America/Denver."
                Icon={Clock}
                onSelect={() => {
                  onSendModeChange("later");
                }}
              />
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
          </SectionPanel>
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        backDisabled={frozen}
        primaryLabel={submitLabel}
        primaryAction={() => {
          onConfirmOpenChange(true);
        }}
        primaryDisabled={!fromEmail || !selectedSenderVerified}
        primaryIcon={
          sendMode === "later" ? (
            <Clock className="size-3.5" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )
        }
        showPrimary={!frozen}
      />

      <Dialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {sendMode === "later"
                ? "Schedule this broadcast?"
                : "Send this broadcast now?"}
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

function SendModeOption({
  selected,
  title,
  description,
  Icon,
  onSelect,
}: {
  readonly selected: boolean;
  readonly title: string;
  readonly description: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
        selected
          ? "border-slate-900 bg-white text-slate-950 ring-1 ring-slate-900/15"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
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
      <Icon
        className="mt-0.5 size-4 shrink-0 text-slate-700"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}
