import type { Dispatch, RefObject, TransitionStartFunction } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { smsMetrics } from "@as-comms/domain/sms-segments";

import { deleteComposerDraftAction } from "@/src/server/composer/drafts";
import {
  createNoteAction,
  sendComposerAction,
  sendSmsAction,
  type ComposerSendActionInput,
} from "../actions";
import {
  resolveComposerSendActionFlags,
  type ComposerSendKind,
} from "../_lib/composer-ui";
import type {
  InboxComposerAliasOption,
  InboxComposerReplyContext,
  OptimisticOutbound,
} from "../_lib/view-models";
import {
  getInternalNoteValidationError,
  normalizeInternalNoteBody,
} from "@/src/lib/internal-note-validation";
import {
  mapFieldErrors,
  resolveRecipientEmailAddress,
  resolveRecipientLabel,
  type AttachmentDraft,
  type ComposerFieldErrors,
} from "../_components/composer-shared";
import type { ComposerRecipientValue } from "../_components/composer-recipient-picker";
import type {
  ComposerDraftAction,
  ComposerDraftState,
} from "./composer-draft-reducer";

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

function toOptimisticAttachment(attachment: AttachmentDraft, index: number) {
  return {
    id: `optimistic-attachment:${attachment.id}:${String(index)}`,
    provider: "gmail" as const,
    mimeType: attachment.contentType,
    filename: attachment.filename,
    sizeBytes: attachment.size,
    proxyUrl:
      attachment.contentBase64 === null
        ? ""
        : `data:${attachment.contentType};base64,${attachment.contentBase64}`,
    externalUrl: null,
  };
}

