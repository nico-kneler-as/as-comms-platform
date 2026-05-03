"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import {
  FOCUS_RING,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  isComposerSendDisabled,
  resolveSendAndSaveForAiAvailability,
} from "../_lib/composer-ui";
import { ComposerCollapsedPill } from "./composer-collapsed-pill";
import {
  ComposerEmailSurface,
  ComposerNoteSurface,
} from "./composer-detail-surfaces";
import {
  autoResizeTextarea,
  resolveAiWarningMessage,
} from "./composer-shared";
import { useInboxClient } from "./inbox-client-provider";
import { ChevronDownIcon, MailIcon, NoteIcon, XIcon } from "./icons";
import { useAiDraftRun } from "../_hooks/use-ai-draft-run";
import { useAttachmentIntake } from "../_hooks/use-attachment-intake";
import { useComposerDraftState } from "../_hooks/use-composer-draft-state";
import { useComposerSubmit } from "../_hooks/use-composer-submit";

export function InboxComposerReplyBar({
  contactDisplayName,
  onReply,
  onNote,
}: {
  readonly contactDisplayName: string;
  readonly onReply: () => void;
  readonly onNote?: () => void;
}) {
  return (
    <ComposerCollapsedPill
      personName={contactDisplayName}
      onExpand={onReply}
      onNote={onNote ?? onReply}
    />
  );
}

function resolveReplyTitle(input: {
  readonly subject: string | null | undefined;
  readonly fallbackName: string;
}): string {
  const subject = input.subject?.trim() ?? "";
  const base = subject.length > 0 ? subject : input.fallbackName;

  return /^re:/iu.test(base) ? base : `Re: ${base}`;
}

