import { useEffect, useReducer, useRef } from "react";

import {
  clearDraft,
  loadDraft,
  saveDraft,
} from "../_lib/composer-draft-storage";
import {
  resolveDefaultAlias,
  type ComposerPaneState,
} from "../_lib/composer-ui";
import type { InboxComposerAliasOption } from "../_lib/view-models";
import {
  resolveComposerDraftKey,
  resolveRecipientEmailAddress,
} from "../_components/composer-shared";
import {
  INITIAL_COMPOSER_DRAFT_STATE,
  reduceComposerDraft,
} from "./composer-draft-reducer";

export function useComposerDraftState({
  actorId,
  composerPane,
  composerAliases,
  setComposerStatus,
  setComposerErrors,
  resetAiDraft,
}: {
  readonly actorId: string;
  readonly composerPane: ComposerPaneState;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly setComposerStatus: (status: "idle") => void;
  readonly setComposerErrors: (errors: readonly []) => void;
  readonly resetAiDraft: () => void;
}) {
  const [state, dispatch] = useReducer(
    reduceComposerDraft,
    INITIAL_COMPOSER_DRAFT_STATE,
  );
  const hydratedDraftKeyRef = useRef<string | null>(null);
  const replyContext =
    composerPane.mode === "replying" ? composerPane.replyContext : null;
  const isReplying = composerPane.mode === "replying";
  const baselineSubject = replyContext?.subject ?? "";
  const baselineAlias = isReplying
    ? (replyContext?.defaultAlias ?? null)
    : resolveDefaultAlias({
        recipient: state.recipient,
        aliases: composerAliases,
      });
  const draftKey = resolveComposerDraftKey({
    actorId,
    recipient: state.recipient,
  });

  useEffect(() => {
    if (composerPane.mode === "closed") {
      hydratedDraftKeyRef.current = null;
    }

    dispatch({
      type: "RESET_TO_PANE_MODE",
      composerPane,
      replyContext,
    });
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

  useEffect(() => {
    if (
      composerPane.mode === "closed" ||
      state.activeTab !== "email" ||
      draftKey === null ||
      hydratedDraftKeyRef.current === draftKey
    ) {
      return;
    }

    const isUntouchedComposer =
      state.subject.trim() === baselineSubject.trim() &&
      state.body.trim().length === 0 &&
      state.bodyHtml.trim().length === 0 &&
      state.cc.length === 0 &&
      state.bcc.length === 0 &&
      state.attachments.length === 0 &&
      state.selectedAlias === baselineAlias;

    if (!isUntouchedComposer) {
      hydratedDraftKeyRef.current = draftKey;
      return;
    }

    const draft = loadDraft(draftKey);
    hydratedDraftKeyRef.current = draftKey;

    if (draft !== null) {
      dispatch({
        type: "HYDRATE_FROM_STORED_DRAFT",
        draft,
      });
    }
  }, [
    baselineAlias,
    baselineSubject,
    composerPane.mode,
    draftKey,
    state.activeTab,
    state.attachments.length,
    state.bcc.length,
    state.body,
    state.bodyHtml,
    state.cc.length,
    state.selectedAlias,
    state.subject,
  ]);

  useEffect(() => {
    if (
      composerPane.mode === "closed" ||
      state.activeTab !== "email" ||
      draftKey === null
    ) {
      return;
    }

    const hasPersistableContent =
      state.subject.trim() !== baselineSubject.trim() ||
      state.body.trim().length > 0 ||
      state.bodyHtml.trim().length > 0 ||
      state.cc.length > 0 ||
      state.bcc.length > 0 ||
      state.selectedAlias !== baselineAlias ||
      state.attachments.length > 0;

    const timeoutId = window.setTimeout(() => {
      if (!hasPersistableContent) {
        clearDraft(draftKey);
        return;
      }

      saveDraft(draftKey, {
        subject: state.subject,
        bodyPlaintext: state.body,
        bodyHtml: state.bodyHtml,
        selectedAlias: state.selectedAlias,
        cc: state.cc.flatMap((recipient) => {
          const email = resolveRecipientEmailAddress(recipient);
          return email === null ? [] : [email];
        }),
        bcc: state.bcc.flatMap((recipient) => {
          const email = resolveRecipientEmailAddress(recipient);
          return email === null ? [] : [email];
        }),
        attachments: state.attachments.map((attachment) => ({
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
    baselineAlias,
    baselineSubject,
    composerPane.mode,
    draftKey,
    state.activeTab,
    state.attachments,
    state.bcc,
    state.body,
    state.bodyHtml,
    state.cc,
    state.selectedAlias,
    state.subject,
  ]);

  return {
    state,
    dispatch,
    draftKey,
    isReplying,
    replyContext,
  };
}
