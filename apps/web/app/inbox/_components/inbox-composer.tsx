"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";

import { RADIUS, SHADOW } from "@/app/_lib/design-tokens-v2";
import {
  getInternalNoteValidationError,
  normalizeInternalNoteBody,
} from "@/src/lib/internal-note-validation";

import {
  createNoteAction,
  draftWithAiAction,
  sendComposerAction,
  type ComposerSendActionInput,
} from "../actions";
import { resolveAiButtonState } from "../_lib/composer-ai";
import {
  isComposerSendDisabled,
  resolveDefaultAlias,
} from "../_lib/composer-ui";
import {
  clearDraft,
  loadDraft,
  saveDraft,
} from "../_lib/composer-draft-storage";
import { plaintextToComposerHtml } from "./composer-html";
import { ComposerCollapsedPill } from "./composer-collapsed-pill";
import {
  ComposerEmailSurface,
  ComposerNoteSurface,
  ComposerPaneChrome,
} from "./composer-detail-surfaces";
import {
  type ComposerContactRecipient,
  type ComposerRecipientValue,
} from "./composer-recipient-picker";
import {
  autoResizeTextarea,
  mapFieldErrors,
  readFileAsAttachment,
  resolveAiWarningMessage,
  resolveComposerDraftKey,
  resolveRecipientLabel,
  type AttachmentDraft,
  type InlineComposerError,
} from "./composer-shared";
import {
  useInboxClient,
} from "./inbox-client-provider";
import {
} from "./icons";

const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

