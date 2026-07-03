"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Info, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatSmsEstimatedCostUsd } from "@/src/lib/sms-pricing";
import { cn } from "@/lib/utils";

import type { LaunchType } from "@as-comms/contracts";

import type { ComposePreviewData } from "../../_lib/audience-data-source";
import { StepHeader, WizardFooter } from "./wizard-shell";

interface PreviewStepProps {
  readonly launchType: LaunchType;
  readonly subject: string;
  readonly preheader: string;
  readonly previewData: ComposePreviewData | null;
  readonly smsPreviewData: {
    readonly selected: number;
    readonly reachable: number;
    readonly deduplicatedByPhone: number;
    readonly frozen: number;
    readonly unreachable: Readonly<Record<string, number>>;
    readonly totalSegments: number;
    readonly estCostUsd: number;
    readonly sampleBody: string | null;
  } | null;
  readonly previewLoading: boolean;
  readonly warningDismissed: boolean;
  readonly affectedContactsOpen: boolean;
  readonly testSendOpen: boolean;
  readonly testRecipientValue: string;
  readonly testSendPending: boolean;
  readonly selectedSenderVerified: boolean;
  readonly frozen: boolean;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onPreviewPrevious: () => void;
  readonly onPreviewNext: () => void;
  readonly onDismissWarning: () => void;
  readonly onAffectedContactsOpenChange: (open: boolean) => void;
  readonly onTestSendOpenChange: (open: boolean) => void;
  readonly onTestRecipientValueChange: (value: string) => void;
  readonly onSendTest: () => void;
}

function PreviewRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex gap-3 text-[12.5px]">
      <span className="w-16 shrink-0 text-[10.5px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-w-0 truncate text-slate-800">
        {value && value.trim().length > 0 ? value : "-"}
      </span>
    </div>
  );
}

