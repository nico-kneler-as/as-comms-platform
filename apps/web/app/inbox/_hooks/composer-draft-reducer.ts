import {
  buildForwardBodyHtml,
  buildForwardBodyPlaintext,
  buildForwardSubject,
} from "../_lib/composer-forward";
import {
  resolveDefaultSmsSenderId,
  resolveDefaultAlias,
  type ComposerPaneState,
} from "../_lib/composer-ui";
import type {
  InboxComposerAliasOption,
  InboxComposerForwardContext,
  InboxComposerReplyContext,
  InboxSmsSenderOption,
} from "../_lib/view-models";
import type {
  ComposerFieldErrors,
  AttachmentDraft,
  InlineComposerError,
} from "../_components/composer-shared";
import type { ComposerRecipientValue } from "../_components/composer-recipient-picker";
import type { StoredComposerDraft } from "../_lib/composer-draft-storage";
import { plaintextToComposerHtml } from "../_components/composer-html";

export interface SmsRecipientConsentState {
  readonly canSend: boolean;
  readonly reason: "no_consent" | "revoked" | null;
}

export type ComposerSmsRecipient =
  | {
      readonly kind: "contact";
      readonly contactId: string;
      readonly displayName: string;
      readonly phoneE164: string;
    }
  | {
      readonly kind: "phone";
      readonly phoneE164: string;
    };

export interface ComposerDraftState {
  readonly recipient: ComposerRecipientValue | null;
  readonly cc: readonly ComposerRecipientValue[];
  readonly bcc: readonly ComposerRecipientValue[];
  readonly showCc: boolean;
  readonly showBcc: boolean;
  readonly selectedAlias: string | null;
  readonly subject: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly attachments: readonly AttachmentDraft[];
  readonly aiDirective: string;
  readonly repromptText: string;
  readonly inlineError: InlineComposerError | null;
  readonly fieldErrors: ComposerFieldErrors;
  readonly activeTab: "email" | "sms" | "note";
  readonly smsRecipient: ComposerSmsRecipient | null;
  readonly smsConsent: SmsRecipientConsentState | null;
  readonly smsBody: string;
  readonly smsSelectedSenderId: string | null;
}

export type ComposerDraftAction =
  | {
      readonly type: "RESET_TO_PANE_MODE";
      readonly composerPane: ComposerPaneState;
      readonly replyContext: InboxComposerReplyContext | null;
      readonly forwardContext: InboxComposerForwardContext | null;
      readonly smsSenders: readonly InboxSmsSenderOption[];
    }
  | {
      readonly type: "HYDRATE_FROM_STORED_DRAFT";
      readonly draft: StoredComposerDraft;
      readonly smsSenders: readonly InboxSmsSenderOption[];
    }
  | {
      readonly type: "SET_RECIPIENT";
      readonly recipient: ComposerRecipientValue | null;
      readonly isReplying: boolean;
      readonly aliases: readonly InboxComposerAliasOption[];
    }
  | { readonly type: "SET_CC"; readonly recipients: readonly ComposerRecipientValue[] }
  | { readonly type: "SET_BCC"; readonly recipients: readonly ComposerRecipientValue[] }
  | { readonly type: "TOGGLE_CC"; readonly open: boolean }
  | { readonly type: "TOGGLE_BCC"; readonly open: boolean }
  | { readonly type: "SET_ALIAS"; readonly alias: string | null }
  | { readonly type: "SET_SUBJECT"; readonly subject: string }
  | {
      readonly type: "SET_BODY";
      readonly body: string;
      readonly bodyHtml: string;
    }
  | { readonly type: "SET_AI_DIRECTIVE"; readonly value: string }
  | { readonly type: "SET_REPROMPT_TEXT"; readonly value: string }
  | {
      readonly type: "SET_ACTIVE_TAB";
      readonly tab: "email" | "sms" | "note";
      readonly smsSenders: readonly InboxSmsSenderOption[];
    }
  | { readonly type: "ADD_ATTACHMENTS"; readonly attachments: readonly AttachmentDraft[] }
  | { readonly type: "REMOVE_ATTACHMENT"; readonly id: string }
  | { readonly type: "MARK_ATTACHMENTS_NEEDING_REUPLOAD" }
  | {
      readonly type: "APPLY_AI_APPROVAL";
      readonly channel: "email" | "sms";
      readonly approvedText: string;
    }
  | { readonly type: "SET_INLINE_ERROR"; readonly error: InlineComposerError }
  | { readonly type: "SET_FIELD_ERRORS"; readonly errors: ComposerFieldErrors }
  | {
      readonly type: "SET_ERRORS";
      readonly inlineError: InlineComposerError | null;
      readonly fieldErrors: ComposerFieldErrors;
    }
  | {
      readonly type: "SET_SMS_RECIPIENT";
      readonly recipient: ComposerSmsRecipient | null;
      readonly consent: SmsRecipientConsentState;
    }
  | { readonly type: "SET_SMS_BODY"; readonly body: string }
  | { readonly type: "SET_SMS_SENDER"; readonly senderId: string | null }
  | { readonly type: "CLEAR_ERRORS" };

