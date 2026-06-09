"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type RefAttributes,
} from "react";
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

import type { LaunchType } from "@as-comms/contracts";

import type {
  UnlayerHostHandle,
  UnlayerHostProps,
} from "./unlayer-host";
import { StepHeader, WizardFooter } from "./wizard-shell";

const MERGE_TOKENS = [
  "{{firstName}}",
  "{{projectName}}",
  "{{aliasEmail}}",
] as const;

const loadUnlayerHost = async (): Promise<
  ComponentType<UnlayerHostProps & RefAttributes<UnlayerHostHandle>>
> =>
  (await import("./unlayer-host")).UnlayerHost;

const UnlayerHost = dynamic<UnlayerHostProps & RefAttributes<UnlayerHostHandle>>(
  loadUnlayerHost,
  {
    ssr: false,
    loading: () => <EditorLoadingSkeleton />,
  },
);

interface ComposeStepProps {
  readonly launchType: LaunchType;
  readonly subject: string;
  readonly preheader: string;
  readonly bodyPlaintext: string;
  readonly savedDesign: unknown;
  readonly selectedAliasSignature: string;
  readonly frozen: boolean;
  /**
   * True while the draft-save server action triggered by Continue is in
   * flight. Used to show a pending state on the primary button so the
   * operator has visible feedback during the save → step-transition gap.
   */
  readonly continuePending?: boolean;
  readonly onSubjectChange: (value: string) => void;
  readonly onPreheaderChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyDesignJson: unknown;
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

function EditorLoadingSkeleton() {
  return (
    <div
      className="h-[720px] w-full rounded-md border border-slate-200 bg-slate-50"
      aria-busy="true"
    >
      <span className="sr-only" aria-live="polite">
        Loading the email editor
      </span>
      <div className="grid h-full grid-cols-[64px_minmax(0,1fr)_240px] gap-4 px-4 py-4">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={`tool-skeleton-${String(index)}`}
              className="h-8 w-10 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="flex items-center justify-center">
          <div className="flex w-full max-w-[600px] flex-col gap-4">
            <span className="h-16 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <span className="h-32 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <span className="h-8 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={`property-skeleton-${String(index)}`}
              className="h-6 w-32 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ComposeStep({
  launchType,
  subject,
  preheader,
  bodyPlaintext,
  savedDesign,
  selectedAliasSignature,
  frozen,
  continuePending = false,
  onSubjectChange,
  onPreheaderChange,
  onBodyChange,
  onBack,
  onContinue,
}: ComposeStepProps) {
  const unlayerHostRef = useRef<UnlayerHostHandle | null>(null);
  const [htmlEditorReady, setHtmlEditorReady] = useState(
    launchType !== "html_email",
  );
  const subjectLen = subject.length;
  const subjectOverLimit = subjectLen > 70;
  const wordCount = bodyPlaintext.trim()
    ? bodyPlaintext.trim().split(/\s+/u).length
    : 0;
  const canContinue =
    subject.trim().length > 0 &&
    bodyPlaintext.trim().length > 0 &&
    (launchType === "normal_email" || htmlEditorReady);

  useEffect(() => {
    setHtmlEditorReady(launchType !== "html_email");
  }, [launchType]);

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title={
          launchType === "html_email"
            ? "Compose your HTML email"
            : "Write your email"
        }
        description={
          launchType === "html_email"
            ? "Drag blocks onto the canvas to build the message. Subject and preheader above are what recipients see in their inbox. Preview opens on the next step."
            : "Draft the subject, preheader, and body. The rendered email preview comes next."
        }
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

        {launchType === "html_email" ? (
          <UnlayerHost
            ref={unlayerHostRef}
            savedDesign={savedDesign}
            onSave={onBodyChange}
            onReadyChange={setHtmlEditorReady}
          />
        ) : (
          <RichTextComposerEditor
            bodyPlaintext={bodyPlaintext}
            errorMessage={undefined}
            showToolbar={false}
            onChange={(value) => {
              onBodyChange({
                bodyDesignJson: null,
                bodyPlaintext: value.bodyPlaintext,
                bodyHtml: value.bodyHtml,
              });
            }}
            onClearErrors={() => undefined}
            frameClassName="overflow-hidden rounded-none border-0"
            contentClassName="min-h-[300px] bg-white px-4 py-3 text-sm leading-6"
            bottomSlot={
              selectedAliasSignature.length > 0 ? (
                <div className="px-4 pb-3 pt-2 whitespace-pre-line text-[13px] leading-relaxed text-slate-500">
                  {selectedAliasSignature}
                </div>
              ) : undefined
            }
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
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        primaryLabel={continuePending ? "Saving…" : "Continue"}
        primaryAction={() => {
          void (async () => {
            if (launchType === "html_email") {
              const saved = await unlayerHostRef.current?.flushExport();
              if (saved === false) {
                return;
              }
            }
            onContinue();
          })();
        }}
        primaryDisabled={!canContinue}
        primaryLoading={continuePending}
      />
    </section>
  );
}
