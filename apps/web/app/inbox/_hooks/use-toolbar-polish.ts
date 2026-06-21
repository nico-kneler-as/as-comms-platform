"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type TransitionStartFunction,
} from "react";

import { polishTextAction } from "../actions";
import { plaintextToComposerHtml } from "../_components/composer-html";
import type {
  ComposerDraftAction,
  ComposerDraftState,
} from "./composer-draft-reducer";

export type PolishPhase = "idle" | "busy" | "done";

export function useToolbarPolish({
  state,
  dispatch,
  setComposerErrors,
  startAiTransition,
}: {
  readonly state: ComposerDraftState;
  readonly dispatch: Dispatch<ComposerDraftAction>;
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
  const isPolishHidden = state.activeTab === "note";
  const isPolishDisabled =
    currentBody.trim().length === 0 ||
    phase === "busy";

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
    if (isPolishHidden || isPolishDisabled) {
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
    const request = {
      text: (isSms ? state.smsBody : state.body).trim(),
      channel: isSms ? ("sms" as const) : ("email" as const),
    };

    startAiTransition(async () => {
      const result = await polishTextAction(request);

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

      const polishedText = result.data.polishedText;
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

  return { phase, runPolish, undo, isPolishDisabled, isPolishHidden };
}
