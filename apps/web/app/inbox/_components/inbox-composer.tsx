"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { smsMetrics } from "@as-comms/domain/sms-segments";

import {
  FOCUS_RING,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  isComposerSendDisabled,
  resolveSmsSendAndSaveForAiAvailability,
  resolveSendAndSaveForAiAvailability,
} from "../_lib/composer-ui";
import { ComposerCollapsedPill } from "./composer-collapsed-pill";
import {
  ComposerEmailSurface,
  ComposerNoteSurface,
  ComposerSmsSurface,
} from "./composer-detail-surfaces";
import {
  autoResizeTextarea,
  resolveAiWarningMessage,
} from "./composer-shared";
import { useInboxClient } from "./inbox-client-provider";
import type { InboxSmsSenderOption } from "../_lib/view-models";
import { resolveSmsConsentAction } from "../actions";
import { ChevronDownIcon, MailIcon, PhoneIcon, XIcon } from "./icons";
import { useAiDraftRun } from "../_hooks/use-ai-draft-run";
import { useAttachmentIntake } from "../_hooks/use-attachment-intake";
import { useComposerDraftState } from "../_hooks/use-composer-draft-state";
import { useComposerSubmit } from "../_hooks/use-composer-submit";

export function InboxComposerReplyBar({
  onReply,
  onNote,
}: {
  readonly onReply: () => void;
  readonly onNote?: () => void;
}) {
  return (
    <ComposerCollapsedPill
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

  if (subject.length === 0) {
    return `New message to ${input.fallbackName}`;
  }

  return /^re:/iu.test(subject) ? subject : `Re: ${subject}`;
}

function resolveForwardTitle(subject: string | null | undefined): string {
  const normalizedSubject = subject?.trim() ?? "";

  if (normalizedSubject.length === 0) {
    return "Forward message";
  }

  return /^fwd:/iu.test(normalizedSubject)
    ? normalizedSubject
    : `Fwd: ${normalizedSubject}`;
}

function ComposerModeTabs({
  activeTab,
  onEmail,
  onSms,
}: {
  readonly activeTab: "email" | "sms";
  readonly onEmail: () => void;
  readonly onSms: () => void;
}) {
  const isSms = activeTab === "sms";

  return (
    <div>
      <div
        role="tablist"
        aria-label="Composer type"
        className="inline-flex rounded-md bg-slate-100 p-0.5 text-[12px]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "email"}
          tabIndex={0}
          className={cn(
            `inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
            activeTab === "email"
              ? "bg-violet-50 text-violet-700 shadow-sm ring-1 ring-violet-200"
              : "text-slate-400 hover:bg-slate-50 hover:text-slate-600",
          )}
          onClick={onEmail}
        >
          <MailIcon className="size-3.5" />
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isSms}
          tabIndex={0}
          className={cn(
            `inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion}`,
            isSms
              ? "bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-200"
              : "text-slate-400 hover:bg-slate-50 hover:text-slate-600",
          )}
          onClick={onSms}
        >
          <PhoneIcon className="size-3.5" />
          SMS
        </button>
      </div>
    </div>
  );
}

export function InboxComposerDetailPane({
  smsEnabled = false,
  smsSenders = [],
}: {
  readonly outboundRateUsdPerSegment: number;
  readonly smsEnabled?: boolean;
  readonly smsSenders?: readonly InboxSmsSenderOption[];
}) {
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

  useEffect(() => {
    if (state.smsSelectedSenderId !== null) {
      return;
    }

    const defaultSender = smsSenders[0];
    if (defaultSender === undefined) {
      return;
    }

    dispatch({ type: "SET_SMS_SENDER", senderId: defaultSender.id });
  }, [dispatch, smsSenders, state.smsSelectedSenderId]);

  useEffect(() => {
    if (state.smsRecipient === null || state.smsConsent !== null) {
      return;
    }

    const recipient = state.smsRecipient;

    void (async () => {
      const result = await resolveSmsConsentAction({
        recipient:
          recipient.kind === "contact"
            ? {
                kind: "contact",
                contactId: recipient.contactId,
              }
            : {
                kind: "phone",
                phoneE164: recipient.phoneE164,
              },
      });

      dispatch({
        type: "SET_SMS_RECIPIENT",
        recipient,
        consent:
          result.ok && result.data !== undefined
            ? result.data
            : { canSend: false, reason: "no_consent" },
      });
    })();
  }, [dispatch, state.smsConsent, state.smsRecipient]);

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
  const selectedAliasSignature = selectedAliasRecord?.signature ?? "";
  const smsRecipientRequiresKnownContact =
    state.activeTab === "sms" && state.smsRecipient?.kind === "phone";
  const smsAiConfigured =
    selectedAliasRecord !== null && selectedAliasAiConfigured;
  const runAiDraftDisabled =
    (state.activeTab === "sms"
      ? !smsAiConfigured || smsRecipientRequiresKnownContact
      : selectedAliasRecord === null || !selectedAliasAiConfigured) ||
    isGeneratingAi ||
    aiDraft.status === "generating" ||
    aiDraft.status === "reviewable" ||
    aiDraft.status === "reprompting";
  const runAiDraftDisabledReason =
    state.activeTab === "sms"
      ? smsRecipientRequiresKnownContact
        ? "AI drafting requires a known volunteer contact."
        : !smsAiConfigured
          ? selectedAliasRecord === null
            ? "Choose a sender alias first."
            : "AI is not configured for this project. Set it up in Settings → Integrations."
          : null
      : selectedAliasRecord === null
        ? "Choose a sender alias first."
        : !selectedAliasAiConfigured
          ? "AI is not configured for this project. Set it up in Settings → Integrations."
          : null;
  const aiWarningMessage = resolveAiWarningMessage(aiDraft);
  const sendAndSaveAvailability = resolveSendAndSaveForAiAvailability({
    selectedAlias: state.selectedAlias,
    aliases: composerAliases,
  });
  const smsSendAndSaveAvailability = resolveSmsSendAndSaveForAiAvailability({
    selectedAlias: state.selectedAlias,
    aliases: composerAliases,
    smsRecipientKind: state.smsRecipient?.kind ?? null,
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
    composerPane.mode === "forwarding"
      ? resolveForwardTitle(composerPane.forwardContext.originalSubject)
      : isReplying && replyContext !== null
        ? resolveReplyTitle({
            subject: replyContext.subject,
            fallbackName: replyContext.contactDisplayName,
          })
        : null;
  const modalDescription =
    composerPane.mode === "forwarding"
      ? "Pick a contact or type an email"
      : null;
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
  const { submit, submitSms, saveNote, cancel } = useComposerSubmit({
    state,
    dispatch,
    draftKey,
    composerAliases,
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
  const senderError = composerErrors.find((error) => error.field === "sender");
  const selectedSmsSender =
    smsSenders.find((sender) => sender.id === state.smsSelectedSenderId) ??
    smsSenders[0] ??
    null;
  const smsMetricsValue = smsMetrics(state.smsBody);
  const smsSendDisabledReason =
    state.smsRecipient === null
      ? "Choose a phone recipient first."
      : state.smsConsent === null
        ? "Checking SMS consent..."
      : state.smsBody.trim().length === 0
        ? "Write an SMS before sending."
        : !state.smsConsent.canSend
          ? state.smsConsent.reason === "revoked"
            ? "SMS consent was revoked for this recipient."
            : "SMS requires prior inbound or recorded opt-in."
          : selectedSmsSender === null
            ? "No active SMS sender is configured."
            : smsMetricsValue.length > 320
              ? "SMS messages are limited to 320 encoded characters."
              : null;

  if (state.activeTab === "note") {
    if (composerView !== "modal") {
      return null;
    }

    return (
      <ComposerNoteSurface
        contactDisplayName={replyContext?.contactDisplayName ?? "this contact"}
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
        onMinimize={minimizeComposer}
        onClose={closeComposer}
        {...(bodyError ? { bodyError } : {})}
      />
    );
  }

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
          `flex h-[656px] max-h-[84vh] w-[calc(100vw-2rem)] max-w-[1144px] flex-col gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-2xl ring-1 ring-slate-900/5 data-[state=closed]:!animate-none data-[state=open]:!animate-none sm:rounded-xl [&>button:last-child]:hidden`,
        )}
        style={{ transform: "translate(-50%, -50%)" }}
      >
        <DialogTitle className="sr-only">
          {modalTitle ?? "Message composer"}
        </DialogTitle>
        {modalDescription === null ? null : (
          <DialogDescription className="sr-only">
            {modalDescription}
          </DialogDescription>
        )}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          {composerPane.mode === "forwarding" ? (
            <div className="text-sm font-medium text-slate-600">Forward</div>
          ) : (
            <ComposerModeTabs
              activeTab={state.activeTab}
              onEmail={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "email" });
              }}
              onSms={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "sms" });
              }}
            />
          )}
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
              recipientAutoFocus={composerPane.mode === "forwarding"}
              showAiDraftAffordances={composerPane.mode !== "forwarding"}
              recipientPlaceholder={
                composerPane.mode === "forwarding"
                  ? "Pick a contact or type an email"
                  : "Search contacts"
              }
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
              selectedAliasSignature={selectedAliasSignature}
              aiWarningMessage={aiWarningMessage}
              inlineError={state.inlineError}
              canSendAndSaveForAi={sendAndSaveAvailability.enabled}
              sendAndSaveDisabledReason={
                sendAndSaveAvailability.disabledReason
              }
              isSendDisabled={isSendDisabled}
              isSending={isSending}
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
            <ComposerSmsSurface
              smsSenders={smsSenders}
              smsEnabled={smsEnabled}
              selectedSenderId={state.smsSelectedSenderId}
              recipient={state.smsRecipient}
              lockedRecipient={
                isReplying && replyContext?.contactPrimaryPhone !== null
              }
              body={state.smsBody}
              segmentMetrics={smsMetricsValue}
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
              canSendAndSaveForAi={smsSendAndSaveAvailability.enabled}
              sendAndSaveDisabledReason={
                smsSendAndSaveAvailability.disabledReason
              }
              sendDisabledReason={smsSendDisabledReason}
              inlineError={state.inlineError}
              isSending={isSending}
              onRecipientChange={(nextRecipient) => {
                if (nextRecipient === null) {
                  dispatch({
                    type: "SET_SMS_RECIPIENT",
                    recipient: null,
                    consent: { canSend: true, reason: null },
                  });
                  return;
                }

                void (async () => {
                  const result = await resolveSmsConsentAction({
                    recipient:
                      nextRecipient.kind === "contact"
                        ? {
                            kind: "contact",
                            contactId: nextRecipient.contactId,
                          }
                        : {
                            kind: "phone",
                            phoneE164: nextRecipient.phoneE164,
                          },
                  });

                  dispatch({
                    type: "SET_SMS_RECIPIENT",
                    recipient: nextRecipient,
                    consent:
                      result.ok && result.data !== undefined
                        ? result.data
                        : { canSend: false, reason: "no_consent" },
                  });
                })();
              }}
              onBodyChange={(value) => {
                dispatch({ type: "SET_SMS_BODY", body: value });
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
              onSend={submitSms}
              onCancel={cancel}
              {...(recipientError ? { recipientError } : {})}
              {...(senderError ? { senderError } : {})}
              {...(bodyError ? { bodyError } : {})}
            />
          )}

          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={handleFilesSelected}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
