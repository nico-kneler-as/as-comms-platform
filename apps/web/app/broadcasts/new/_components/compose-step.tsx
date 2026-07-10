"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
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
import { prepareUploadedHtml } from "@as-comms/domain/html-import";
import {
  DEFAULT_SMS_OPT_OUT_FOOTER,
  smsMetrics,
} from "@as-comms/domain/sms-segments";

import type { UnlayerHostHandle, UnlayerHostProps } from "./unlayer-host";
import { StepHeader, WizardFooter } from "./wizard-shell";

const MERGE_TOKENS = [
  "{{firstName}}",
  "{{projectName}}",
  "{{aliasEmail}}",
] as const;
const SMS_MERGE_TOKENS = ["{{firstName}}", "{{email}}"] as const;

const loadUnlayerHost = async (): Promise<
  ComponentType<UnlayerHostProps & RefAttributes<UnlayerHostHandle>>
> => (await import("./unlayer-host")).UnlayerHost;

const UnlayerHost = dynamic<
  UnlayerHostProps & RefAttributes<UnlayerHostHandle>
>(loadUnlayerHost, {
  ssr: false,
  loading: () => <EditorLoadingSkeleton />,
});

interface ComposeStepProps {
  readonly launchType: LaunchType;
  readonly subject: string;
  readonly subjectB?: string;
  readonly abTestEnabled?: boolean;
  readonly preheader: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
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
  readonly onSubjectBChange?: (value: string) => void;
  readonly onAbTestEnabledChange?: (value: boolean) => void;
  readonly onPreheaderChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyDesignJson: unknown;
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

type HtmlComposeMode = "editor" | "upload";

function readInitialHtmlComposeMode(input: {
  readonly launchType: LaunchType;
  readonly bodyHtml: string;
  readonly savedDesign: unknown;
}): HtmlComposeMode {
  if (input.launchType !== "html_email") {
    return "editor";
  }

  const looksLikeFullDocument = /<(?:!doctype|html\b)/iu.test(input.bodyHtml);

  return input.savedDesign === null &&
    input.bodyHtml.trim().length > 0 &&
    looksLikeFullDocument
    ? "upload"
    : "editor";
}

function htmlToPlaintext(html: string): string {
  const fromDom =
    typeof DOMParser === "undefined"
      ? html
      : new DOMParser().parseFromString(html, "text/html").body.textContent ||
        "";

  return fromDom.replace(/\s+/gu, " ").trim();
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
  subjectB = "",
  abTestEnabled = false,
  preheader,
  bodyPlaintext,
  bodyHtml,
  savedDesign,
  selectedAliasSignature,
  frozen,
  continuePending = false,
  onSubjectChange,
  onSubjectBChange = () => undefined,
  onAbTestEnabledChange = () => undefined,
  onPreheaderChange,
  onBodyChange,
  onBack,
  onContinue,
}: ComposeStepProps) {
  const unlayerHostRef = useRef<UnlayerHostHandle | null>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const subjectBInputRef = useRef<HTMLInputElement>(null);
  const [htmlComposeMode, setHtmlComposeMode] = useState<HtmlComposeMode>(() =>
    readInitialHtmlComposeMode({ launchType, bodyHtml, savedDesign }),
  );
  const [htmlEditorReady, setHtmlEditorReady] = useState(
    launchType !== "html_email",
  );
  // Seed the paste/upload textarea from the persisted bodyHtml so returning to
  // this step (or reopening the draft) shows the uploaded HTML instead of an
  // empty box. bodyHtml is hydrated from the draft at the wizard level, so a
  // remount here restores the file. (Mount-only: a sync effect would fight a
  // user intentionally clearing the textarea, since clearing it deliberately
  // leaves bodyHtml untouched.)
  const [uploadedHtmlValue, setUploadedHtmlValue] = useState(() =>
    readInitialHtmlComposeMode({ launchType, bodyHtml, savedDesign }) ===
    "upload"
      ? bodyHtml
      : "",
  );
  const [uploadWarnings, setUploadWarnings] = useState<readonly string[]>([]);
  const [activeSubjectField, setActiveSubjectField] = useState<"a" | "b">("a");
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isSmsLaunch = launchType === "sms";
  const subjectLen = subject.length;
  const subjectOverLimit = subjectLen > 70;
  const subjectBLen = subjectB.length;
  const subjectBOverLimit = subjectBLen > 70;
  const hasRequiredSubjects =
    subject.trim().length > 0 &&
    (!abTestEnabled || subjectB.trim().length > 0);
  const wordCount = bodyPlaintext.trim()
    ? bodyPlaintext.trim().split(/\s+/u).length
    : 0;
  const smsBodyWithFooter = `${bodyPlaintext}\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`;
  const smsSegmentMetrics = smsMetrics(smsBodyWithFooter);
  const canContinue = isSmsLaunch
    ? bodyPlaintext.trim().length > 0
    : hasRequiredSubjects &&
      (launchType === "normal_email"
        ? bodyPlaintext.trim().length > 0
        : htmlComposeMode === "upload"
          ? bodyHtml.trim().length > 0
          : bodyPlaintext.trim().length > 0 && htmlEditorReady);

  useEffect(() => {
    setHtmlComposeMode(
      readInitialHtmlComposeMode({ launchType, bodyHtml, savedDesign }),
    );
  }, [bodyHtml, launchType, savedDesign]);

  useEffect(() => {
    setHtmlEditorReady(
      launchType !== "html_email" || htmlComposeMode === "upload",
    );
  }, [htmlComposeMode, launchType]);

  useEffect(() => {
    if (!abTestEnabled) {
      setActiveSubjectField("a");
    }
  }, [abTestEnabled]);

  function insertSmsMergeToken(token: string) {
    const textarea = smsTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? bodyPlaintext.length;
    const selectionEnd = textarea?.selectionEnd ?? bodyPlaintext.length;
    const nextValue =
      bodyPlaintext.slice(0, selectionStart) +
      token +
      bodyPlaintext.slice(selectionEnd);
    onBodyChange({
      bodyDesignJson: null,
      bodyPlaintext: nextValue,
      bodyHtml: "",
    });
    const nextCaret = selectionStart + token.length;
    requestAnimationFrame(() => {
      const el = smsTextareaRef.current;
      if (el !== null) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function insertHtmlSubjectMergeToken(token: (typeof MERGE_TOKENS)[number]) {
    const targetField =
      abTestEnabled && activeSubjectField === "b" ? "b" : "a";
    const input =
      targetField === "b" ? subjectBInputRef.current : subjectInputRef.current;
    const currentValue = targetField === "b" ? subjectB : subject;
    const onChange =
      targetField === "b" ? onSubjectBChange : onSubjectChange;
    const selectionStart = input?.selectionStart ?? currentValue.length;
    const selectionEnd = input?.selectionEnd ?? currentValue.length;
    const nextValue =
      currentValue.slice(0, selectionStart) +
      token +
      currentValue.slice(selectionEnd);
    onChange(nextValue);
    const nextCaret = selectionStart + token.length;
    requestAnimationFrame(() => {
      if (input !== null) {
        input.focus();
        input.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function applyUploadedHtml(
    rawHtml: string,
    options?: { readonly syncTextareaValue?: boolean },
  ) {
    const result = prepareUploadedHtml(rawHtml);
    if (options?.syncTextareaValue ?? false) {
      setUploadedHtmlValue(result.html);
    }
    setUploadWarnings(result.warnings);
    onBodyChange({
      bodyDesignJson: null,
      bodyPlaintext: htmlToPlaintext(result.html),
      bodyHtml: result.html,
    });
  }

  function renderEmailSubjectFields() {
    return (
      <>
        <div className="border-b border-slate-200 bg-slate-50/40 px-4 py-3">
          <label className="inline-flex items-center gap-2 text-[12px] font-medium text-slate-700">
            <input
              id="campaign-ab-subject-test"
              type="checkbox"
              checked={abTestEnabled}
              disabled={frozen}
              onChange={(event) => {
                onAbTestEnabledChange(event.currentTarget.checked);
              }}
              aria-label="Enable A/B subject test"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            <span>A/B test subject line</span>
          </label>
          <p className="mt-1 text-[11px] text-slate-500">
            Split the frozen audience 50/50 between subject A and subject B.
          </p>
        </div>

        <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2.5">
          <label
            htmlFor="campaign-subject"
            className="w-[72px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500"
          >
            {abTestEnabled ? "Subject A" : "Subject"}
          </label>
          <Input
            ref={subjectInputRef}
            id="campaign-subject"
            value={subject}
            onChange={(event) => {
              onSubjectChange(event.currentTarget.value);
            }}
            onFocus={() => {
              setActiveSubjectField("a");
            }}
            disabled={frozen}
            placeholder="What recipients see in their inbox"
            className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-[14.5px] font-semibold tracking-tight text-slate-900 shadow-none placeholder:font-normal focus-visible:ring-0"
            aria-label={abTestEnabled ? "Broadcast subject A" : "Broadcast subject"}
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

        {abTestEnabled ? (
          <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2.5">
            <label
              htmlFor="campaign-subject-b"
              className="w-[72px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500"
            >
              Subject B
            </label>
            <Input
              ref={subjectBInputRef}
              id="campaign-subject-b"
              value={subjectB}
              onChange={(event) => {
                onSubjectBChange(event.currentTarget.value);
              }}
              onFocus={() => {
                setActiveSubjectField("b");
              }}
              disabled={frozen}
              placeholder="Alternate subject line for the B split"
              className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-[14.5px] font-semibold tracking-tight text-slate-900 shadow-none placeholder:font-normal focus-visible:ring-0"
              aria-label="Broadcast subject B"
            />
            <span
              className={
                subjectBOverLimit
                  ? "shrink-0 font-mono text-[10.5px] tabular-nums text-amber-700"
                  : "shrink-0 font-mono text-[10.5px] tabular-nums text-slate-500"
              }
            >
              {subjectBLen}/70
            </span>
          </div>
        ) : null}

        <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2">
          <label
            htmlFor="campaign-preheader"
            className="w-[72px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500"
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

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">Merge tags:</span>
          {MERGE_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => {
                insertHtmlSubjectMergeToken(token);
              }}
              disabled={frozen}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {token}
            </button>
          ))}
          <span className="ml-auto text-[10.5px] text-slate-500">
            Inserts into the active subject field.
          </span>
        </div>
      </>
    );
  }

  return (
    <section className="flex h-full flex-col">
      <StepHeader
        title={
          isSmsLaunch
            ? "Write your SMS"
            : launchType === "html_email"
              ? "Compose your HTML email"
              : "Write your email"
        }
        description={
          isSmsLaunch
            ? "Draft the SMS body. Segment count includes the automatic opt-out footer the platform appends at send time."
            : launchType === "html_email"
              ? htmlComposeMode === "upload"
                ? "Upload or paste a full HTML document. We store the translated HTML directly, surface import warnings, and append the platform footer during preview and send."
                : "Drag blocks onto the canvas to build the message. Subject and preheader above are what recipients see in their inbox. Preview opens on the next step."
              : "Draft the subject, preheader, and body. The rendered email preview comes next."
        }
        rightSlot={
          isSmsLaunch ? undefined : (
            <Link
              href="/broadcasts/media"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-[11.5px] font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
            >
              Media library ↗
            </Link>
          )
        }
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isSmsLaunch ? (
          <>
            <div className="relative min-h-[320px] px-4 pb-3 pt-2">
              <textarea
                ref={smsTextareaRef}
                id="campaign-sms-body"
                rows={8}
                value={bodyPlaintext}
                onChange={(event) => {
                  onBodyChange({
                    bodyDesignJson: null,
                    bodyPlaintext: event.currentTarget.value,
                    bodyHtml: "",
                  });
                }}
                disabled={frozen}
                placeholder="Write your SMS"
                className="h-full min-h-[280px] w-full resize-none border-0 bg-white px-0 py-3 text-sm leading-6 text-slate-900 shadow-none focus:outline-none focus:ring-0"
                aria-label="Broadcast SMS body"
              />
            </div>

            <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] tabular-nums text-slate-600">
                <span>{smsSegmentMetrics.length} chars</span>
                <span>
                  {smsSegmentMetrics.segments} segment
                  {smsSegmentMetrics.segments === 1 ? "" : "s"}
                </span>
                <span>{smsSegmentMetrics.encoding}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-slate-500">
                <span>
                  '{DEFAULT_SMS_OPT_OUT_FOOTER}' is added automatically.
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span>Insert:</span>
                  {SMS_MERGE_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => {
                        insertSmsMergeToken(token);
                      }}
                      disabled={frozen}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Braces className="h-3 w-3" />
                      {token}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          </>
        ) : launchType === "html_email" ? (
          <>
            {renderEmailSubjectFields()}

            <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
              <div
                aria-label="HTML compose mode"
                className="inline-flex rounded-lg border border-slate-200 bg-white p-1"
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={htmlComposeMode === "editor"}
                  disabled={frozen}
                  onClick={() => {
                    setHtmlComposeMode("editor");
                  }}
                  className={
                    htmlComposeMode === "editor"
                      ? "rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-[12px] font-medium text-slate-600"
                  }
                >
                  Design in editor
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={htmlComposeMode === "upload"}
                  disabled={frozen}
                  onClick={() => {
                    setHtmlComposeMode("upload");
                  }}
                  className={
                    htmlComposeMode === "upload"
                      ? "rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-[12px] font-medium text-slate-600"
                  }
                >
                  Upload HTML
                </button>
              </div>
            </div>

            {htmlComposeMode === "upload" ? (
              <div className="space-y-4 border-t border-slate-200 px-4 py-4">
                {uploadWarnings.length > 0 ? (
                  <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-900">
                      Import warnings
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-amber-900">
                      {uploadWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="flex flex-col gap-2.5">
                  <label
                    htmlFor="campaign-html-file"
                    className="block text-[12px] font-medium leading-none text-slate-700"
                  >
                    Upload an HTML file
                  </label>
                  <input
                    id="campaign-html-file"
                    type="file"
                    accept=".html,text/html"
                    disabled={frozen}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      if (file === null) {
                        return;
                      }

                      void (async () => {
                        try {
                          applyUploadedHtml(await file.text(), {
                            syncTextareaValue: true,
                          });
                        } catch {
                          setUploadWarnings([
                            "Unable to read the uploaded HTML file.",
                          ]);
                        }
                      })();
                    }}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-3 text-[12px] leading-5 text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-white"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="campaign-html-paste"
                    className="text-[12px] font-medium text-slate-700"
                  >
                    Paste complete HTML
                  </label>
                  <textarea
                    id="campaign-html-paste"
                    value={uploadedHtmlValue}
                    disabled={frozen}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      setUploadedHtmlValue(nextValue);
                      if (nextValue.trim().length === 0) {
                        setUploadWarnings([]);
                        return;
                      }

                      applyUploadedHtml(nextValue);
                    }}
                    placeholder="Paste a full exported HTML document here."
                    className="min-h-[320px] w-full rounded-lg border border-slate-200 px-3 py-3 font-mono text-[12px] leading-6 text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="size-3" aria-hidden="true" />
                    AS footer and unsubscribe links are appended automatically.
                  </span>
                </div>
              </div>
            ) : (
              <UnlayerHost
                ref={unlayerHostRef}
                savedDesign={savedDesign}
                onSave={onBodyChange}
                onReadyChange={setHtmlEditorReady}
              />
            )}
          </>
        ) : (
          <>
            {renderEmailSubjectFields()}

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
                      AS footer and unsubscribe links are appended
                      automatically.
                    </span>
                    <span className="ml-auto text-slate-500">
                      Preview and send a test on the next step.
                    </span>
                  </div>
                </div>
              )}
            />
          </>
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        primaryLabel={continuePending ? "Saving…" : "Continue"}
        primaryAction={() => {
          void (async () => {
            if (launchType === "html_email" && htmlComposeMode === "editor") {
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
