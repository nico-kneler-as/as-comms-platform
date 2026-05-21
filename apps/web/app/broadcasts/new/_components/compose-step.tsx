"use client";

import { Braces, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RichTextComposerEditor } from "@/app/inbox/_components/composer-editor-surface";
import { ComposerToolbar } from "@/app/inbox/_components/composer-toolbar";

import { StepHeader, WizardFooter } from "./wizard-shell";

const MERGE_TOKENS = [
  "{{firstName}}",
  "{{projectName}}",
  "{{aliasEmail}}",
] as const;

interface ComposeStepProps {
  readonly subject: string;
  readonly preheader: string;
  readonly bodyPlaintext: string;
  readonly frozen: boolean;
  readonly onSubjectChange: (value: string) => void;
  readonly onPreheaderChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function ComposeStep({
  subject,
  preheader,
  bodyPlaintext,
  frozen,
  onSubjectChange,
  onPreheaderChange,
  onBodyChange,
  onBack,
  onContinue,
}: ComposeStepProps) {
  const subjectLen = subject.length;
  const subjectOverLimit = subjectLen > 70;
  const wordCount = bodyPlaintext.trim()
    ? bodyPlaintext.trim().split(/\s+/u).length
    : 0;
  const canContinue =
    subject.trim().length > 0 && bodyPlaintext.trim().length > 0;

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title="Write your email"
        description="Draft the subject, preheader, and body. The rendered email preview comes next."
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2.5">
          <label
            htmlFor="campaign-subject"
            className="w-[46px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500"
          >
            Subject
          </label>
          <Input
            id="campaign-subject"
            value={subject}
            onChange={(event) => {
              onSubjectChange(event.currentTarget.value);
            }}
            disabled={frozen}
            placeholder="What recipients see in their inbox"
            className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-[14.5px] font-semibold tracking-tight text-slate-900 shadow-none placeholder:font-normal focus-visible:ring-0"
            aria-label="Broadcast subject"
          />
          <span
            className={
              subjectOverLimit
                ? "shrink-0 font-mono text-[10.5px] tabular-nums text-amber-700"
                : "shrink-0 font-mono text-[10.5px] tabular-nums text-slate-500"
            }
          >
            {subjectLen}/70
          </span>
        </div>

        <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2">
          <label
            htmlFor="campaign-preheader"
            className="w-[46px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500"
          >
            Preview
          </label>
          <Input
            id="campaign-preheader"
            value={preheader}
            onChange={(event) => {
              onPreheaderChange(event.currentTarget.value);
            }}
            disabled={frozen}
            placeholder="Preheader text - shown next to the subject in most clients"
            className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-[12.5px] text-slate-800 shadow-none focus-visible:ring-0"
            aria-label="Broadcast preheader"
          />
        </div>

        <RichTextComposerEditor
          bodyPlaintext={bodyPlaintext}
          errorMessage={undefined}
          showToolbar={false}
          onChange={onBodyChange}
          onClearErrors={() => undefined}
          frameClassName="overflow-hidden rounded-none border-0"
          contentClassName="min-h-[300px] bg-white px-4 py-3 text-sm leading-6"
          toolbarFooter={({ activeCommands, onCommand, insertText }) => (
            <div className="border-t border-slate-200 bg-slate-50/70">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <ComposerToolbar
                    activeCommands={activeCommands}
                    onCommand={onCommand}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={frozen}
                        aria-label="Insert merge token"
                        className="size-7"
                      >
                        <Braces className="size-3.5" aria-hidden="true" />
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
                </div>
                <span className="font-mono text-[10.5px] tabular-nums text-slate-500">
                  {wordCount.toLocaleString()}{" "}
                  <span className="text-slate-400">
                    word{wordCount === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Info className="size-3" aria-hidden="true" />
                  AS footer and unsubscribe links are appended automatically.
                </span>
                <span className="ml-auto text-slate-500">
                  Preview and send a test on the next step.
                </span>
              </div>
            </div>
          )}
        />
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
