"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type TransitionStartFunction,
} from "react";

import { draftWithAiAction } from "../actions";
import { plaintextToComposerHtml } from "../_components/composer-html";
import type { ComposerPaneState } from "../_lib/composer-ui";
import type {
  InboxComposerAliasOption,
  InboxComposerReplyContext,
} from "../_lib/view-models";
import type {
  ComposerDraftAction,
  ComposerDraftState,
} from "./composer-draft-reducer";

export type PolishPhase = "idle" | "busy" | "done";

export function useToolbarPolish({
  state,
  dispatch,
  selectedAliasRecord,
  selectedAliasAiConfigured,
  replyContext,
  composerPaneMode,
  setComposerErrors,
  startAiTransition,
}: {
  readonly state: ComposerDraftState;
  readonly dispatch: Dispatch<ComposerDraftAction>;
  readonly selectedAliasRecord: InboxComposerAliasOption | null;
  readonly selectedAliasAiConfigured: boolean;
  readonly replyContext: InboxComposerReplyContext | null;
  readonly composerPaneMode: ComposerPaneState["mode"];
  readonly setComposerErrors: (errors: readonly []) => void;
  readonly startAiTransition: TransitionStartFunction;
}) {
  const [phase, setPhase] = useState<PolishPhase>("idle");
  const prevBodyRef = useRef<{
    body: string;
    bodyHtml: string;
    smsBody: string;
  } | null>(null);
  const polishedBodyRef = useRef<string | null>(null);

  const currentBody = state.activeTab === "sms" ? state.smsBody : state.body;
  const activeRecipient =
    state.activeTab === "sms" ? state.smsRecipient : state.recipient;
  const hasKnownRecipient = activeRecipient?.kind === "contact";
  const isPolishDisabled =
    state.activeTab === "note" ||
    currentBody.trim().length === 0 ||
    phase === "busy" ||
    !hasKnownRecipient ||
    selectedAliasRecord === null ||
    !selectedAliasAiConfigured;

  useEffect(() => {
    if (phase !== "done") {
      return;
    }

    if (
      polishedBodyRef.current !== null &&
      currentBody !== polishedBodyRef.current
    ) {
      setPhase("idle");
      polishedBodyRef.current = null;
    }
  }, [currentBody, phase]);

  const clearComposerErrors = () => {
    dispatch({ type: "CLEAR_ERRORS" });
    setComposerErrors([]);
  };

  const runPolish = () => {
    if (isPolishDisabled) {
      return;
    }

    clearComposerErrors();
    prevBodyRef.current = {
      body: state.body,
      bodyHtml: state.bodyHtml,
      smsBody: state.smsBody,
    };
    setPhase("busy");

    const isSms = state.activeTab === "sms";
    const contactId =
      isSms && state.smsRecipient?.kind === "contact"
        ? state.smsRecipient.contactId
        : !isSms && state.recipient?.kind === "contact"
          ? state.recipient.contactId
          : null;

    if (contactId === null) {
      setPhase("idle");
      return;
    }

    const request = {
      contactId,
      projectId: selectedAliasRecord.projectId,
      intent:
        composerPaneMode === "new-draft"
          ? ("new" as const)
          : ("reply" as const),
      threadCursor: replyContext?.threadCursor ?? null,
      channel: isSms ? ("sms" as const) : ("email" as const),
      mode: "polish" as const,
      operatorBody: isSms ? state.smsBody : state.body,
      operatorPrompt: null,
    };

    startAiTransition(async () => {
      const result = await draftWithAiAction(request);

      if (!result.ok) {
        prevBodyRef.current = null;
        polishedBodyRef.current = null;
        setPhase("idle");
        dispatch({
          type: "SET_INLINE_ERROR",
          error: {
            message: result.message,
            retryable: false,
          },
        });
        return;
      }

      const polishedText = result.data.draft;
      clearComposerErrors();

      if (isSms) {
        dispatch({ type: "SET_SMS_BODY", body: polishedText });
      } else {
        dispatch({
          type: "SET_BODY",
          body: polishedText,
          bodyHtml: plaintextToComposerHtml(polishedText),
        });
      }

      polishedBodyRef.current = polishedText;
      setPhase("done");
    });
  };

  const undo = () => {
    const prevBody = prevBodyRef.current;
    if (prevBody === null) {
      return;
    }

    setPhase("idle");

    if (state.activeTab === "sms") {
      dispatch({ type: "SET_SMS_BODY", body: prevBody.smsBody });
    } else {
      dispatch({
        type: "SET_BODY",
        body: prevBody.body,
        bodyHtml: prevBody.bodyHtml,
      });
    }

    prevBodyRef.current = null;
    polishedBodyRef.current = null;
  };

  return { phase, runPolish, undo, isPolishDisabled };
}
