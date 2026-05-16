"use client";

import { useMemo } from "react";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RichTextComposerEditor } from "@/app/inbox/_components/composer-editor-surface";
import { ComposerToolbar } from "@/app/inbox/_components/composer-toolbar";

import type { ComposePreviewData } from "../../_lib/audience-data-source";

const MERGE_TOKENS = ["{{firstName}}", "{{projectName}}", "{{aliasEmail}}"] as const;

interface ComposeStepProps {
  readonly subject: string;
  readonly preheader: string;
  readonly bodyPlaintext: string;
  readonly autosaveLabel: string;
  readonly previewData: ComposePreviewData | null;
  readonly previewLoading: boolean;
  readonly warningDismissed: boolean;
  readonly affectedContactsOpen: boolean;
  readonly testSendOpen: boolean;
  readonly testRecipientEmail: string;
  readonly testSendPending: boolean;
  readonly frozen: boolean;
  readonly onSubjectChange: (value: string) => void;
  readonly onPreheaderChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
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
    <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-3 border-b border-slate-200 px-5 py-3 text-sm last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <span className="min-w-0 truncate text-slate-800">
        {value && value.trim().length > 0 ? value : "—"}
      </span>
    </div>
  );
}

export function ComposeStep({
  subject,
  preheader,
  bodyPlaintext,
  autosaveLabel,
  previewData,
  previewLoading,
  warningDismissed,
  affectedContactsOpen,
  testSendOpen,
  testRecipientEmail,
  testSendPending,
  frozen,
  onSubjectChange,
  onPreheaderChange,
  onBodyChange,
  onBack,
  onContinue,
  onPreviewPrevious,
  onPreviewNext,
  onDismissWarning,
  onAffectedContactsOpenChange,
  onTestSendOpenChange,
  onTestRecipientEmailChange,
  onSendTest,
}: ComposeStepProps) {
  const warningSummary = useMemo(() => {
    if (
      previewData === null ||
      previewData.warningCount === 0 ||
      warningDismissed
    ) {
      return null;
    }

    const firstToken =
      previewData.affectedContacts[0]?.missingTokens[0] ?? "merge token";
    return `${previewData.warningCount.toLocaleString()} contacts will get a blank ${firstToken}.`;
  }, [previewData, warningDismissed]);
  const sample = previewData?.sample ?? null;
  const sampleLabel =
    sample === null ? "Sample" : `Sample · ${sample.initials}`;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 pb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase text-slate-500">
            Step 4
          </p>
          <h2 className="mt-2 text-balance text-2xl font-semibold text-slate-900">
            Compose the campaign
          </h2>
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-slate-500">
            Reuse the existing composer patterns, then spot-check the live
            preview against real audience data before freezing the send.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
          {autosaveLabel}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-5">
            <Input
              value={subject}
              onChange={(event) => {
                onSubjectChange(event.currentTarget.value);
              }}
              disabled={frozen}
              placeholder="Write the subject line"
              className="h-auto border-none px-0 py-0 text-2xl font-semibold text-slate-900 shadow-none focus-visible:ring-0"
              aria-label="Campaign subject"
            />
            <Input
              value={preheader}
              onChange={(event) => {
                onPreheaderChange(event.currentTarget.value);
              }}
              disabled={frozen}
              placeholder="Optional preheader text"
              className="mt-3 border-none px-0 py-0 text-sm text-slate-500 shadow-none focus-visible:ring-0"
              aria-label="Campaign preheader"
            />
          </div>

          {warningSummary !== null ? (
            <div className="mx-5 mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>{warningSummary}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
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
            </div>
          ) : null}

          <div className="min-h-0 flex-1 px-5 pb-5 pt-5">
            <RichTextComposerEditor
              bodyPlaintext={bodyPlaintext}
              errorMessage={undefined}
              showToolbar={false}
              onChange={onBodyChange}
              onClearErrors={() => undefined}
              frameClassName="overflow-hidden rounded-2xl border-slate-200"
              contentClassName="min-h-[320px] bg-white"
              toolbarFooter={({ activeCommands, onCommand, insertText }) => (
                <div className="rounded-b-2xl border border-t-0 border-slate-200 bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
                    <ComposerToolbar
                      activeCommands={activeCommands}
                      onCommand={onCommand}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={frozen}>
                            Insert merge token
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {MERGE_TOKENS.map((token) => (
                            <DropdownMenuItem
                              key={token}
                              onClick={() => {
                                insertText(token);
                              }}
                            >
                              {token}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onTestSendOpenChange(true);
                        }}
                        disabled={frozen}
                      >
                        <Send className="size-3.5" />
                        Send test
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 text-xs text-slate-500">
                    <Info className="size-3.5" />
                    Footer + unsubscribe auto-appended
                  </div>
                </div>
              )}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Live Preview
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {sampleLabel}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={onPreviewPrevious}
                disabled={previewData === null || previewData.sampleCount <= 1}
                aria-label="Previous sample contact"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={onPreviewNext}
                disabled={previewData === null || previewData.sampleCount <= 1}
                aria-label="Next sample contact"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-slate-200 bg-slate-50">
              <PreviewRow label="From" value={sample?.fromEmail ?? null} />
              <PreviewRow label="To" value={sample?.email ?? null} />
              <PreviewRow label="Subject" value={sample?.subject ?? subject} />
            </div>

            <div className="px-5 py-5">
              {previewLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Rendering the live preview…
                </div>
              ) : sample === null ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Add audience filters to load a preview contact.
                </div>
              ) : (
                <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    Previewing as {sample.name}
                  </div>
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
          </div>

          <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500">
            {sample === null
              ? "Preview loads once the audience resolves."
              : `Resolves merge tokens for ${sample.name}. Links open in new tabs — click any to spot-check.`}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-6">
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
          <div className="max-h-[50vh] overflow-y-auto rounded-2xl border border-slate-200">
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

      <Dialog open={testSendOpen} onOpenChange={onTestSendOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send test email</DialogTitle>
            <DialogDescription>
              Test sends use Postmark&apos;s test header and never enter the
              canonical campaign ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="campaign-test-recipient"
              className="text-sm font-medium text-slate-900"
            >
              Recipient email
            </label>
            <Input
              id="campaign-test-recipient"
              type="email"
              value={testRecipientEmail}
              onChange={(event) => {
                onTestRecipientEmailChange(event.currentTarget.value);
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onTestSendOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={onSendTest} disabled={testSendPending}>
              {testSendPending ? "Sending…" : "Send test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
