"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";

import {
  FOCUS_RING,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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
  resolveRecipientEmailAddress,
  resolveRecipientLabel,
  type AttachmentDraft,
  type InlineComposerError,
} from "./composer-shared";
import { useInboxClient } from "./inbox-client-provider";
import { ChevronDownIcon, MailIcon, NoteIcon, XIcon } from "./icons";

const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function toEmailRecipients(
  emails: readonly string[] | undefined,
): readonly ComposerRecipientValue[] {
  return (emails ?? []).map((emailAddress) => ({
    kind: "email",
    emailAddress,
  }));
}

function resolveSupplementaryRecipientEmails(input: {
  readonly recipients: readonly ComposerRecipientValue[];
}):
  | {
      readonly ok: true;
      readonly emails: readonly string[];
    }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  const emails: string[] = [];

  for (const recipient of input.recipients) {
    const email = resolveRecipientEmailAddress(recipient);

    if (email === null) {
      return {
        ok: false,
        message: "Every selected recipient needs a valid email address.",
      };
    }

    emails.push(email);
  }

  return {
    ok: true,
    emails,
  };
}

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
  } = useInboxClient();
  const [activeTab, setActiveTab] = useState<"email" | "note">("email");
  const [recipient, setRecipient] = useState<ComposerRecipientValue | null>(
    null,
  );
  const [ccRecipients, setCcRecipients] = useState<
    readonly ComposerRecipientValue[]
  >([]);
  const [bccRecipients, setBccRecipients] = useState<
    readonly ComposerRecipientValue[]
  >([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attachments, setAttachments] = useState<readonly AttachmentDraft[]>(
    [],
  );
  const [captureAsKnowledge, setCaptureAsKnowledge] = useState(false);
  const [aiDirective, setAiDirective] = useState("");
  const [repromptText, setRepromptText] = useState("");
  const [inlineError, setInlineError] = useState<InlineComposerError | null>(
    null,
  );
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
    setCcRecipients(
      toEmailRecipients(replyContext?.cc).filter((candidate) => {
        if (candidate.kind !== "email") {
          return true;
        }

        return candidate.emailAddress !== replyContext?.defaultAlias;
      }),
    );
    setBccRecipients([]);
    setShowCc((replyContext?.cc?.length ?? 0) > 0);
    setShowBcc(false);
    setSelectedAlias(replyContext?.defaultAlias ?? null);
    setSubject(replyContext?.subject ?? "");
    setBody("");
    setBodyHtml("");
    setAttachments([]);
    setCaptureAsKnowledge(false);
    setAiDirective("");
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
    ? (replyContext?.defaultAlias ?? null)
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
      ccRecipients.length === 0 &&
      bccRecipients.length === 0 &&
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
    const draftCc = Array.isArray((draft as { readonly cc?: unknown }).cc)
      ? ((draft as { readonly cc?: readonly string[] }).cc ?? [])
      : [];
    const draftBcc = Array.isArray((draft as { readonly bcc?: unknown }).bcc)
      ? ((draft as { readonly bcc?: readonly string[] }).bcc ?? [])
      : [];
    setCcRecipients(toEmailRecipients(draftCc));
    setBccRecipients(toEmailRecipients(draftBcc));
    setShowCc(draftCc.length > 0);
    setShowBcc(draftBcc.length > 0);
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
    bccRecipients.length,
    ccRecipients.length,
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
      ccRecipients.length > 0 ||
      bccRecipients.length > 0 ||
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
        cc: ccRecipients.flatMap((recipient) => {
          const email = resolveRecipientEmailAddress(recipient);
          return email === null ? [] : [email];
        }),
        bcc: bccRecipients.flatMap((recipient) => {
          const email = resolveRecipientEmailAddress(recipient);
          return email === null ? [] : [email];
        }),
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
    bccRecipients,
    ccRecipients,
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
      : (composerAliases.find((alias) => alias.alias === selectedAlias) ??
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
  const subjectError = composerErrors.find(
    (error) => error.field === "subject",
  );
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
    activeTab === "note"
      ? "Note"
      : isReplying && replyContext !== null
        ? resolveReplyTitle({
            subject: replyContext.subject,
            fallbackName: replyContext.contactDisplayName,
          })
        : "New message";

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

    if (!selectedAliasAiConfigured) {
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
            previousDraft: aiDraft.generatedText.trim(),
            repromptDirection: requestOverride.repromptDirection,
            repromptIndex: aiDraft.repromptChain.length + 1,
          }
        : aiDirective.trim().length === 0
          ? {
              ...baseRequest,
              mode: "draft" as const,
            }
          : {
              ...baseRequest,
              mode: "fill" as const,
              operatorPrompt: aiDirective.trim(),
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
      setRepromptText("");
      markAiDraftReviewable({
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
    discardAiDraft();
    setAiDirective("");
    setRepromptText("");
  };

  const handleRegenerateAi = () => {
    if (repromptText.trim().length === 0) {
      return;
    }

    runAiDraft({
      mode: "reprompt",
      repromptDirection: repromptText.trim(),
    });
  };

  const handleOpenReprompt = () => {
    setRepromptText("");
    markAiDraftReprompting();
  };

  const handleCancelReprompt = () => {
    setRepromptText("");
    cancelReprompt();
  };

  const handleApproveAi = () => {
    const approvedText = aiDraft.generatedText;
    setBody(approvedText);
    setBodyHtml(plaintextToComposerHtml(approvedText));
    setAiDirective("");
    setRepromptText("");
    approveAiDraft();
  };

  const submit = () => {
    if (recipient === null || selectedAlias === null || activeTab !== "email") {
      return;
    }

    const resolvedCc = resolveSupplementaryRecipientEmails({
      recipients: ccRecipients,
    });
    if (!resolvedCc.ok) {
      setInlineError({
        message: resolvedCc.message,
        retryable: false,
      });
      setComposerErrors([{ field: "cc", message: resolvedCc.message }]);
      return;
    }

    const resolvedBcc = resolveSupplementaryRecipientEmails({
      recipients: bccRecipients,
    });
    if (!resolvedBcc.ok) {
      setInlineError({
        message: resolvedBcc.message,
        retryable: false,
      });
      setComposerErrors([{ field: "bcc", message: resolvedBcc.message }]);
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
      ...(resolvedCc.emails.length > 0 ? { cc: [...resolvedCc.emails] } : {}),
      ...(resolvedBcc.emails.length > 0
        ? { bcc: [...resolvedBcc.emails] }
        : {}),
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
              {activeTab === "note" ? (
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
          <ComposerModeTabs activeTab={activeTab} />

          {activeTab === "email" ? (
            <ComposerEmailSurface
              composerAliases={composerAliases}
              selectedAlias={selectedAlias}
              recipient={recipient}
              ccRecipients={ccRecipients}
              bccRecipients={bccRecipients}
              showCc={showCc}
              showBcc={showBcc}
              isReplying={isReplying}
              subject={subject}
              body={body}
              attachments={attachments}
              aiDraft={aiDraft}
              aiDirective={aiDirective}
              repromptText={repromptText}
              isGeneratingAi={isGeneratingAi}
              runAiDraftDisabled={runAiDraftDisabled}
              runAiDraftDisabledReason={runAiDraftDisabledReason}
              selectedAliasAiReady={selectedAliasRecord?.isAiReady === true}
              selectedAliasProjectName={
                selectedAliasRecord?.projectName ?? null
              }
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
              onCcChange={(nextRecipients) => {
                setCcRecipients(nextRecipients);
                clearComposerErrors();
              }}
              onBccChange={(nextRecipients) => {
                setBccRecipients(nextRecipients);
                clearComposerErrors();
              }}
              onToggleCc={(open) => {
                setShowCc(open);
                if (!open) {
                  setCcRecipients([]);
                }
                clearComposerErrors();
              }}
              onToggleBcc={(open) => {
                setShowBcc(open);
                if (!open) {
                  setBccRecipients([]);
                }
                clearComposerErrors();
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
              onAiDirectiveChange={setAiDirective}
              onAiEdited={markAiDraftEdited}
              onDiscardAi={handleDiscardAi}
              onOpenReprompt={handleOpenReprompt}
              onCancelReprompt={handleCancelReprompt}
              onApproveAi={handleApproveAi}
              onRunAiDraft={() => {
                runAiDraft();
              }}
              onRepromptTextChange={setRepromptText}
              onReprompt={handleRegenerateAi}
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
              {...(ccError ? { ccError } : {})}
              {...(bccError ? { bccError } : {})}
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
      </DialogContent>
    </Dialog>
  );
}
