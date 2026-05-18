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
import { cn } from "@/lib/utils";

import type { ComposePreviewData } from "../../_lib/audience-data-source";

interface PreviewStepProps {
  readonly subject: string;
  readonly preheader: string;
  readonly previewData: ComposePreviewData | null;
  readonly previewLoading: boolean;
  readonly warningDismissed: boolean;
  readonly affectedContactsOpen: boolean;
  readonly testSendOpen: boolean;
  readonly testRecipientEmail: string;
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
  readonly onTestRecipientEmailChange: (value: string) => void;
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
  subject,
  preheader,
  previewData,
  previewLoading,
  warningDismissed,
  affectedContactsOpen,
  testSendOpen,
  testRecipientEmail,
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
  onTestRecipientEmailChange,
  onSendTest,
}: PreviewStepProps) {
  const sample = previewData?.sample ?? null;
  const sampleLabel =
    sample === null ? "Sample" : `Sample - ${sample.initials}`;
  const warningSummary =
    previewData === null || previewData.warningCount === 0 || warningDismissed
      ? null
      : `${previewData.warningCount.toLocaleString()} contacts are missing at least one merge token.`;

  return (
    <section className="flex h-full flex-col">
      <div className="pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Step 5
        </p>
        <h2 className="mt-2 text-balance text-xl font-semibold text-slate-900">
          Preview the email
        </h2>
        <p className="mt-2 max-w-3xl text-pretty text-[13px] leading-relaxed text-slate-500">
          Review the rendered message for sample recipients and send a test
          before the final checkpoint.
        </p>
      </div>

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
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              Email preview
            </p>
            <div className="flex items-center gap-2">
              {testSendOpen ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                  <span className="text-[11.5px] text-slate-600">
                    Send a test to:
                  </span>
                  <Input
                    id="campaign-test-recipient"
                    type="email"
                    value={testRecipientEmail}
                    onChange={(event) => {
                      onTestRecipientEmailChange(event.currentTarget.value);
                    }}
                    className="h-7 w-[220px] text-[12.5px]"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-[11.5px]"
                    onClick={onSendTest}
                    disabled={testSendPending || !selectedSenderVerified}
                  >
                    {testSendPending ? "Sending..." : "Send test"}
                  </Button>
                  <button
                    type="button"
                    className="text-[11.5px] text-slate-500 underline underline-offset-2"
                    onClick={() => {
                      onTestSendOpenChange(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11.5px]"
                  onClick={() => {
                    onTestSendOpenChange(true);
                  }}
                  disabled={frozen || !selectedSenderVerified}
                  title={
                    selectedSenderVerified
                      ? undefined
                      : "Choose a verified sender alias before sending a test."
                  }
                >
                  <Send className="size-3" aria-hidden="true" />
                  Send test
                </Button>
              )}
              <div className="flex items-center gap-1.5">
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
                <span className="font-mono text-[10.5px] text-slate-700">
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
            </div>
          </div>

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

          <div className="px-5 py-5">
            {previewLoading ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Rendering the live preview...
              </div>
            ) : sample === null ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Add audience filters to load a preview contact.
              </div>
            ) : (
              <article className="rounded-lg border border-slate-200 bg-white p-5">
                <div
                  className={cn(
                    "prose prose-sm max-w-none text-slate-800",
                    "[&_a]:text-sky-700 [&_a]:underline [&_hr]:border-slate-200",
                  )}
                  dangerouslySetInnerHTML={{ __html: sample.html }}
                />
              </article>
            )}
          </div>
        </section>

        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11.5px] text-slate-500">
          <Info className="mr-1.5 inline size-3.5 text-slate-500" />
          {sample === null
            ? "Preview loads once the audience resolves."
            : `Resolves merge tokens for ${sample.name}. Cycle through samples to spot-check different recipients.`}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-5">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Continue to review</Button>
      </div>

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