function ComposerModeTabs({
  activeTab,
}: {
  readonly activeTab: "email" | "note";
}) {
  const isNote = activeTab === "note";

  return (
    <div className="border-b border-slate-200 px-4 py-2.5">
      <div
        role="tablist"
        aria-label="Composer type"
        className="inline-flex rounded-md bg-slate-100 p-0.5 text-[12px]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!isNote}
          tabIndex={-1}
          className={cn(
            `inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
            !isNote
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500",
          )}
        >
          <MailIcon className="size-3.5" />
          Email
        </button>
        {isNote ? (
          <button
            type="button"
            role="tab"
            aria-selected="true"
            tabIndex={-1}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium bg-white text-amber-700 shadow-sm ring-1 ring-amber-200 ${FOCUS_RING}`}
          >
            <NoteIcon className="size-3.5" />
            Note
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function InboxComposerDetailPane() {
  const router = useRouter();
  const {
    currentActorId,
    operatorDisplayName,
    composerAliases,
    composerPane,
    composerView,
    aiDraft,
    closeComposer,
    minimizeComposer,
    showToast,
    composerErrors,
    setComposerErrors,
    setComposerStatus,
    startAiGeneration,
    markAiDraftReviewable,
    approveAiDraft,
    markAiDraftEdited,
    discardAiDraft,
    markAiDraftReprompting,
    repromptAi,
    cancelReprompt,
    resetAiDraft,
    setAiError,
    addOptimisticOutbound,
    markOptimisticSettled,
    markOptimisticFailed,
  } = useInboxClient();
  const [isSending, startSendTransition] = useTransition();
  const [isSavingNote, startSaveNoteTransition] = useTransition();
  const [isGeneratingAi, startAiTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const {
    state,
    dispatch,
    draftKey,
    isReplying,
    replyContext,
  } = useComposerDraftState({
    actorId: currentActorId,
    composerPane,
    composerAliases,
    setComposerStatus,
    setComposerErrors,
    resetAiDraft,
  });
  const canUseNoteTab = isReplying && replyContext !== null;

  useEffect(() => {
    if (state.activeTab !== "note" || !bodyRef.current) {
      return;
    }

    autoResizeTextarea(bodyRef.current);
  }, [state.activeTab, state.body]);

  if (composerPane.mode === "closed") {
    return null;
  }

  const attachmentBytes = state.attachments.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );
  const selectedAliasRecord =
    state.selectedAlias === null
      ? null
      : (composerAliases.find((alias) => alias.alias === state.selectedAlias) ??
        null);
  const selectedAliasAiConfigured =
    selectedAliasRecord?.isAiConfigured ?? selectedAliasRecord?.isAiReady ?? false;
  const runAiDraftDisabled =
    selectedAliasRecord === null ||
    !selectedAliasAiConfigured ||
    isGeneratingAi ||
    aiDraft.status === "generating" ||
    aiDraft.status === "reviewable" ||
    aiDraft.status === "reprompting";
  const runAiDraftDisabledReason =
    selectedAliasRecord === null
      ? "Choose a sender alias first."
      : !selectedAliasAiConfigured
        ? "AI is not configured for this project. Set it up in Settings → Integrations."
        : null;
  const aiWarningMessage = resolveAiWarningMessage(aiDraft);
  const sendAndSaveAvailability = resolveSendAndSaveForAiAvailability({
    selectedAlias: state.selectedAlias,
    aliases: composerAliases,
  });
  const isSendDisabled = isComposerSendDisabled({
    activeTab: state.activeTab,
    recipient: state.recipient,
    selectedAlias: state.selectedAlias,
    subject: state.subject,
    body: state.body,
    isSending,
  });
  const isSaveNoteDisabled =
    state.activeTab !== "note" ||
    !canUseNoteTab ||
    state.body.trim().length === 0 ||
    isSavingNote;
  const aliasError = composerErrors.find((error) => error.field === "alias");
  const subjectError = composerErrors.find((error) => error.field === "subject");
  const bodyError = composerErrors.find((error) => error.field === "body");
  const recipientError = composerErrors.find(
    (error) => error.field === "recipient",
  );
  const ccError = composerErrors.find((error) => error.field === "cc");
  const bccError = composerErrors.find((error) => error.field === "bcc");
  const attachmentError = composerErrors.find(
    (error) => error.field === "attachments",
  );
  const modalTitle =
    state.activeTab === "note"
      ? "Note"
      : isReplying && replyContext !== null
        ? resolveReplyTitle({
            subject: replyContext.subject,
            fallbackName: replyContext.contactDisplayName,
          })
        : "New message";
  const handleFilesSelected = useAttachmentIntake({
    attachmentBytes,
    dispatch,
    setComposerErrors,
  });
  const {
    runAiDraft,
    discardAi,
    regenerateAi,
    openReprompt,
    cancelAiReprompt,
    approveAi,
  } = useAiDraftRun({
    state,
    dispatch,
    aiDraft,
    selectedAliasRecord,
    selectedAliasAiConfigured,
    replyContext,
    startAiGeneration,
    markAiDraftReviewable,
    approveAiDraft,
    discardAiDraft,
    markAiDraftReprompting,
    repromptAi,
    cancelReprompt,
    setAiError,
    setComposerErrors,
    startAiTransition,
  });
  const { submit, saveNote, cancel } = useComposerSubmit({
    state,
    dispatch,
    draftKey,
    isReplying,
    replyContext,
    operatorDisplayName,
    router,
    closeComposer,
    showToast,
    setComposerErrors,
    setComposerStatus,
    addOptimisticOutbound,
    markOptimisticSettled,
    markOptimisticFailed,
    startSendTransition,
    startSaveNoteTransition,
  });

  return (
    <Dialog
      open={composerView === "modal"}
      onOpenChange={(open) => {
        if (!open) {
          minimizeComposer();
        }
      }}
    >
      <DialogContent
        className={cn(
          `flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-[820px] flex-col gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-2xl ring-1 ring-slate-900/5 sm:rounded-xl [&>button:last-child]:hidden`,
        )}
      >
        <DialogTitle className="sr-only">{modalTitle}</DialogTitle>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white"
            >
              {state.activeTab === "note" ? (
                <NoteIcon className="size-3.5" />
              ) : (
                <MailIcon className="size-3.5" />
              )}
            </span>
            <h2 className={`truncate ${TYPE.headingMd}`}>{modalTitle}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Minimize composer"
              className={cn(
                `inline-flex size-8 items-center justify-center rounded-md text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-100 hover:text-slate-700`,
              )}
              onClick={minimizeComposer}
            >
              <ChevronDownIcon className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Close composer"
              className={cn(
                `inline-flex size-8 items-center justify-center rounded-md text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-100 hover:text-slate-700`,
              )}
              onClick={closeComposer}
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          <ComposerModeTabs activeTab={state.activeTab} />

          {state.activeTab === "email" ? (
            <ComposerEmailSurface
              composerAliases={composerAliases}
              selectedAlias={state.selectedAlias}
              recipient={state.recipient}
              ccRecipients={state.cc}
              bccRecipients={state.bcc}
              showCc={state.showCc}
              showBcc={state.showBcc}
              isReplying={isReplying}
              subject={state.subject}
              body={state.body}
              attachments={state.attachments}
              aiDraft={aiDraft}
              aiDirective={state.aiDirective}
              repromptText={state.repromptText}
              isGeneratingAi={isGeneratingAi}
              runAiDraftDisabled={runAiDraftDisabled}
              runAiDraftDisabledReason={runAiDraftDisabledReason}
              selectedAliasHasCachedContent={
                selectedAliasRecord?.hasCachedContent === true
              }
              selectedAliasProjectName={
                selectedAliasRecord?.projectName ?? null
              }
              aiWarningMessage={aiWarningMessage}
              inlineError={state.inlineError}
              canSendAndSaveForAi={sendAndSaveAvailability.enabled}
              sendAndSaveDisabledReason={
                sendAndSaveAvailability.disabledReason
              }
              isSendDisabled={isSendDisabled}
              isSending={isSending}
              isAboutOpen={state.isAboutOpen}
              onAboutOpenChange={(open) => {
                dispatch({ type: "SET_ABOUT_OPEN", open });
              }}
              onAliasChange={(nextAlias) => {
                dispatch({ type: "SET_ALIAS", alias: nextAlias });
              }}
              onRecipientChange={(nextRecipient) => {
                dispatch({
                  type: "SET_RECIPIENT",
                  recipient: nextRecipient,
                  isReplying,
                  aliases: composerAliases,
                });
              }}
              onCcChange={(nextRecipients) => {
                dispatch({ type: "SET_CC", recipients: nextRecipients });
              }}
              onBccChange={(nextRecipients) => {
                dispatch({ type: "SET_BCC", recipients: nextRecipients });
              }}
              onToggleCc={(open) => {
                dispatch({ type: "TOGGLE_CC", open });
              }}
              onToggleBcc={(open) => {
                dispatch({ type: "TOGGLE_BCC", open });
              }}
              onSubjectChange={(value) => {
                dispatch({ type: "SET_SUBJECT", subject: value });
              }}
              onBodyChange={(nextBody) => {
                dispatch({
                  type: "SET_BODY",
                  body: nextBody.bodyPlaintext,
                  bodyHtml: nextBody.bodyHtml,
                });
              }}
              onClearErrors={() => {
                dispatch({ type: "CLEAR_ERRORS" });
                setComposerErrors([]);
              }}
              onAiDirectiveChange={(value) => {
                dispatch({ type: "SET_AI_DIRECTIVE", value });
              }}
              onAiEdited={markAiDraftEdited}
              onDiscardAi={discardAi}
              onOpenReprompt={openReprompt}
              onCancelReprompt={cancelAiReprompt}
              onApproveAi={approveAi}
              onRunAiDraft={() => {
                runAiDraft();
              }}
              onRepromptTextChange={(value) => {
                dispatch({ type: "SET_REPROMPT_TEXT", value });
              }}
              onReprompt={regenerateAi}
              onAttachmentClick={() => {
                attachmentInputRef.current?.click();
              }}
              onAttachmentRemove={(id) => {
                dispatch({ type: "REMOVE_ATTACHMENT", id });
              }}
              onSaveDraft={minimizeComposer}
              onSend={submit}
              onCancel={cancel}
              {...(aliasError ? { aliasError } : {})}
              {...(recipientError ? { recipientError } : {})}
              {...(ccError ? { ccError } : {})}
              {...(bccError ? { bccError } : {})}
              {...(subjectError ? { subjectError } : {})}
              {...(bodyError ? { bodyError } : {})}
              {...(attachmentError ? { attachmentError } : {})}
            />
          ) : (
            <ComposerNoteSurface
              body={state.body}
              isSavingNote={isSavingNote}
              isSaveNoteDisabled={isSaveNoteDisabled}
              inlineError={state.inlineError}
              textareaRef={bodyRef}
              onBodyChange={(value) => {
                dispatch({ type: "SET_BODY", body: value, bodyHtml: "" });
                dispatch({ type: "CLEAR_ERRORS" });
                setComposerErrors([]);
              }}
              onTextareaInput={autoResizeTextarea}
              onSaveNote={saveNote}
              onCancel={cancel}
              {...(bodyError ? { bodyError } : {})}
            />
          )}

          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
