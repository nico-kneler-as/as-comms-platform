import { useEffect, useReducer, useRef, useState } from "react";

import type { ComposerDraftChannel } from "@as-comms/contracts";
import type { ComposerDraftRecord } from "@as-comms/db";
import {
  deleteComposerDraftAction,
  listComposerDraftsAction,
  upsertComposerDraftAction,
} from "@/src/server/composer/drafts";

import {
  buildForwardBodyHtml,
  buildForwardBodyPlaintext,
  buildForwardSubject,
} from "../_lib/composer-forward";
import {
  toStoredComposerDraft,
  type StoredComposerDraft,
} from "../_lib/composer-draft-storage";
import { resolveDefaultAlias, type ComposerPaneState } from "../_lib/composer-ui";
import type {
  InboxComposerAliasOption,
  InboxComposerForwardContext,
  InboxComposerReplyContext,
  InboxDraftListItemViewModel,
  InboxSmsSenderOption,
} from "../_lib/view-models";
import { resolveRecipientEmailAddress } from "../_components/composer-shared";
import { useInboxClient } from "../_components/inbox-client-provider";
import {
  INITIAL_COMPOSER_DRAFT_STATE,
  reduceComposerDraft,
  type ComposerDraftState,
  type ComposerSmsRecipient,
} from "./composer-draft-reducer";

type DraftIdentity = Readonly<{
  paneMode: Exclude<ComposerPaneState["mode"], "closed">;
  channel: ComposerDraftChannel;
  recipientAnchorKind: "contact" | "email" | "phone";
  recipientContactId: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
}>;

function buildDraftIdentityKey(identity: DraftIdentity): string {
  return [
    identity.paneMode,
    identity.channel,
    identity.recipientAnchorKind,
    identity.recipientContactId ?? "",
    identity.recipientEmail ?? "",
    identity.recipientPhone ?? "",
  ].join("::");
}

function isSameDraft(
  draft: ComposerDraftRecord,
  identity: DraftIdentity,
): boolean {
  return (
    draft.paneMode === identity.paneMode &&
    draft.channel === identity.channel &&
    draft.recipientAnchorKind === identity.recipientAnchorKind &&
    draft.recipientContactId === identity.recipientContactId &&
    draft.recipientEmail === identity.recipientEmail &&
    draft.recipientPhone === identity.recipientPhone
  );
}

function isUntouchedCurrentDraft(input: {
  readonly draft: StoredComposerDraft;
  readonly state: ComposerDraftState;
  readonly baselineSubject: string;
  readonly baselineBody: string;
  readonly baselineBodyHtml: string;
  readonly baselineAlias: string | null;
}): boolean {
  if (input.draft.channel === "sms") {
    return input.state.smsBody.trim().length === 0;
  }

  if (input.draft.channel === "note") {
    return input.state.body.trim().length === 0;
  }

  return (
    input.state.subject.trim() === input.baselineSubject.trim() &&
    input.state.body.trim() === input.baselineBody.trim() &&
    input.state.bodyHtml.trim() === input.baselineBodyHtml.trim() &&
    input.state.cc.length === 0 &&
    input.state.bcc.length === 0 &&
    input.state.attachments.length === 0 &&
    input.state.selectedAlias === input.baselineAlias &&
    input.state.aiDirective.trim().length === 0
  );
}

function resolveSmsIdentity(
  recipient: ComposerSmsRecipient | null,
  paneMode: Exclude<ComposerPaneState["mode"], "closed">,
): DraftIdentity | null {
  if (recipient === null) {
    return null;
  }

  if (recipient.kind === "contact") {
    return {
      paneMode,
      channel: "sms",
      recipientAnchorKind: "contact",
      recipientContactId: recipient.contactId,
      recipientEmail: null,
      recipientPhone: recipient.phoneE164,
    };
  }

  return {
    paneMode,
    channel: "sms",
    recipientAnchorKind: "phone",
    recipientContactId: null,
    recipientEmail: null,
    recipientPhone: recipient.phoneE164,
  };
}

