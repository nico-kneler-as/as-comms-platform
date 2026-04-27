"use client";

import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RADIUS, SHADOW, TYPE } from "@/app/_lib/design-tokens-v2";

import { ComposerAiDraftWindow } from "./composer-ai-draft-window";
import {
  ComposerRecipientPicker,
  type ComposerRecipientValue,
} from "./composer-recipient-picker";
import { ComposerSendFromChip } from "./composer-send-from-chip";
import { AboutThisDraft } from "./about-this-draft";
import { AiDraftReprompt } from "./ai-draft-reprompt";
import {
  AttachmentRow,
  ComposerField,
  InlineErrorBanner,
  RichTextComposerEditor,
} from "./composer-editor-surface";
import {
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  SendIcon,
  SparkleIcon,
  XIcon,
} from "./icons";
import type { AttachmentDraft, InlineComposerError } from "./composer-shared";
import type { InboxComposerAliasOption } from "../_lib/view-models";
import type {
  AiDraftState,
  AiDraftStatus,
  ComposerValidationError,
} from "./inbox-client-provider";

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
  isReplying,
  recipientError,
  subject,
  subjectError,
  body,
  bodyError,
  attachments,
  attachmentError,
  aiDraft,
  repromptText,
  isGeneratingAi,
  aiButtonLabel,
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
  onSubjectChange,
  onBodyChange,
  onClearErrors,
  onAiEdited,
  onDiscardAi,
  onRegenerateAi,
  onRunAiDraft,
  onRepromptTextChange,
  onReprompt,
  onSuggestion,
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
  readonly isReplying: boolean;
  readonly recipientError?: ComposerValidationError;
  readonly subject: string;
  readonly subjectError?: ComposerValidationError;
  readonly body: string;
  readonly bodyError?: ComposerValidationError;
  readonly attachments: readonly AttachmentDraft[];
  readonly attachmentError?: ComposerValidationError;
  readonly aiDraft: {
    readonly status: AiDraftStatus;
    readonly grounding: AiDraftState["grounding"];
  } & Pick<AiDraftState, "warnings" | "responseMode">;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly aiButtonLabel: string;
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
  readonly onSubjectChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onClearErrors: () => void;
  readonly onAiEdited: () => void;
  readonly onDiscardAi: () => void;
  readonly onRegenerateAi: () => void;
  readonly onRunAiDraft: () => void;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly onSuggestion: (value: string) => void;
  readonly onAttachmentClick: () => void;
  readonly onAttachmentRemove: (id: string) => void;
  readonly onKnowledgeCaptureChange: (value: boolean) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <ComposerField label="FROM">
        <ComposerSendFromChip
          value={selectedAlias}
          aliases={composerAliases}
          onChange={onAliasChange}
          {...(aliasError?.message ? { errorMessage: aliasError.message } : {})}
        />
      </ComposerField>

      <ComposerField label="TO">
        <div className="rounded-lg bg-slate-50">
          <ComposerRecipientPicker
            recipient={recipient}
            locked={isReplying}
            onRecipientChange={onRecipientChange}
          />
        </div>
        {recipientError ? (
          <p className="mt-1 text-xs text-rose-700">{recipientError.message}</p>
        ) : null}
      </ComposerField>

      <ComposerField label="CC">
        <div className="flex min-h-11 items-center justify-between rounded-lg border border-dashed border-slate-200 px-3 text-sm text-slate-400">
          <span>Not available in this production flow yet</span>
          <span className="text-xs">Placeholder</span>
        </div>
      </ComposerField>

      <ComposerField label="SUBJ">
        <Input
          value={subject}
          onChange={(event) => {
            onSubjectChange(event.currentTarget.value);
          }}
          placeholder="Subject"
          className={cn(
            "h-11 border-0 px-0 text-[15px] font-medium shadow-none focus-visible:ring-0",
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
            lifecycle={aiDraft.status}
            onDiscard={onDiscardAi}
            onRegenerate={onRegenerateAi}
            onAbout={() => {
              onAboutOpenChange(true);
            }}
          />
        }
        bottomSlot={
          <AiDraftReprompt
            aiDraft={aiDraft as AiDraftState}
            value={repromptText}
            onValueChange={onRepromptTextChange}
            onReprompt={onReprompt}
            onSuggestion={onSuggestion}
            disabled={isGeneratingAi}
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

      <div className="border-t border-slate-200 px-4 py-4">
        {inlineError || recipientError || attachmentError ? (
          <InlineErrorBanner
            message={
              inlineError?.message ??
              recipientError?.message ??
              attachmentError?.message ??
              "Something went wrong."
            }
            retryable={inlineError?.retryable === true}
            onRetry={onSend}
          />
        ) : null}

        {showKnowledgeCapture ? (
          <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
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
          <Button type="button" variant="ghost" onClick={onAttachmentClick}>
            <PaperclipIcon className="size-4" />
            Attach
          </Button>
          {selectedAliasAiReady ? (
            <Button
              type="button"
              variant="outline"
              disabled={isGeneratingAi}
              onClick={onRunAiDraft}
            >
              {isGeneratingAi ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <SparkleIcon className="size-4" />
              )}
              {aiButtonLabel}
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {selectedAliasAiReady && selectedAliasProjectName !== null ? (
              <span className={`hidden ${TYPE.caption} md:inline`}>
                Uses {selectedAliasProjectName} knowledge
              </span>
            ) : null}
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" disabled={isSendDisabled} onClick={onSend}>
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
      </div>

      <AboutThisDraft
        aiDraft={aiDraft as AiDraftState}
        open={isAboutOpen}
        onOpenChange={onAboutOpenChange}
      />
    </>
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