export function InboxComposerDetailPane() {
  const router = useRouter();
  const {
    currentActorId,
    composerAliases,
    composerPane,
    aiDraft,
    closeComposer,
    showToast,
    composerErrors,
    setComposerErrors,
    setComposerStatus,
    startAiGeneration,
    insertAiDraft,
    markAiDraftEdited,
    restoreAiDraft,
    discardAiDraft,
    repromptAi,
    resetAiDraft,
    setAiError,
  } = useInboxClient();
  const [activeTab, setActiveTab] = useState<"email" | "note">("email");
  const [recipient, setRecipient] = useState<ComposerRecipientValue | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attachments, setAttachments] = useState<readonly AttachmentDraft[]>([]);
  const [captureAsKnowledge, setCaptureAsKnowledge] = useState(false);
  const [repromptText, setRepromptText] = useState("");
  const [inlineError, setInlineError] = useState<InlineComposerError | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSending, startSendTransition] = useTransition();
  const [isSavingNote, startSaveNoteTransition] = useTransition();
  const [isGeneratingAi, startAiTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const hydratedDraftKeyRef = useRef<string | null>(null);

  const replyContext =
    composerPane.mode === "replying" ? composerPane.replyContext : null;
  const isReplying = composerPane.mode === "replying";
  const canUseNoteTab = isReplying && replyContext !== null;

  useEffect(() => {
    if (composerPane.mode === "closed") {
      hydratedDraftKeyRef.current = null;
      return;
    }

    const replyRecipient: ComposerContactRecipient | null =
      replyContext === null
        ? null
        : {
            kind: "contact",
            contactId: replyContext.contactId,
            displayName: replyContext.contactDisplayName,
            primaryEmail: null,
            primaryProjectName: null,
            salesforceContactId: null,
          };

    setActiveTab(
      composerPane.mode === "replying" && composerPane.initialTab === "note"
        ? "note"
        : "email",
    );
    setRecipient(replyRecipient);
    setSelectedAlias(replyContext?.defaultAlias ?? null);
    setSubject(replyContext?.subject ?? "");
    setBody("");
    setBodyHtml("");
    setAttachments([]);
    setCaptureAsKnowledge(false);
    setRepromptText("");
    setInlineError(null);
    setIsAboutOpen(false);
    setComposerStatus("idle");
    setComposerErrors([]);
    resetAiDraft();
  }, [
    composerPane,
    replyContext,
    resetAiDraft,
    setComposerErrors,
    setComposerStatus,
  ]);

  const baselineSubject = replyContext?.subject ?? "";
  const baselineAlias = isReplying
    ? replyContext?.defaultAlias ?? null
    : resolveDefaultAlias({
        recipient,
        aliases: composerAliases,
      });
  const draftKey = resolveComposerDraftKey({
    actorId: currentActorId,
    recipient,
  });

  useEffect(() => {
    if (
      composerPane.mode === "closed" ||
      activeTab !== "email" ||
      draftKey === null ||
      hydratedDraftKeyRef.current === draftKey
    ) {
      return;
    }

    const isUntouchedComposer =
      subject.trim() === baselineSubject.trim() &&
      body.trim().length === 0 &&
      bodyHtml.trim().length === 0 &&
      attachments.length === 0 &&
      selectedAlias === baselineAlias;

    if (!isUntouchedComposer) {
      hydratedDraftKeyRef.current = draftKey;
      return;
    }

    const draft = loadDraft(draftKey);
    hydratedDraftKeyRef.current = draftKey;

    if (draft === null) {
      return;
    }

    setSubject(draft.subject);
    setBody(draft.bodyPlaintext);
    setBodyHtml(draft.bodyHtml);
    setSelectedAlias(draft.selectedAlias);
    setAttachments(
      draft.attachments.map((attachment, index) => ({
        id: `draft:${attachment.filename}:${String(attachment.size)}:${String(index)}`,
        filename: attachment.filename,
        size: attachment.size,
        contentType: attachment.contentType,
        contentBase64: null,
      })),
    );
  }, [
    activeTab,
    attachments.length,
    baselineAlias,
    baselineSubject,
    body,
    bodyHtml,
    composerPane.mode,
    draftKey,
    selectedAlias,
    subject,
  ]);

  useEffect(() => {
    if (
      composerPane.mode === "closed" ||
      activeTab !== "email" ||
      draftKey === null
    ) {
      return;
    }

    const hasPersistableContent =
      subject.trim() !== baselineSubject.trim() ||
      body.trim().length > 0 ||
      bodyHtml.trim().length > 0 ||
      selectedAlias !== baselineAlias ||
      attachments.length > 0;

    const timeoutId = window.setTimeout(() => {
      if (!hasPersistableContent) {
        clearDraft(draftKey);
        return;
      }

      saveDraft(draftKey, {
        subject,
        bodyPlaintext: body,
        bodyHtml,
        selectedAlias,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          size: attachment.size,
          contentType: attachment.contentType,
        })),
      });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeTab,
    attachments,
    baselineAlias,
    baselineSubject,
    body,
    bodyHtml,
    composerPane.mode,
    draftKey,
    selectedAlias,
    subject,
  ]);

  useEffect(() => {
    if (activeTab !== "note" || !bodyRef.current) {
      return;
    }

    autoResizeTextarea(bodyRef.current);
  }, [activeTab, body]);

  if (composerPane.mode === "closed") {
    return null;
  }

  const attachmentBytes = attachments.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );
  const selectedAliasRecord =
    selectedAlias === null
      ? null
      : composerAliases.find((alias) => alias.alias === selectedAlias) ?? null;
  const aiButton = resolveAiButtonState({
    body,
    isGenerating: isGeneratingAi,
  });
  const aiWarningMessage = resolveAiWarningMessage(aiDraft);
  const showKnowledgeCapture =
    activeTab === "email" && selectedAliasRecord?.isAiReady === true;
  const isSendDisabled = isComposerSendDisabled({
    activeTab,
    recipient,
    selectedAlias,
    subject,
    body,
    isSending,
  });
  const isSaveNoteDisabled =
    activeTab !== "note" ||
    !canUseNoteTab ||
    body.trim().length === 0 ||
    isSavingNote;
  const aliasError = composerErrors.find((error) => error.field === "alias");
  const subjectError = composerErrors.find((error) => error.field === "subject");
  const bodyError = composerErrors.find((error) => error.field === "body");
  const recipientError = composerErrors.find(
    (error) => error.field === "recipient",
  );
  const attachmentError = composerErrors.find(
    (error) => error.field === "attachments",
  );

  const clearComposerErrors = () => {
    setInlineError(null);
    setComposerErrors([]);
  };

  const runAiDraft = (requestOverride?: {
    readonly mode: "reprompt";
    readonly repromptDirection: string;
  }) => {
    if (activeTab !== "email") {
      return;
    }

    clearComposerErrors();

    if (recipient?.kind !== "contact") {
      setInlineError({
        message: "AI drafting is available only when replying to a contact.",
        retryable: false,
      });
      return;
    }

    const baseRequest = {
      contactId: recipient.contactId,
      projectId: selectedAliasRecord?.projectId ?? null,
      threadCursor: replyContext?.threadCursor ?? null,
    } as const;

    const request =
      requestOverride?.mode === "reprompt"
        ? {
            ...baseRequest,
            mode: "reprompt" as const,
            previousDraft: body.trim(),
            repromptDirection: requestOverride.repromptDirection,
            repromptIndex: aiDraft.repromptChain.length + 1,
          }
        : aiButton.mode === "draft"
          ? {
              ...baseRequest,
              mode: "draft" as const,
            }
          : {
              ...baseRequest,
              mode: "fill" as const,
              operatorPrompt: body.trim(),
            };

    const prompt =
      request.mode === "reprompt"
        ? request.repromptDirection
        : request.mode === "draft"
          ? "Draft with AI"
          : request.operatorPrompt;

    if (request.mode === "reprompt") {
      repromptAi({ request, prompt });
    } else {
      startAiGeneration({ request, prompt });
    }

    startAiTransition(async () => {
      const result = await draftWithAiAction(request);

      if (!result.ok) {
        setAiError(result.message);
        setInlineError({
          message: result.message,
          retryable: false,
        });
        return;
      }

      clearComposerErrors();
      setInlineError(null);
      setBody(result.data.draft);
      setBodyHtml(plaintextToComposerHtml(result.data.draft));
      setRepromptText("");
      insertAiDraft({
        request,
        response: result.data,
        prompt,
        ...(request.mode === "reprompt"
          ? {
              repromptDirection: request.repromptDirection,
            }
          : {}),
      });
    });
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    event.currentTarget.value = "";

    if (files === null || files.length === 0) {
      return;
    }

    const selectedFiles = Array.from(files);
    const nextTotalBytes =
      attachmentBytes +
      selectedFiles.reduce((total, file) => total + file.size, 0);

    if (nextTotalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      setInlineError({
        message: "Attachments can't exceed 20 MB total.",
        retryable: false,
      });
      setComposerErrors([
        {
          field: "attachments",
          message: "Attachments can't exceed 20 MB total.",
        },
      ]);
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map((file) => readFileAsAttachment(file)),
      );
      setAttachments((previous) => [...previous, ...nextAttachments]);
      clearComposerErrors();
    } catch {
      setInlineError({
        message: "We couldn't read one of those files. Please try again.",
        retryable: true,
      });
    }
  };

  const handleDiscardAi = () => {
    if (aiDraft.status === "edited-after-generation") {
      setBody(aiDraft.generatedText);
      setBodyHtml(plaintextToComposerHtml(aiDraft.generatedText));
      restoreAiDraft();
      setRepromptText("");
      return;
    }

    discardAiDraft();
  };

  const handleRegenerateAi = () => {
    runAiDraft({
      mode: "reprompt",
      repromptDirection: repromptText.trim() || "Regenerate this draft",
    });
  };

  const submit = () => {
    if (recipient === null || selectedAlias === null || activeTab !== "email") {
      return;
    }

    if (attachments.some((attachment) => attachment.contentBase64 === null)) {
      setInlineError({
        message: "Please reattach files added before refresh before sending.",
        retryable: false,
      });
      setComposerErrors([
        {
          field: "attachments",
          message: "Please reattach files added before refresh before sending.",
        },
      ]);
      return;
    }

    const payload: ComposerSendActionInput = {
      recipient:
        recipient.kind === "contact"
          ? { kind: "contact", contactId: recipient.contactId }
          : { kind: "email", emailAddress: recipient.emailAddress },
      alias: selectedAlias,
      subject: subject.trim(),
      bodyPlaintext: body.trim(),
      bodyHtml,
      attachments: attachments.flatMap((attachment) =>
        attachment.contentBase64 === null
          ? []
          : [
              {
                filename: attachment.filename,
                contentType: attachment.contentType,
                contentBase64: attachment.contentBase64,
              },
            ],
      ),
      captureAsKnowledge,
      ...(replyContext?.threadId ? { threadId: replyContext.threadId } : {}),
      ...(replyContext?.inReplyToRfc822
        ? { inReplyToRfc822: replyContext.inReplyToRfc822 }
        : {}),
    };

    setInlineError(null);
    setComposerErrors([]);
    setComposerStatus("sending");

    startSendTransition(async () => {
      const result = await sendComposerAction(payload);

      if (result.ok) {
        if (draftKey !== null) {
          clearDraft(draftKey);
        }
        setComposerStatus("sent-success");
        showToast(`Sent to ${resolveRecipientLabel(recipient)}`, "success");
        closeComposer();
        return;
      }

      setComposerErrors(mapFieldErrors(result));
      setComposerStatus(
        result.code === "validation_error"
          ? "validation-error"
          : "send-failure",
      );
      setInlineError({
        message: result.message,
        retryable: result.retryable === true,
      });
    });
  };

  const saveNote = () => {
    if (!isReplying || replyContext === null) {
      return;
    }

    const normalizedBody = normalizeInternalNoteBody(body);
    const validationError = getInternalNoteValidationError(normalizedBody);

    if (validationError !== null) {
      setInlineError({
        message: validationError,
        retryable: false,
      });
      setComposerErrors([{ field: "body", message: validationError }]);
      return;
    }

    setInlineError(null);
    setComposerErrors([]);
    setComposerStatus("saving-draft");

    startSaveNoteTransition(async () => {
      const result = await createNoteAction({
        contactId: replyContext.contactId,
        body: normalizedBody,
      });

      if (result.ok) {
        setComposerStatus("draft-saved");
        setBody("");
        setBodyHtml("");
        closeComposer();
        router.refresh();
        showToast("Note saved.", "success");
        return;
      }

      setComposerErrors(mapFieldErrors(result));
      setComposerStatus("validation-error");
      setInlineError({
        message: result.message,
        retryable: result.retryable === true,
      });
    });
  };

  const handleCancel = () => {
    if (draftKey !== null) {
      clearDraft(draftKey);
    }

    closeComposer();
  };

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5">
          <div className={`mx-auto w-full max-w-4xl overflow-hidden border border-slate-200 bg-white ${RADIUS.lg} ${SHADOW.sm}`}>
            <ComposerPaneChrome
              title={
                isReplying && recipient?.kind === "contact"
                  ? `Reply to ${recipient.displayName}`
                  : "New message"
              }
              description={
                activeTab === "note"
                  ? "Internal note for the team timeline."
                  : "Production send, autosave, attachments, and AI draft flow preserved."
              }
              activeTab={activeTab}
              canUseNoteTab={canUseNoteTab}
              onEmail={() => {
                setActiveTab("email");
                clearComposerErrors();
              }}
              onNote={() => {
                setActiveTab("note");
                clearComposerErrors();
              }}
              onClose={closeComposer}
            />

            {activeTab === "email" ? (
              <ComposerEmailSurface
                composerAliases={composerAliases}
                selectedAlias={selectedAlias}
                recipient={recipient}
                isReplying={isReplying}
                subject={subject}
                body={body}
                attachments={attachments}
                aiDraft={aiDraft}
                repromptText={repromptText}
                isGeneratingAi={isGeneratingAi}
                aiButtonLabel={aiButton.label}
                selectedAliasAiReady={selectedAliasRecord?.isAiReady === true}
                aiWarningMessage={aiWarningMessage}
                inlineError={inlineError}
                showKnowledgeCapture={showKnowledgeCapture}
                captureAsKnowledge={captureAsKnowledge}
                isSendDisabled={isSendDisabled}
                isSending={isSending}
                isAboutOpen={isAboutOpen}
                onAboutOpenChange={setIsAboutOpen}
                onAliasChange={(nextAlias) => {
                  setSelectedAlias(nextAlias);
                  clearComposerErrors();
                }}
                onRecipientChange={(nextRecipient) => {
                  setRecipient(nextRecipient);
                  clearComposerErrors();
                  if (!isReplying) {
                    setSelectedAlias(
                      resolveDefaultAlias({
                        recipient: nextRecipient,
                        aliases: composerAliases,
                      }),
                    );
                  }
                }}
                onSubjectChange={(value) => {
                  setSubject(value);
                  clearComposerErrors();
                }}
                onBodyChange={(nextBody) => {
                  setBody(nextBody.bodyPlaintext);
                  setBodyHtml(nextBody.bodyHtml);
                }}
                onClearErrors={clearComposerErrors}
                onAiEdited={markAiDraftEdited}
                onDiscardAi={handleDiscardAi}
                onRegenerateAi={handleRegenerateAi}
                onRunAiDraft={() => {
                  runAiDraft();
                }}
                onRepromptTextChange={setRepromptText}
                onReprompt={handleRegenerateAi}
                onSuggestion={(value) => {
                  setRepromptText(value);
                  runAiDraft({
                    mode: "reprompt",
                    repromptDirection: value,
                  });
                }}
                onAttachmentClick={() => {
                  attachmentInputRef.current?.click();
                }}
                onAttachmentRemove={(id) => {
                  clearComposerErrors();
                  setAttachments((previous) =>
                    previous.filter((attachment) => attachment.id !== id),
                  );
                }}
                onKnowledgeCaptureChange={setCaptureAsKnowledge}
                onSend={submit}
                onCancel={handleCancel}
                {...(aliasError ? { aliasError } : {})}
                {...(recipientError ? { recipientError } : {})}
                {...(subjectError ? { subjectError } : {})}
                {...(bodyError ? { bodyError } : {})}
                {...(attachmentError ? { attachmentError } : {})}
              />
            ) : (
              <ComposerNoteSurface
                body={body}
                isSavingNote={isSavingNote}
                isSaveNoteDisabled={isSaveNoteDisabled}
                inlineError={inlineError}
                textareaRef={bodyRef}
                onBodyChange={(value) => {
                  setBody(value);
                  clearComposerErrors();
                }}
                onTextareaInput={autoResizeTextarea}
                onSaveNote={saveNote}
                onCancel={handleCancel}
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
        </div>
      </section>
    </>
  );
}