function resolveCurrentDraftIdentity(input: {
  readonly composerPane: ComposerPaneState;
  readonly state: ComposerDraftState;
}): DraftIdentity | null {
  if (input.composerPane.mode === "closed") {
    return null;
  }

  if (input.state.activeTab === "sms") {
    return resolveSmsIdentity(input.state.smsRecipient, input.composerPane.mode);
  }

  if (input.state.activeTab === "note") {
    return input.composerPane.mode === "replying"
      ? {
          paneMode: "replying",
          channel: "note",
          recipientAnchorKind: "contact",
          recipientContactId: input.composerPane.replyContext.contactId,
          recipientEmail: null,
          recipientPhone: input.composerPane.replyContext.contactPrimaryPhone,
        }
      : null;
  }

  const recipient = input.state.recipient;
  if (recipient === null) {
    return null;
  }

  if (recipient.kind === "contact") {
    return {
      paneMode: input.composerPane.mode,
      channel: "email",
      recipientAnchorKind: "contact",
      recipientContactId: recipient.contactId,
      recipientEmail: resolveRecipientEmailAddress(recipient),
      recipientPhone: null,
    };
  }

  return {
    paneMode: input.composerPane.mode,
    channel: "email",
    recipientAnchorKind: "email",
    recipientContactId: null,
    recipientEmail: resolveRecipientEmailAddress(recipient),
    recipientPhone: null,
  };
}

function upsertDraftCache(
  drafts: readonly ComposerDraftRecord[] | null,
  nextDraft: ComposerDraftRecord,
): readonly ComposerDraftRecord[] {
  const withoutPrevious = (drafts ?? []).filter((draft) => draft.id !== nextDraft.id);
  return [nextDraft, ...withoutPrevious].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.id.localeCompare(left.id),
  );
}

function removeDraftFromCache(
  drafts: readonly ComposerDraftRecord[] | null,
  draftId: string,
): readonly ComposerDraftRecord[] {
  return (drafts ?? []).filter((draft) => draft.id !== draftId);
}

function toDraftListItemViewModel(input: {
  readonly draft: ComposerDraftRecord;
  readonly composerPane: ComposerPaneState;
  readonly state: ComposerDraftState;
  readonly replyContext: InboxComposerReplyContext | null;
  readonly forwardContext: InboxComposerForwardContext | null;
}): InboxDraftListItemViewModel {
  const recipientDisplayName =
    input.state.activeTab === "sms"
      ? input.state.smsRecipient?.kind === "contact"
        ? input.state.smsRecipient.displayName
        : null
      : input.composerPane.mode === "replying"
        ? (input.replyContext?.contactDisplayName ?? null)
        : input.state.recipient?.kind === "contact"
          ? input.state.recipient.displayName
          : null;

  return {
    id: input.draft.id,
    paneMode:
      input.draft.paneMode === "new-draft" ? "new_draft" : input.draft.paneMode,
    channel: input.draft.channel,
    recipientContactId: input.draft.recipientContactId,
    recipientEmail: input.draft.recipientEmail,
    recipientPhone: input.draft.recipientPhone,
    recipientDisplayName,
    subject: input.draft.subject,
    bodyPlaintext: input.draft.bodyPlaintext,
    bodyHtml: input.draft.bodyHtml,
    selectedAlias: input.draft.selectedAlias,
    cc: input.draft.cc,
    bcc: input.draft.bcc,
    attachments: input.draft.attachments,
    aiDirective: input.draft.aiDirective,
    replyContext: input.composerPane.mode === "replying" ? input.replyContext : null,
    forwardContext:
      input.composerPane.mode === "forwarding" ? input.forwardContext : null,
    updatedAt: input.draft.updatedAt,
  };
}

