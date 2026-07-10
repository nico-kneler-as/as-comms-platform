import type { Dispatch, TransitionStartFunction } from "react";

import {
  draftWithAiAction,
  type AiDraftRequestPayload,
  type AiDraftResponseVm,
} from "../actions";
import type { InboxComposerAliasOption } from "../_lib/view-models";
import type { AiDraftState } from "../_components/inbox-client-provider";
import type {
  ComposerDraftAction,
  ComposerDraftState,
} from "./composer-draft-reducer";
import type { ComposerPaneState } from "../_lib/composer-ui";
import type { InboxComposerReplyContext } from "../_lib/view-models";

export function useAiDraftRun({
  state,
  dispatch,
  aiDraft,
  selectedAliasRecord,
  selectedAliasAiConfigured,
  smsAiConfigured,
  replyContext,
  composerPaneMode,
  startAiGeneration,
  markAiDraftReviewable,
  approveAiDraft,
  discardAiDraft,
  editPromptAiDraft,
  markAiDraftReprompting,
  repromptAi,
  cancelReprompt,
  setAiError,
  setComposerErrors,
  startAiTransition,
}: {
  readonly state: ComposerDraftState;
  readonly dispatch: Dispatch<ComposerDraftAction>;
  readonly aiDraft: AiDraftState;
  readonly selectedAliasRecord: InboxComposerAliasOption | null;
  readonly selectedAliasAiConfigured: boolean;
  readonly smsAiConfigured: boolean;
  readonly replyContext: InboxComposerReplyContext | null;
  readonly composerPaneMode: ComposerPaneState["mode"];
  readonly startAiGeneration: (input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => void;
  readonly markAiDraftReviewable: (input: {
    readonly request: AiDraftRequestPayload;
    readonly response: AiDraftResponseVm;
    readonly prompt: string;
    readonly repromptDirection?: string;
  }) => void;
  readonly approveAiDraft: () => void;
  readonly discardAiDraft: () => void;
  readonly editPromptAiDraft: () => void;
  readonly markAiDraftReprompting: () => void;
  readonly repromptAi: (input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => void;
  readonly cancelReprompt: () => void;
  readonly setAiError: (message: string) => void;
  readonly setComposerErrors: (errors: readonly []) => void;
  readonly startAiTransition: TransitionStartFunction;
}) {
  const clearComposerErrors = () => {
    dispatch({ type: "CLEAR_ERRORS" });
    setComposerErrors([]);
  };

  const buildBaseRequest = () => {
    if (state.activeTab !== "email" && state.activeTab !== "sms") {
      return null;
    }

    const isSms = state.activeTab === "sms";

    if (isSms ? !smsAiConfigured : !selectedAliasAiConfigured) {
      return null;
    }

    const contactId =
      isSms && state.smsRecipient?.kind === "contact"
        ? state.smsRecipient.contactId
        : !isSms && state.recipient?.kind === "contact"
          ? state.recipient.contactId
          : null;

    if (contactId === null) {
      dispatch({
        type: "SET_INLINE_ERROR",
        error: {
          message:
            state.activeTab === "sms"
              ? "AI drafting requires a known volunteer contact."
              : "AI drafting is available only when replying to a contact.",
          retryable: false,
        },
      });
      return null;
    }

    return {
      contactId,
      projectId: selectedAliasRecord?.projectId ?? null,
      intent:
        composerPaneMode === "new-draft"
          ? ("new" as const)
          : ("reply" as const),
      threadCursor: replyContext?.threadCursor ?? null,
      channel: isSms ? ("sms" as const) : ("email" as const),
    };
  };

  const runAiDraft = (requestOverride?: {
    readonly mode: "reprompt";
    readonly repromptDirection: string;
  }) => {
    clearComposerErrors();
    const baseRequest = buildBaseRequest();

    if (baseRequest === null) {
      return;
    }

    const request =
      requestOverride?.mode === "reprompt"
        ? {
            ...baseRequest,
            mode: "reprompt" as const,
            previousDraft: aiDraft.generatedText.trim(),
            repromptDirection: requestOverride.repromptDirection,
            repromptIndex: aiDraft.repromptChain.length + 1,
          }
        : state.aiDirective.trim().length === 0
          ? {
              ...baseRequest,
              mode: "draft" as const,
            }
          : {
              ...baseRequest,
              mode: "fill" as const,
              operatorPrompt: state.aiDirective.trim(),
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
        dispatch({
          type: "SET_INLINE_ERROR",
          error: {
            message: result.message,
            retryable: false,
          },
        });
        return;
      }

      clearComposerErrors();
      dispatch({ type: "SET_REPROMPT_TEXT", value: "" });
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

  const discardAi = () => {
    discardAiDraft();
    dispatch({ type: "SET_AI_DIRECTIVE", value: "" });
    dispatch({ type: "SET_REPROMPT_TEXT", value: "" });
  };

  const editPromptAi = () => {
    clearComposerErrors();
    editPromptAiDraft();
    dispatch({ type: "SET_REPROMPT_TEXT", value: "" });
  };

  const regenerateAi = () => {
    if (state.repromptText.trim().length === 0) {
      return;
    }

    runAiDraft({
      mode: "reprompt",
      repromptDirection: state.repromptText.trim(),
    });
  };

  const openReprompt = () => {
    dispatch({ type: "SET_REPROMPT_TEXT", value: "" });
    markAiDraftReprompting();
  };

  const cancelAiReprompt = () => {
    dispatch({ type: "SET_REPROMPT_TEXT", value: "" });
    cancelReprompt();
  };

  const approveAi = () => {
    const willOverwrite =
      aiDraft.status === "edited-after-generation" ||
      (aiDraft.status === "reviewable" &&
        (aiDraft.channel === "sms"
          ? state.smsBody.trim().length > 0
          : state.body.trim().length > 0));

    if (willOverwrite && !window.confirm("Replace your current message with the AI draft?")) {
      return;
    }

    dispatch({
      type: "APPLY_AI_APPROVAL",
      channel: aiDraft.channel,
      approvedText: aiDraft.generatedText,
    });
    approveAiDraft();
  };

  return {
    runAiDraft,
    discardAi,
    editPromptAi,
    regenerateAi,
    openReprompt,
    cancelAiReprompt,
    approveAi,
  };
}