export function useComposerSubmit({
  state,
  dispatch,
  draftIdRef,
  invalidateDraftPersistence,
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
}: {
  readonly state: ComposerDraftState;
  readonly dispatch: Dispatch<ComposerDraftAction>;
  readonly draftIdRef: RefObject<string | null>;
  readonly invalidateDraftPersistence: () => void;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly isReplying: boolean;
  readonly replyContext: InboxComposerReplyContext | null;
  readonly operatorDisplayName: string;
  readonly router: AppRouterInstance;
  readonly closeComposer: () => void;
  readonly showToast: (message: string, kind: "success" | "error") => void;
  readonly setComposerErrors: (errors: ComposerFieldErrors) => void;
  readonly setComposerStatus: (
    status:
      | "sending"
      | "sent-success"
      | "validation-error"
      | "send-failure"
      | "saving-draft"
      | "draft-saved",
  ) => void;
  readonly addOptimisticOutbound: (entry: OptimisticOutbound) => void;
  readonly markOptimisticSettled: (clientGeneratedId: string) => void;
  readonly markOptimisticFailed: (
    clientGeneratedId: string,
    message: string,
  ) => void;
  readonly startSendTransition: TransitionStartFunction;
  readonly startSaveNoteTransition: TransitionStartFunction;
}) {
  const clearPersistedDraft = async () => {
    const draftId = draftIdRef.current;
    draftIdRef.current = null;

    if (draftId === null) {
      return;
    }

    const result = await deleteComposerDraftAction({ id: draftId });
    if (!result.ok) {
      console.error("[composer/drafts] failed to delete persisted draft", result);
    }
  };

  const setErrors = (input: {
    readonly message: string;
    readonly retryable: boolean;
    readonly fieldErrors: ComposerFieldErrors;
  }) => {
    dispatch({
      type: "SET_ERRORS",
      inlineError: {
        message: input.message,
        retryable: input.retryable,
      },
      fieldErrors: input.fieldErrors,
    });
    setComposerErrors(input.fieldErrors);
  };

  const submit = (sendKind: ComposerSendKind) => {
    if (
      state.recipient === null ||
      state.selectedAlias === null ||
      state.activeTab !== "email"
    ) {
      return;
    }

    const resolvedCc = resolveSupplementaryRecipientEmails({
      recipients: state.cc,
    });
    if (!resolvedCc.ok) {
      setErrors({
        message: resolvedCc.message,
        retryable: false,
        fieldErrors: [{ field: "cc", message: resolvedCc.message }],
      });
      return;
    }

    const resolvedBcc = resolveSupplementaryRecipientEmails({
      recipients: state.bcc,
    });
    if (!resolvedBcc.ok) {
      setErrors({
        message: resolvedBcc.message,
        retryable: false,
        fieldErrors: [{ field: "bcc", message: resolvedBcc.message }],
      });
      return;
    }

    if (
      state.attachments.some((attachment) => attachment.contentBase64 === null)
    ) {
      const message =
        "Please reattach files added before refresh before sending.";
      setErrors({
        message,
        retryable: false,
        fieldErrors: [{ field: "attachments", message }],
      });
      return;
    }

    const payload: ComposerSendActionInput = {
      recipient:
        state.recipient.kind === "contact"
          ? { kind: "contact", contactId: state.recipient.contactId }
          : { kind: "email", emailAddress: state.recipient.emailAddress },
      alias: state.selectedAlias,
      subject: state.subject.trim(),
      bodyPlaintext: state.body.trim(),
      bodyHtml: state.bodyHtml,
      ...(state.signatureOverride !== null
        ? { signatureOverride: state.signatureOverride }
        : {}),
      ...(resolvedCc.emails.length > 0 ? { cc: [...resolvedCc.emails] } : {}),
      ...(resolvedBcc.emails.length > 0
        ? { bcc: [...resolvedBcc.emails] }
        : {}),
      attachments: state.attachments.flatMap((attachment) =>
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
      ...resolveComposerSendActionFlags({
        sendKind,
      }),
      ...(replyContext?.threadId ? { threadId: replyContext.threadId } : {}),
      ...(replyContext?.inReplyToRfc822
        ? { inReplyToRfc822: replyContext.inReplyToRfc822 }
        : {}),
    };
    const clientGeneratedId = crypto.randomUUID();
    const recipientLabel = resolveRecipientLabel(state.recipient);
    const occurredAt = new Date().toISOString();
    const createdAt = Date.now();
    const optimisticEntry: OptimisticOutbound = {
      id: `optimistic:${clientGeneratedId}`,
      clientGeneratedId,
      contactId:
        state.recipient.kind === "contact" ? state.recipient.contactId : null,
      createdAt,
      settledAt: null,
      kind: "outbound-email",
      occurredAt,
      occurredAtLabel: "Just now",
      actorLabel: operatorDisplayName,
      subject: state.subject.trim(),
      body: state.body.trim(),
      channel: "email",
      isUnread: false,
      isPreview: false,
      fromHeader: state.selectedAlias,
      toHeader: recipientLabel,
      recipientLabel,
      ccHeader:
        resolvedCc.emails.length > 0 ? resolvedCc.emails.join(", ") : null,
      mailbox: state.selectedAlias,
      threadId: replyContext?.threadId ?? null,
      rfc822MessageId: null,
      inReplyToRfc822: replyContext?.inReplyToRfc822 ?? null,
      sendStatus: "pending",
      failedReason: null,
      failedDetail: null,
      attachmentCount: state.attachments.length,
      attachments: state.attachments.map(toOptimisticAttachment),
      campaignActivity: [],
    };

    dispatch({ type: "CLEAR_ERRORS" });
    setComposerErrors([]);
    setComposerStatus("sending");
    addOptimisticOutbound(optimisticEntry);
    invalidateDraftPersistence();
    closeComposer();

    startSendTransition(async () => {
      try {
        const result = await sendComposerAction({
          ...payload,
          clientGeneratedId,
        });

        if (result.ok) {
          await clearPersistedDraft();
          if (result.data.clientGeneratedId !== null) {
            markOptimisticSettled(result.data.clientGeneratedId);
          }
          setComposerStatus("sent-success");
          showToast(`Sent to ${recipientLabel}`, "success");
          router.refresh();
          return;
        }

        markOptimisticFailed(clientGeneratedId, result.message);
        const fieldErrors = mapFieldErrors(result);
        dispatch({
          type: "SET_ERRORS",
          inlineError: {
            message: result.message,
            retryable: result.retryable === true,
          },
          fieldErrors,
        });
        setComposerErrors(fieldErrors);
        setComposerStatus(
          result.code === "validation_error"
            ? "validation-error"
            : "send-failure",
        );
      } catch {
        markOptimisticFailed(
          clientGeneratedId,
          "We could not send that message right now.",
        );
        setComposerStatus("send-failure");
        dispatch({
          type: "SET_INLINE_ERROR",
          error: {
            message: "We could not send that message right now.",
            retryable: true,
          },
        });
      }
    });
  };

  const submitSms = (sendKind: ComposerSendKind = "send") => {
    if (state.activeTab !== "sms") {
      return;
    }

    if (state.smsRecipient === null) {
      setErrors({
        message: "Choose a phone recipient first.",
        retryable: false,
        fieldErrors: [{ field: "recipient", message: "Choose a recipient." }],
      });
      return;
    }

    if (state.smsSelectedSenderId === null) {
      setErrors({
        message: "No active SMS sender is configured.",
        retryable: false,
        fieldErrors: [{ field: "sender", message: "Choose a sender." }],
      });
      return;
    }

    const body = state.smsBody.trim();
    if (body.length === 0) {
      setErrors({
        message: "Write an SMS before sending.",
        retryable: false,
        fieldErrors: [{ field: "body", message: "Message body is required." }],
      });
      return;
    }

    if (smsMetrics(body).length > 320) {
      const message = "SMS messages are limited to 320 encoded characters.";
      setErrors({
        message,
        retryable: false,
        fieldErrors: [{ field: "body", message }],
      });
      return;
    }

    const clientGeneratedId = crypto.randomUUID();
    const smsRecipient = state.smsRecipient;
    const smsSenderId = state.smsSelectedSenderId;
    const selectedAliasRecord =
      state.selectedAlias === null
        ? null
        : (composerAliases.find((alias) => alias.alias === state.selectedAlias) ??
          null);
    const smsBody = body;
    const occurredAt = new Date().toISOString();
    const createdAt = Date.now();
    const recipientLabel =
      smsRecipient.kind === "contact"
        ? `${smsRecipient.displayName} (${smsRecipient.phoneE164})`
        : smsRecipient.phoneE164;
    const optimisticEntry: OptimisticOutbound = {
      id: `optimistic:${clientGeneratedId}`,
      clientGeneratedId,
      contactId:
        smsRecipient.kind === "contact"
          ? smsRecipient.contactId
          : null,
      createdAt,
      settledAt: null,
      kind: "outbound-sms",
      occurredAt,
      occurredAtLabel: "Just now",
      actorLabel: operatorDisplayName,
      subject: null,
      body: smsBody,
      channel: "sms",
      isUnread: false,
      isPreview: false,
      fromHeader: null,
      toHeader: recipientLabel,
      recipientLabel,
      ccHeader: null,
      mailbox: null,
      threadId: null,
      rfc822MessageId: null,
      inReplyToRfc822: null,
      sendStatus: "pending",
      failedReason: null,
      failedDetail: null,
      attachmentCount: 0,
      attachments: [],
      campaignActivity: [],
    };

    dispatch({ type: "CLEAR_ERRORS" });
    setComposerErrors([]);
    setComposerStatus("sending");
    addOptimisticOutbound(optimisticEntry);
    invalidateDraftPersistence();
    closeComposer();

    startSendTransition(async () => {
      try {
        const result = await sendSmsAction({
          recipient:
            smsRecipient.kind === "contact"
              ? {
                  kind: "contact",
                  contactId: smsRecipient.contactId,
                }
              : {
                  kind: "phone",
                  phoneE164: smsRecipient.phoneE164,
                },
          senderId: smsSenderId,
          body: smsBody,
          clientGeneratedId,
          projectId:
            sendKind === "send-and-save"
              ? selectedAliasRecord?.projectId ?? null
              : null,
          saveAsKnowledge: sendKind === "send-and-save",
        });

        if (result.ok) {
          await clearPersistedDraft();
          markOptimisticSettled(result.data.clientGeneratedId);
          setComposerStatus("sent-success");
          showToast(`Sent to ${recipientLabel}`, "success");
          router.refresh();
          return;
        }

        markOptimisticFailed(clientGeneratedId, result.message);
        setComposerStatus(
          result.code === "validation_error" ? "validation-error" : "send-failure",
        );
        dispatch({
          type: "SET_INLINE_ERROR",
          error: {
            message: result.message,
            retryable: result.retryable === true,
          },
        });
      } catch {
        markOptimisticFailed(
          clientGeneratedId,
          "We could not send that SMS right now.",
        );
        setComposerStatus("send-failure");
        dispatch({
          type: "SET_INLINE_ERROR",
          error: {
            message: "We could not send that SMS right now.",
            retryable: true,
          },
        });
      }
    });
  };

  const saveNote = () => {
    if (!isReplying || replyContext === null) {
      return;
    }

    const normalizedBody = normalizeInternalNoteBody(state.body);
    const validationError = getInternalNoteValidationError(normalizedBody);

    if (validationError !== null) {
      setErrors({
        message: validationError,
        retryable: false,
        fieldErrors: [{ field: "body", message: validationError }],
      });
      return;
    }

    dispatch({ type: "CLEAR_ERRORS" });
    setComposerErrors([]);
    setComposerStatus("saving-draft");

    startSaveNoteTransition(async () => {
      const result = await createNoteAction({
        contactId: replyContext.contactId,
        body: normalizedBody,
      });

      if (result.ok) {
        invalidateDraftPersistence();
        await clearPersistedDraft();
        setComposerStatus("draft-saved");
        dispatch({ type: "SET_BODY", body: "", bodyHtml: "" });
        closeComposer();
        router.refresh();
        showToast("Note saved.", "success");
        return;
      }

      const fieldErrors = mapFieldErrors(result);
      dispatch({
        type: "SET_ERRORS",
        inlineError: {
          message: result.message,
          retryable: result.retryable === true,
        },
        fieldErrors,
      });
      setComposerErrors(fieldErrors);
      setComposerStatus("validation-error");
    });
  };

  const cancel = () => {
    invalidateDraftPersistence();
    void clearPersistedDraft();
    closeComposer();
  };

  return {
    submit,
    submitSms,
    saveNote,
    cancel,
  };
}