export function PreviewStep({
  launchType,
  subject,
  preheader,
  previewData,
  smsPreviewData,
  previewLoading,
  warningDismissed,
  affectedContactsOpen,
  testSendOpen,
  testRecipientValue,
  testSendPending,
  selectedSenderVerified,
  frozen,
  onBack,
  onContinue,
  onPreviewPrevious,
  onPreviewNext,
  onDismissWarning,
  onAffectedContactsOpenChange,
  onTestSendOpenChange,
  onTestRecipientValueChange,
  onSendTest,
}: PreviewStepProps) {
  const isSmsLaunch = launchType === "sms";
  const sample = previewData?.sample ?? null;
  const sampleLabel =
    sample === null ? "Sample" : `Sample - ${sample.initials}`;
  const warningSummary =
    isSmsLaunch ||
    previewData === null ||
    previewData.warningCount === 0 ||
    warningDismissed
      ? null
      : `${previewData.warningCount.toLocaleString()} contacts are missing at least one merge token.`;

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title={isSmsLaunch ? "Preview the SMS" : "Preview the email"}
        description={
          isSmsLaunch
            ? "Review the reachable audience, estimated segment cost, and a rendered sample before the final checkpoint."
            : "Review the rendered message for sample recipients and send a test before the final checkpoint."
        }
      />

      <div className="space-y-3">
        {warningSummary !== null ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 text-pretty">
              <p className="text-[12.5px] font-semibold text-amber-900">
                {warningSummary}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11.5px] font-semibold">
                <button
                  type="button"
                  className="text-amber-900 underline underline-offset-2"
                  onClick={() => {
                    onAffectedContactsOpenChange(true);
                  }}
                >
                  Review affected contacts
                </button>
                <button
                  type="button"
                  className="text-amber-800 underline underline-offset-2"
                  onClick={onDismissWarning}
                >
                  Proceed anyway
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {isSmsLaunch ? "SMS preview" : "Email preview"}
            </p>
            <div className="flex items-center gap-2">
              <SendTestPopover
                launchType={launchType}
                open={testSendOpen}
                disabled={frozen || !selectedSenderVerified}
                disabledReason={
                  selectedSenderVerified
                    ? undefined
                    : isSmsLaunch
                      ? "Activate an SMS sender before sending a test."
                      : "Choose a verified sender alias before sending a test."
                }
                pending={testSendPending}
                recipientValue={testRecipientValue}
                onOpenChange={onTestSendOpenChange}
                onRecipientChange={onTestRecipientValueChange}
                onSend={onSendTest}
              />
              {isSmsLaunch ? null : (
                <div
                  role="group"
                  aria-label="Sample contact"
                  className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-0.5 py-0.5"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={onPreviewPrevious}
                    disabled={
                      previewData === null || previewData.sampleCount <= 1
                    }
                    aria-label="Previous sample contact"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="min-w-[68px] px-1 text-center font-mono text-[10.5px] text-slate-700">
                    {sampleLabel}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={onPreviewNext}
                    disabled={
                      previewData === null || previewData.sampleCount <= 1
                    }
                    aria-label="Next sample contact"
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {isSmsLaunch ? (
            <div className="grid gap-3 border-b border-slate-200 px-5 py-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Reachability
                </p>
                <p className="mt-2 text-[15px] font-semibold text-slate-900">
                  {smsPreviewData === null
                    ? "No audience resolved yet."
                    : `${smsPreviewData.reachable.toLocaleString()} reachable of ${smsPreviewData.selected.toLocaleString()} selected`}
                </p>
                {smsPreviewData === null ? null : (
                  <div className="mt-2 space-y-1 text-[11.5px] text-slate-500">
                    <p>
                      No consent:{" "}
                      {(smsPreviewData.unreachable.no_consent ?? 0).toLocaleString()}
                    </p>
                    <p>
                      Revoked:{" "}
                      {(smsPreviewData.unreachable.revoked ?? 0).toLocaleString()}
                    </p>
                    <p>
                      No phone:{" "}
                      {(smsPreviewData.unreachable.no_phone ?? 0).toLocaleString()}
                    </p>
                    {smsPreviewData.deduplicatedByPhone > 0 ? (
                      <p>
                        Duplicate phones suppressed:{" "}
                        {smsPreviewData.deduplicatedByPhone.toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Estimated send
                </p>
                <p className="mt-2 text-[15px] font-semibold text-slate-900">
                  {smsPreviewData === null
                    ? "Waiting for preview."
                    : `≈ ${smsPreviewData.totalSegments.toLocaleString()} segments · ~$${formatSmsEstimatedCostUsd(
                        smsPreviewData.estCostUsd,
                      )}`}
                </p>
                {smsPreviewData === null ? null : (
                  <p className="mt-2 text-[11.5px] text-slate-500">
                    {smsPreviewData.frozen.toLocaleString()} messages will be
                    frozen for send.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1 border-b border-slate-200 px-5 py-3">
              <PreviewRow label="From" value={sample?.fromEmail ?? null} />
              <PreviewRow
                label="To"
                value={
                  sample === null ? null : `${sample.name} <${sample.email}>`
                }
              />
              <PreviewRow label="Subject" value={sample?.subject ?? subject} />
              {preheader.trim().length > 0 ? (
                <PreviewRow label="Preview" value={preheader} />
              ) : null}
            </div>
          )}

          <div className="px-5 py-5">
            {previewLoading ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                {isSmsLaunch
                  ? "Calculating the SMS preview..."
                  : "Rendering the live preview..."}
              </div>
            ) : isSmsLaunch ? (
              smsPreviewData === null ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Add audience filters and SMS body copy to load the preview.
                </div>
              ) : (
                <div className="mx-auto max-w-xl rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-5">
                  <div className="ml-auto max-w-[88%] rounded-[24px] rounded-br-md bg-[#253746] px-4 py-3 text-[13px] leading-relaxed text-white shadow-sm">
                    <p className="whitespace-pre-wrap">
                      {smsPreviewData.sampleBody ??
                        "No reachable recipients to sample yet."}
                    </p>
                  </div>
                </div>
              )
            ) : sample === null ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Add audience filters to load a preview contact.
              </div>
            ) : (
              <article className="rounded-lg border border-slate-200 bg-white p-5">
                {launchType === "html_email" ? (
                  <iframe
                    title="Email body preview"
                    srcDoc={sample.html}
                    className="block w-full rounded-md border border-slate-200"
                    style={{ height: 720, background: "white" }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div
                    // Note: `prose` from @tailwindcss/typography is not
                    // installed in this app, so we apply paragraph + link
                    // styling via arbitrary selectors. The `[&_p]:my-3` rule
                    // mirrors the ~1em <p> margin Gmail (and browser
                    // defaults) apply, which Tailwind's Preflight reset
                    // otherwise zeroes out, collapsing all paragraphs.
                    className={cn(
                      "text-sm leading-relaxed text-slate-800",
                      "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                      "[&_a]:text-sky-700 [&_a]:underline",
                      "[&_hr]:border-slate-200",
                    )}
                    dangerouslySetInnerHTML={{ __html: sample.html }}
                  />
                )}
              </article>
            )}
          </div>
        </section>

        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11.5px] text-slate-500">
          <Info className="mr-1.5 inline size-3.5 text-slate-500" />
          {isSmsLaunch
            ? smsPreviewData === null
              ? "Preview loads once the audience resolves and the SMS body is available."
              : "The sample body includes merged tokens and the automatic opt-out footer appended at send time."
            : sample === null
              ? "Preview loads once the audience resolves."
              : `Resolves merge tokens for ${sample.name}. Cycle through samples to spot-check different recipients.`}
        </div>
      </div>

      <WizardFooter
        onBack={onBack}
        primaryLabel="Continue"
        primaryAction={onContinue}
      />

      <Dialog
        open={affectedContactsOpen}
        onOpenChange={onAffectedContactsOpenChange}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge token gaps</DialogTitle>
            <DialogDescription>
              These contacts are missing at least one referenced merge token.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            {previewData?.affectedContacts.map((contact) => (
              <div
                key={contact.contactId}
                className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {contact.name}
                  </p>
                  <p className="truncate text-slate-500">{contact.email}</p>
                </div>
                <p className="min-w-0 text-slate-600">
                  {contact.missingTokens.join(", ")}
                </p>
              </div>
            )) ?? null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SendTestPopover({
  launchType,
  open,
  disabled,
  disabledReason,
  pending,
  recipientValue,
  onOpenChange,
  onRecipientChange,
  onSend,
}: {
  readonly launchType: LaunchType;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | undefined;
  readonly pending: boolean;
  readonly recipientValue: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRecipientChange: (value: string) => void;
  readonly onSend: () => void;
}) {
  const isSmsLaunch = launchType === "sms";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11.5px]"
          disabled={disabled}
          title={disabledReason}
        >
          <Send className="size-3" aria-hidden="true" />
          Send test
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" sideOffset={6}>
        <form
          className="space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) {
              onSend();
            }
          }}
        >
          <label
            htmlFor="campaign-test-recipient"
            className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          >
            {isSmsLaunch ? "Send test SMS to" : "Send test email to"}
          </label>
          <Input
            id="campaign-test-recipient"
            type={isSmsLaunch ? "tel" : "email"}
            value={recipientValue}
            onChange={(event) => {
              onRecipientChange(event.currentTarget.value);
            }}
            placeholder={isSmsLaunch ? "+14065550123" : "you@example.com"}
            className="h-9 text-[13px]"
            autoFocus
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            {isSmsLaunch
              ? "We&apos;ll deliver one SMS test render and report the segment count."
              : "We&apos;ll deliver one test render through the same alias to verify formatting."}
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[12px]"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              disabled={pending || recipientValue.trim().length === 0}
            >
              <Send className="size-3" aria-hidden="true" />
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