export const INITIAL_COMPOSER_DRAFT_STATE: ComposerDraftState = {
  recipient: null,
  cc: [],
  bcc: [],
  showCc: false,
  showBcc: false,
  selectedAlias: null,
  subject: "",
  body: "",
  bodyHtml: "",
  attachments: [],
  aiDirective: "",
  repromptText: "",
  inlineError: null,
  fieldErrors: [],
  activeTab: "email",
  smsRecipient: null,
  smsConsent: null,
  smsBody: "",
  smsSelectedSenderId: null,
};

export function toEmailRecipients(
  emails: readonly string[] | undefined,
): readonly ComposerRecipientValue[] {
  return (emails ?? []).map((emailAddress) => ({
    kind: "email",
    emailAddress,
  }));
}

function clearErrors(state: ComposerDraftState): ComposerDraftState {
  return {
    ...state,
    inlineError: null,
    fieldErrors: [],
  };
}

export function reduceComposerDraft(
  state: ComposerDraftState,
  action: ComposerDraftAction,
): ComposerDraftState {
  switch (action.type) {
    case "RESET_TO_PANE_MODE": {
      if (action.composerPane.mode === "closed") {
        return INITIAL_COMPOSER_DRAFT_STATE;
      }

      const replyContext = action.replyContext;
      const forwardContext = action.forwardContext;
      const replyRecipient: ComposerRecipientValue | null =
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
      const cc = toEmailRecipients(replyContext?.cc).filter((candidate) => {
        if (candidate.kind !== "email") {
          return true;
        }

        return candidate.emailAddress !== replyContext?.defaultAlias;
      });
      const bodyHtml =
        forwardContext?.originalBodyHtml === null || forwardContext === null
          ? ""
          : buildForwardBodyHtml(forwardContext);
      const defaultSmsSenderId = resolveDefaultSmsSenderId({
        smsSenders: action.smsSenders,
      });

      return {
        ...INITIAL_COMPOSER_DRAFT_STATE,
        ...(action.composerPane.mode === "replying" && replyContext !== null
          ? {
              smsRecipient:
                replyContext.contactPrimaryPhone === null
                  ? null
                  : {
                      kind: "contact" as const,
                      contactId: replyContext.contactId,
                      displayName: replyContext.contactDisplayName,
                      phoneE164: replyContext.contactPrimaryPhone,
                    },
            }
          : {}),
        activeTab:
          action.composerPane.mode === "replying"
            ? (action.composerPane.initialTab ?? "email")
            : "email",
        recipient:
          action.composerPane.mode === "forwarding" ? null : replyRecipient,
        cc: action.composerPane.mode === "forwarding" ? [] : cc,
        showCc:
          action.composerPane.mode === "forwarding" ? false : cc.length > 0,
        selectedAlias:
          action.composerPane.mode === "forwarding"
            ? (forwardContext?.defaultAlias ?? null)
            : (replyContext?.defaultAlias ?? null),
        subject:
          action.composerPane.mode === "forwarding"
            ? buildForwardSubject(forwardContext?.originalSubject ?? "")
            : (replyContext?.subject ?? ""),
        body:
          action.composerPane.mode === "forwarding" && forwardContext !== null
            ? buildForwardBodyPlaintext(forwardContext)
            : "",
        bodyHtml,
        smsSelectedSenderId:
          action.composerPane.mode === "replying" &&
          action.composerPane.initialTab === "sms"
            ? defaultSmsSenderId
            : null,
      };
    }
    case "HYDRATE_FROM_STORED_DRAFT": {
      const draftCc = Array.isArray((action.draft as { readonly cc?: unknown }).cc)
        ? action.draft.cc
        : [];
      const draftBcc = Array.isArray(
        (action.draft as { readonly bcc?: unknown }).bcc,
      )
        ? action.draft.bcc
        : [];
      const draftChannel = action.draft.channel ?? "email";

      if (draftChannel === "sms") {
        return {
          ...state,
          activeTab: "sms",
          smsBody: action.draft.bodyPlaintext,
          smsSelectedSenderId:
            state.smsSelectedSenderId ??
            resolveDefaultSmsSenderId({
              smsSenders: action.smsSenders,
            }),
          inlineError: null,
          fieldErrors: [],
        };
      }

      if (draftChannel === "note") {
        return {
          ...state,
          activeTab: "note",
          body: action.draft.bodyPlaintext,
          bodyHtml: action.draft.bodyHtml,
          inlineError: null,
          fieldErrors: [],
        };
      }

      return {
        ...state,
        activeTab: "email",
        subject: action.draft.subject,
        body: action.draft.bodyPlaintext,
        bodyHtml: action.draft.bodyHtml,
        cc: toEmailRecipients(draftCc),
        bcc: toEmailRecipients(draftBcc),
        showCc: draftCc.length > 0,
        showBcc: draftBcc.length > 0,
        selectedAlias: action.draft.selectedAlias,
        attachments: action.draft.attachments.map((attachment, index) => ({
          id: `draft:${attachment.filename}:${String(attachment.size)}:${String(index)}`,
          filename: attachment.filename,
          size: attachment.size,
          contentType: attachment.contentType,
          contentBase64: null,
        })),
        aiDirective: action.draft.aiDirective ?? state.aiDirective,
        inlineError: null,
        fieldErrors: [],
      };
    }
    case "SET_RECIPIENT":
      return clearErrors({
        ...state,
        recipient: action.recipient,
        selectedAlias:
          state.selectedAlias ??
          (action.isReplying
            ? null
            : resolveDefaultAlias({
                recipient: action.recipient,
                aliases: action.aliases,
              })),
      });
    case "SET_CC":
      return clearErrors({ ...state, cc: action.recipients });
    case "SET_BCC":
      return clearErrors({ ...state, bcc: action.recipients });
    case "TOGGLE_CC":
      return clearErrors({
        ...state,
        showCc: action.open,
        cc: action.open ? state.cc : [],
      });
    case "TOGGLE_BCC":
      return clearErrors({
        ...state,
        showBcc: action.open,
        bcc: action.open ? state.bcc : [],
      });
    case "SET_ALIAS":
      return clearErrors({ ...state, selectedAlias: action.alias });
    case "SET_SUBJECT":
      return clearErrors({ ...state, subject: action.subject });
    case "SET_BODY":
      return {
        ...state,
        body: action.body,
        bodyHtml: action.bodyHtml,
      };
    case "SET_AI_DIRECTIVE":
      return { ...state, aiDirective: action.value };
    case "SET_REPROMPT_TEXT":
      return { ...state, repromptText: action.value };
    case "SET_ACTIVE_TAB":
      return {
        ...state,
        activeTab: action.tab,
        smsSelectedSenderId:
          action.tab === "sms"
            ? state.smsSelectedSenderId ??
              resolveDefaultSmsSenderId({
                smsSenders: action.smsSenders,
              })
            : state.smsSelectedSenderId,
        inlineError: null,
        fieldErrors: [],
      };
    case "SET_SMS_RECIPIENT":
      return clearErrors({
        ...state,
        smsRecipient: action.recipient,
        smsConsent: action.recipient === null ? null : action.consent,
      });
    case "SET_SMS_BODY":
      return clearErrors({
        ...state,
        smsBody: action.body,
      });
    case "SET_SMS_SENDER":
      return clearErrors({
        ...state,
        smsSelectedSenderId: action.senderId,
      });
    case "ADD_ATTACHMENTS":
      return clearErrors({
        ...state,
        attachments: [...state.attachments, ...action.attachments],
      });
    case "REMOVE_ATTACHMENT":
      return clearErrors({
        ...state,
        attachments: state.attachments.filter(
          (attachment) => attachment.id !== action.id,
        ),
      });
    case "MARK_ATTACHMENTS_NEEDING_REUPLOAD":
      return {
        ...state,
        attachments: state.attachments.map((attachment) => ({
          ...attachment,
          contentBase64: null,
        })),
      };
    case "APPLY_AI_APPROVAL":
      return {
        ...state,
        ...(action.channel === "sms"
          ? {
              smsBody: action.approvedText,
            }
          : {
              body: action.approvedText,
              bodyHtml: plaintextToComposerHtml(action.approvedText),
            }),
        aiDirective: "",
        repromptText: "",
      };
    case "SET_INLINE_ERROR":
      return {
        ...state,
        inlineError: action.error,
      };
    case "SET_FIELD_ERRORS":
      return {
        ...state,
        fieldErrors: action.errors,
      };
    case "SET_ERRORS":
      return {
        ...state,
        inlineError: action.inlineError,
        fieldErrors: action.fieldErrors,
      };
    case "CLEAR_ERRORS":
      return clearErrors(state);
  }
}
