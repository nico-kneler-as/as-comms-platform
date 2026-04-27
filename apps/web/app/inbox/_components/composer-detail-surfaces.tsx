"use client";

import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RADIUS, SHADOW, TYPE } from "@/app/_lib/design-tokens-v2";

import { ComposerAiDraftWindow } from "./composer-ai-draft-window";
import {
  ComposerRecipientPicker,
  type ComposerRecipientValue,
} from "./composer-recipient-picker";
import { ComposerSendFromChip } from "./composer-send-from-chip";
import { AboutThisDraft } from "./about-this-draft";
import {
  AttachmentRow,
  ComposerField,
  InlineErrorBanner,
  RichTextComposerEditor,
} from "./composer-editor-surface";
import {
  AlertCircleIcon,
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from "./icons";
import type { AttachmentDraft, InlineComposerError } from "./composer-shared";
import type { InboxComposerAliasOption } from "../_lib/view-models";
import type {
  AiDraftState,
  ComposerValidationError,
} from "./inbox-client-provider";

function WarningKnowledgeIndicator({
  tooltipMessage,
}: {
  readonly tooltipMessage: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
          <AlertCircleIcon className="size-3.5" />
          AI grounding unavailable for this project
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-pretty">
        {tooltipMessage}
      </TooltipContent>
    </Tooltip>
  );
}

export function ComposerPaneChrome({
  title,
  description,
  activeTab,
  canUseNoteTab,
  onEmail,
  onNote,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly activeTab: "email" | "note";
  readonly canUseNoteTab: boolean;
  readonly onEmail: () => void;
  readonly onNote: () => void;
  readonly onClose: () => void;
}) {
  return (
    <>
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{title}</p>
            <p className={`mt-1 ${TYPE.caption}`}>{description}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close composer"
            className="size-8"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEmail}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
              activeTab === "email"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600",
            )}
          >
            <MailIcon className="size-4" />
            Email
          </button>
          {canUseNoteTab ? (
            <button
              type="button"
              onClick={onNote}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                activeTab === "note"
                  ? "bg-amber-600 text-white"
                  : "bg-amber-50 text-amber-700",
              )}
            >
              <NoteIcon className="size-4" />
              Note
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ComposerEmailSurface({
  composerAliases,
  selectedAlias,
  aliasError,
  recipient,
  ccRecipients,
  bccRecipients,
  showCc,
  showBcc,
  isReplying,
  recipientError,
  ccError,
  bccError,
  subject,
  subjectError,
  body,
  bodyError,
  attachments,
  attachmentError,
  aiDraft,
  aiDirective,
  repromptText,
  isGeneratingAi,
  runAiDraftDisabled,
  runAiDraftDisabledReason,
  selectedAliasAiReady,
  selectedAliasProjectName,
  aiWarningMessage,
  inlineError,
  showKnowledgeCapture,
  captureAsKnowledge,
  isSendDisabled,
  isSending,
  isAboutOpen,
  onAboutOpenChange,
  onAliasChange,
  onRecipientChange,
  onCcChange,
  onBccChange,
  onToggleCc,
  onToggleBcc,
  onSubjectChange,
  onBodyChange,
  onClearErrors,
  onAiDirectiveChange,
  onAiEdited,
  onDiscardAi,
  onOpenReprompt,
  onCancelReprompt,
  onApproveAi,
  onRunAiDraft,
  onRepromptTextChange,
  onReprompt,
  onAttachmentClick,
  onAttachmentRemove,
  onKnowledgeCaptureChange,
  onSend,
  onCancel,
}: {
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly selectedAlias: string | null;
  readonly aliasError?: ComposerValidationError;
  readonly recipient: ComposerRecipientValue | null;
  readonly ccRecipients: readonly ComposerRecipientValue[];
  readonly bccRecipients: readonly ComposerRecipientValue[];
  readonly showCc: boolean;
  readonly showBcc: boolean;
  readonly isReplying: boolean;
  readonly recipientError?: ComposerValidationError;
  readonly ccError?: ComposerValidationError;
  readonly bccError?: ComposerValidationError;
  readonly subject: string;
  readonly subjectError?: ComposerValidationError;
  readonly body: string;
  readonly bodyError?: ComposerValidationError;
  readonly attachments: readonly AttachmentDraft[];
  readonly attachmentError?: ComposerValidationError;
  readonly aiDraft: AiDraftState;
  readonly aiDirective: string;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly runAiDraftDisabled: boolean;
  readonly runAiDraftDisabledReason: string | null;
  readonly selectedAliasAiReady: boolean;
  readonly selectedAliasProjectName: string | null;
  readonly aiWarningMessage: string | null;
  readonly inlineError: InlineComposerError | null;
  readonly showKnowledgeCapture: boolean;
  readonly captureAsKnowledge: boolean;
  readonly isSendDisabled: boolean;
  readonly isSending: boolean;
  readonly isAboutOpen: boolean;
  readonly onAboutOpenChange: (open: boolean) => void;
  readonly onAliasChange: (value: string | null) => void;
  readonly onRecipientChange: (
    recipient: ComposerRecipientValue | null,
  ) => void;
  readonly onCcChange: (
    recipients: readonly ComposerRecipientValue[],
  ) => void;
  readonly onBccChange: (
    recipients: readonly ComposerRecipientValue[],
  ) => void;
  readonly onToggleCc: (open: boolean) => void;
  readonly onToggleBcc: (open: boolean) => void;
  readonly onSubjectChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onClearErrors: () => void;
  readonly onAiDirectiveChange: (value: string) => void;
  readonly onAiEdited: () => void;
  readonly onDiscardAi: () => void;
  readonly onOpenReprompt: () => void;
  readonly onCancelReprompt: () => void;
  readonly onApproveAi: () => void;
  readonly onRunAiDraft: () => void;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly onAttachmentClick: () => void;
  readonly onAttachmentRemove: (id: string) => void;
  readonly onKnowledgeCaptureChange: (value: boolean) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}) {
  const knowledgeTooltip =
    "Set up Anthropic integration in Settings → Integrations to enable AI drafting.";

  return (
    <TooltipProvider delayDuration={200}>
      <ComposerField label="FROM">
        <ComposerSendFromChip
          value={selectedAlias}
          aliases={composerAliases}
          onChange={onAliasChange}
          {...(aliasError?.message ? { errorMessage: aliasError.message } : {})}
        />
      </ComposerField>

      <ComposerField label="TO">
        <div className="rounded-md bg-white">
          <ComposerRecipientPicker
            recipients={recipient === null ? [] : [recipient]}
            locked={isReplying}
            single
            rightSlot={
              !showCc || !showBcc ? (
                <div className="flex items-center gap-1 pt-0.5 text-[11.5px]">
                  {!showCc ? (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleCc(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleBcc(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      Bcc
                    </button>
                  ) : null}
                </div>
              ) : null
            }
            onRecipientsChange={(nextRecipients) => {
              onRecipientChange(nextRecipients[0] ?? null);
            }}
          />
        </div>
        {recipientError ? (
          <p className="mt-1 text-xs text-rose-700">{recipientError.message}</p>
        ) : null}
      </ComposerField>

      {showCc ? (
        <ComposerField label="CC">
          <ComposerRecipientPicker
            recipients={ccRecipients}
            rightSlot={
              <button
                type="button"
                aria-label="Hide Cc field"
                onClick={() => {
                  onToggleCc(false);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-3.5" />
              </button>
            }
            onRecipientsChange={onCcChange}
          />
          {ccError ? (
            <p className="mt-1 text-xs text-rose-700">{ccError.message}</p>
          ) : null}
        </ComposerField>
      ) : null}

      {showBcc ? (
        <ComposerField label="BCC">
          <ComposerRecipientPicker
            recipients={bccRecipients}
            rightSlot={
              <button
                type="button"
                aria-label="Hide Bcc field"
                onClick={() => {
                  onToggleBcc(false);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-3.5" />
              </button>
            }
            onRecipientsChange={onBccChange}
          />
          {bccError ? (
            <p className="mt-1 text-xs text-rose-700">{bccError.message}</p>
          ) : null}
        </ComposerField>
      ) : null}

      <ComposerField label="SUBJ">
        <Input
          value={subject}
          onChange={(event) => {
            onSubjectChange(event.currentTarget.value);
          }}
          placeholder="Subject"
          className={cn(
            "h-9 border-0 px-0 text-[13.5px] font-medium shadow-none focus-visible:ring-0",
            subjectError ? "text-rose-900" : "",
          )}
        />
        {subjectError ? (
          <p className="mt-1 text-xs text-rose-700">{subjectError.message}</p>
        ) : null}
      </ComposerField>

      <RichTextComposerEditor
        bodyPlaintext={body}
        errorMessage={bodyError?.message}
        onChange={(nextBody) => {
          onBodyChange(nextBody);
          if (aiDraft.status === "inserted") {
            onAiEdited();
          }
        }}
        onClearErrors={onClearErrors}
        topSlot={
          <ComposerAiDraftWindow
            aiDraft={aiDraft}
            directiveText={aiDirective}
            repromptText={repromptText}
            isGeneratingAi={isGeneratingAi}
            runDraftDisabled={runAiDraftDisabled}
            runDraftDisabledReason={runAiDraftDisabledReason}
            onDirectiveTextChange={onAiDirectiveChange}
            onRepromptTextChange={onRepromptTextChange}
            onRunDraft={onRunAiDraft}
            onOpenReprompt={onOpenReprompt}
            onSubmitReprompt={onReprompt}
            onCancelReprompt={onCancelReprompt}
            onDiscard={onDiscardAi}
            onApprove={onApproveAi}
            onAbout={() => {
              onAboutOpenChange(true);
            }}
          />
        }
      />

      {aiWarningMessage ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {aiWarningMessage}
        </div>
      ) : null}
      {bodyError ? (
        <div className="px-4 py-2 text-xs text-rose-700">
          {bodyError.message}
        </div>
      ) : null}

      <AttachmentRow attachments={attachments} onRemove={onAttachmentRemove} />
      {attachmentError ? (
        <div className="px-4 pb-3 text-xs text-rose-700">
          {attachmentError.message}
        </div>
      ) : null}

      <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-2">
        {inlineError || recipientError || ccError || bccError || attachmentError ? (
          <InlineErrorBanner
            message={
              inlineError?.message ??
              recipientError?.message ??
              ccError?.message ??
              bccError?.message ??
              attachmentError?.message ??
              "Something went wrong."
            }
            retryable={inlineError?.retryable === true}
            onRetry={onSend}
          />
        ) : null}

        {showKnowledgeCapture ? (
          <label className="mb-3 flex items-start gap-2 px-1 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={captureAsKnowledge}
              onChange={(event) => {
                onKnowledgeCaptureChange(event.currentTarget.checked);
              }}
              className="mt-0.5 size-4 rounded border-slate-300"
            />
            <span>Save this reply as a canonical for the selected project</span>
          </label>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5 border-l border-slate-200 pl-3 text-[11.5px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            onClick={onAttachmentClick}
          >
            <PaperclipIcon className="size-3.5" />
            Attach
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {selectedAliasAiReady && selectedAliasProjectName !== null ? (
              <span className={`hidden items-center ${TYPE.caption} md:inline-flex`}>
                Uses {selectedAliasProjectName} knowledge
              </span>
            ) : selectedAliasProjectName !== null ? (
              <div className="hidden md:block">
                <WarningKnowledgeIndicator tooltipMessage={knowledgeTooltip} />
              </div>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              className="text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSendDisabled}
              className="h-9 rounded-md bg-slate-900 px-3 text-[12.5px] font-medium text-white shadow-sm hover:bg-slate-800"
              onClick={onSend}
            >
              {isSending ? (
                <>
                  <LoaderIcon className="size-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <SendIcon className="size-4" />
                  Send
                </>
              )}
            </Button>
          </div>
        </div>

        {!selectedAliasAiReady && selectedAliasProjectName !== null ? (
          <div className="mt-2 md:hidden">
            <WarningKnowledgeIndicator tooltipMessage={knowledgeTooltip} />
          </div>
        ) : null}
      </div>

      <AboutThisDraft
        aiDraft={aiDraft}
        open={isAboutOpen}
        onOpenChange={onAboutOpenChange}
      />
    </TooltipProvider>
  );
}

export function ComposerNoteSurface({
  body,
  bodyError,
  isSavingNote,
  isSaveNoteDisabled,
  inlineError,
  textareaRef,
  onBodyChange,
  onTextareaInput,
  onSaveNote,
  onCancel,
}: {
  readonly body: string;
  readonly bodyError?: ComposerValidationError;
  readonly isSavingNote: boolean;
  readonly isSaveNoteDisabled: boolean;
  readonly inlineError: InlineComposerError | null;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onBodyChange: (value: string) => void;
  readonly onTextareaInput: (target: HTMLTextAreaElement) => void;
  readonly onSaveNote: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <div
        className={`border-l-4 border-amber-300 bg-amber-50/50 px-4 py-4 ${SHADOW.sm}`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Internal note
            </p>
            <p className={`mt-1 ${TYPE.caption} text-amber-800`}>
              Team-visible note only. This will not be sent to the contact.
            </p>
          </div>
          <Button
            type="button"
            disabled={isSaveNoteDisabled}
            onClick={onSaveNote}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isSavingNote ? (
              <>
                <LoaderIcon className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <NoteIcon className="size-4" />
                Save note
              </>
            )}
          </Button>
        </div>
        <textarea
          ref={textareaRef}
          rows={6}
          value={body}
          onChange={(event) => {
            onBodyChange(event.currentTarget.value);
          }}
          onInput={(event) => {
            onTextareaInput(event.currentTarget);
          }}
          placeholder="Write a team-visible note"
          className={cn(
            `max-h-[30rem] min-h-48 w-full resize-none border border-amber-300 bg-amber-50/40 px-4 py-3 text-sm leading-6 text-slate-900 ${RADIUS.md} focus:outline-none focus:ring-1 focus:ring-amber-300`,
            bodyError ? "border-rose-300 ring-1 ring-rose-200" : "",
          )}
        />
        {bodyError ? (
          <p className="mt-2 text-xs text-rose-700">{bodyError.message}</p>
        ) : null}
      </div>

      <div className="border-t border-slate-200 px-4 py-4">
        {inlineError ? (
          <InlineErrorBanner
            message={inlineError.message}
            retryable={inlineError.retryable}
            onRetry={onSaveNote}
          />
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSaveNoteDisabled}
            onClick={onSaveNote}
          >
            {isSavingNote ? (
              <>
                <LoaderIcon className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <NoteIcon className="size-4" />
                Save note
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