export function useComposerDraftState({
  composerPane,
  composerAliases,
  smsSenders,
  setComposerStatus,
  setComposerErrors,
  resetAiDraft,
}: {
  readonly actorId: string;
  readonly composerPane: ComposerPaneState;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly smsSenders: readonly InboxSmsSenderOption[];
  readonly setComposerStatus: (status: "idle") => void;
  readonly setComposerErrors: (errors: readonly []) => void;
  readonly resetAiDraft: () => void;
}) {
  const [state, dispatch] = useReducer(
    reduceComposerDraft,
    INITIAL_COMPOSER_DRAFT_STATE,
  );
  const {
    clearPendingExistingDraft,
    pendingExistingDraft,
    removeDraft,
    upsertDraft,
  } = useInboxClient();
  const [availableDrafts, setAvailableDrafts] = useState<
    readonly ComposerDraftRecord[] | null
  >(null);
  const hydratedDraftIdentityRef = useRef<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const persistenceEpochRef = useRef(0);
  const replyContext =
    composerPane.mode === "replying" ? composerPane.replyContext : null;
  const forwardContext =
    composerPane.mode === "forwarding" ? composerPane.forwardContext : null;
  const isReplying = composerPane.mode === "replying";
  const baselineSubject =
    composerPane.mode === "forwarding" && forwardContext !== null
      ? buildForwardSubject(forwardContext.originalSubject)
      : (replyContext?.subject ?? "");
  const baselineBody =
    composerPane.mode === "forwarding" && forwardContext !== null
      ? buildForwardBodyPlaintext(forwardContext)
      : "";
  const baselineBodyHtml =
    composerPane.mode === "forwarding" &&
    forwardContext?.originalBodyHtml !== null &&
    forwardContext !== null
      ? buildForwardBodyHtml(forwardContext)
      : "";
  const baselineAlias =
    composerPane.mode === "forwarding"
      ? (forwardContext?.defaultAlias ?? null)
      : isReplying
        ? (replyContext?.defaultAlias ?? null)
        : resolveDefaultAlias({
            recipient: state.recipient,
            aliases: composerAliases,
          });

  const invalidateDraftPersistence = () => {
    persistenceEpochRef.current += 1;
  };

  useEffect(() => {
    invalidateDraftPersistence();
    hydratedDraftIdentityRef.current = null;
    draftIdRef.current = null;
    setAvailableDrafts(composerPane.mode === "closed" ? null : []);

    dispatch({
      type: "RESET_TO_PANE_MODE",
      composerPane,
      replyContext,
      forwardContext,
      smsSenders,
    });
    setComposerStatus("idle");
    setComposerErrors([]);
    resetAiDraft();
    // smsSenders intentionally excluded: this effect resets state on
    // composerPane/context changes, not on sender-list churn. The dispatch
    // closure still reads the current smsSenders for default selection.
  }, [
    composerPane,
    forwardContext,
    replyContext,
    resetAiDraft,
    setComposerErrors,
    setComposerStatus,
  ]);

  useEffect(() => {
    if (composerPane.mode === "closed") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await listComposerDraftsAction({ limit: 50 });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cleanup callback below flips `cancelled` to true on unmount; the linter can't see the closure capture.
      if (cancelled) {
        return;
      }

      if (result.ok) {
        setAvailableDrafts(result.data.drafts);
        return;
      }

      console.error("[composer/drafts] failed to list drafts", result);
      setAvailableDrafts([]);
    })();

    return () => {
      cancelled = true;
    };
  }, [composerPane]);

  useEffect(() => {
    if (composerPane.mode === "closed" || pendingExistingDraft === null) {
      return;
    }

    draftIdRef.current = pendingExistingDraft.id;
    dispatch({
      type: "HYDRATE_FROM_STORED_DRAFT",
      draft: {
        id: pendingExistingDraft.id,
        paneMode:
          pendingExistingDraft.paneMode === "new_draft"
            ? "new-draft"
            : pendingExistingDraft.paneMode,
        channel: pendingExistingDraft.channel,
        subject: pendingExistingDraft.subject,
        bodyPlaintext: pendingExistingDraft.bodyPlaintext,
        bodyHtml: pendingExistingDraft.bodyHtml,
        selectedAlias: pendingExistingDraft.selectedAlias,
        cc: pendingExistingDraft.cc,
        bcc: pendingExistingDraft.bcc,
        attachments: pendingExistingDraft.attachments,
        updatedAt: Date.parse(pendingExistingDraft.updatedAt),
        aiDirective: pendingExistingDraft.aiDirective,
        recipientContactId: pendingExistingDraft.recipientContactId,
        recipientEmail: pendingExistingDraft.recipientEmail,
        recipientPhone: pendingExistingDraft.recipientPhone,
        replyContextThreadCursor: pendingExistingDraft.replyContext?.threadCursor ?? null,
        forwardContext: pendingExistingDraft.forwardContext,
      },
      smsSenders,
    });
    clearPendingExistingDraft();
    // smsSenders read at dispatch time only; not a re-fire trigger.
  }, [
    clearPendingExistingDraft,
    composerPane.mode,
    pendingExistingDraft,
  ]);

  useEffect(() => {
    if (composerPane.mode === "closed" || availableDrafts === null) {
      return;
    }

    const draftIdentity = resolveCurrentDraftIdentity({
      composerPane,
      state,
    });

    if (draftIdentity === null) {
      draftIdRef.current = null;
      return;
    }

    const identityKey = buildDraftIdentityKey(draftIdentity);
    if (hydratedDraftIdentityRef.current === identityKey) {
      return;
    }

    const matchedDraft =
      availableDrafts.find((draft) => isSameDraft(draft, draftIdentity)) ?? null;

    hydratedDraftIdentityRef.current = identityKey;

    if (matchedDraft === null) {
      draftIdRef.current = null;
      return;
    }

    const storedDraft = toStoredComposerDraft(matchedDraft);
    if (
      !isUntouchedCurrentDraft({
        draft: storedDraft,
        state,
        baselineSubject,
        baselineBody,
        baselineBodyHtml,
        baselineAlias,
      })
    ) {
      draftIdRef.current = matchedDraft.id;
      return;
    }

    draftIdRef.current = matchedDraft.id;
    dispatch({
      type: "HYDRATE_FROM_STORED_DRAFT",
      draft: storedDraft,
      smsSenders,
    });
    // smsSenders read at dispatch time only; not a re-fire trigger.
  }, [
    availableDrafts,
    baselineAlias,
    baselineBody,
    baselineBodyHtml,
    baselineSubject,
    composerPane,
    state,
  ]);

  useEffect(() => {
    if (composerPane.mode === "closed") {
      return;
    }

    const draftIdentity = resolveCurrentDraftIdentity({
      composerPane,
      state,
    });

    if (draftIdentity === null) {
      return;
    }

    const hasPersistableContent =
      draftIdentity.channel === "sms"
        ? state.smsBody.trim().length > 0
        : draftIdentity.channel === "note"
          ? state.body.trim().length > 0
          : state.subject.trim() !== baselineSubject.trim() ||
            state.body.trim() !== baselineBody.trim() ||
            state.bodyHtml.trim() !== baselineBodyHtml.trim() ||
            state.cc.length > 0 ||
            state.bcc.length > 0 ||
            state.selectedAlias !== baselineAlias ||
            state.attachments.length > 0 ||
            state.aiDirective.trim().length > 0;

    const payload = {
      pane_mode:
        draftIdentity.paneMode === "new-draft"
          ? "new_draft"
          : draftIdentity.paneMode,
      channel: draftIdentity.channel,
      recipient_anchor_kind: draftIdentity.recipientAnchorKind,
      recipient_contact_id: draftIdentity.recipientContactId,
      recipient_email: draftIdentity.recipientEmail,
      recipient_phone: draftIdentity.recipientPhone,
      subject: draftIdentity.channel === "email" ? state.subject : "",
      body_plaintext:
        draftIdentity.channel === "sms" ? state.smsBody : state.body,
      body_html: draftIdentity.channel === "email" ? state.bodyHtml : "",
      selected_alias: draftIdentity.channel === "email" ? state.selectedAlias : null,
      cc:
        draftIdentity.channel === "email"
          ? state.cc.flatMap((recipient) => {
              const email = resolveRecipientEmailAddress(recipient);
              return email === null ? [] : [email];
            })
          : [],
      bcc:
        draftIdentity.channel === "email"
          ? state.bcc.flatMap((recipient) => {
              const email = resolveRecipientEmailAddress(recipient);
              return email === null ? [] : [email];
            })
          : [],
      attachments:
        draftIdentity.channel === "email"
          ? state.attachments.map((attachment) => ({
              filename: attachment.filename,
              size: attachment.size,
              contentType: attachment.contentType,
            }))
          : [],
      ai_directive: draftIdentity.channel === "email" ? state.aiDirective : "",
      reply_context_thread_cursor:
        composerPane.mode === "replying" ? replyContext?.threadCursor ?? null : null,
      forward_context:
        composerPane.mode === "forwarding" ? forwardContext ?? null : null,
    } as const;

    const persistenceEpoch = persistenceEpochRef.current;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (!hasPersistableContent) {
          const existingDraftId = draftIdRef.current;

          if (existingDraftId === null) {
            return;
          }

          const result = await deleteComposerDraftAction({ id: existingDraftId });
          if (result.ok) {
            draftIdRef.current = null;
            setAvailableDrafts((currentDrafts) =>
              removeDraftFromCache(currentDrafts, existingDraftId),
            );
            removeDraft(existingDraftId);
            return;
          }

          console.error("[composer/drafts] failed to delete cleared draft", result);
          return;
        }

        const result = await upsertComposerDraftAction({
          id: draftIdRef.current,
          ...payload,
        });

        if (!result.ok) {
          if (result.code === "composer_draft_not_found") {
            draftIdRef.current = null;
          }
          console.error("[composer/drafts] failed to upsert draft", result);
          return;
        }

        if (persistenceEpoch !== persistenceEpochRef.current) {
          await deleteComposerDraftAction({ id: result.data.id });
          return;
        }

        draftIdRef.current = result.data.id;
        setAvailableDrafts((currentDrafts) =>
          upsertDraftCache(currentDrafts, result.data),
        );
        upsertDraft(
          toDraftListItemViewModel({
            draft: result.data,
            composerPane,
            state,
            replyContext,
            forwardContext,
          }),
        );
      })();
    }, 750);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    baselineAlias,
    baselineBody,
    baselineBodyHtml,
    baselineSubject,
    composerPane,
    forwardContext,
    removeDraft,
    replyContext,
    state,
    upsertDraft,
  ]);

  return {
    state,
    dispatch,
    draftIdRef,
    invalidateDraftPersistence,
    isReplying,
    replyContext,
  };
}
