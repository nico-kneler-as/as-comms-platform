"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import type {
  AiDraftRequestPayload,
  AiDraftResponseVm,
} from "../actions";
import type {
  InboxComposerAliasOption,
  InboxComposerReplyContext
} from "../_lib/view-models";
import {
  reduceComposerPane,
  type ComposerPaneState
} from "../_lib/composer-ui";

/**
 * Ephemeral Inbox UI state shared across the list column and detail workspace.
 * This stays strictly session-local by design.
 */

export interface Reminder {
  readonly value: number;
  readonly unit: "hours" | "days" | "weeks";
  readonly firesAt: string;
}

export type ComposerStatus =
  | "idle"
  | "saving-draft"
  | "draft-saved"
  | "validation-error"
  | "sending"
  | "sent-success"
  | "send-failure";

export interface ComposerValidationError {
  readonly field: "subject" | "body" | "recipient" | "alias" | "attachments";
  readonly message: string;
}

export type AiDraftStatus =
  | "idle"
  | "generating"
  | "inserted"
  | "reprompting"
  | "edited-after-generation"
  | "discarded"
  | "unavailable"
  | "error";

export interface AiDraftState {
  readonly status: AiDraftStatus;
  readonly mode: AiDraftRequestPayload["mode"] | null;
  readonly responseMode: AiDraftResponseVm["mode"] | null;
  readonly prompt: string;
  readonly generatedText: string;
  readonly errorMessage: string | null;
  readonly grounding: AiDraftResponseVm["grounding"];
  readonly warnings: AiDraftResponseVm["warnings"];
  readonly costEstimateUsd: number | null;
  readonly draftId: string | null;
  readonly repromptIndex: number;
  readonly repromptChain: readonly {
    readonly direction: string;
    readonly draft: string;
  }[];
  readonly promptPreview: string;
  readonly model: AiDraftResponseVm["model"] | null;
  readonly lastRequest: AiDraftRequestPayload | null;
}

const INITIAL_AI_DRAFT: AiDraftState = {
  status: "idle",
  mode: null,
  responseMode: null,
  prompt: "",
  generatedText: "",
  errorMessage: null,
  grounding: [],
  warnings: [],
  costEstimateUsd: null,
  draftId: null,
  repromptIndex: 0,
  repromptChain: [],
  promptPreview: "",
  model: null,
  lastRequest: null,
};

export interface SearchState {
  readonly query: string;
  readonly isActive: boolean;
  readonly resultContactIds: readonly string[];
}

const INITIAL_SEARCH: SearchState = {
  query: "",
  isActive: false,
  resultContactIds: []
};

export interface InboxToastState {
  readonly id: number;
  readonly message: string;
  readonly tone: "success" | "error";
}

interface InboxClientState {
  readonly currentActorId: string;
  readonly reminders: ReadonlyMap<string, Reminder>;
  readonly setReminder: (contactId: string, reminder: Reminder) => void;
  readonly clearReminder: (contactId: string) => void;

  readonly search: SearchState;
  readonly setSearchQuery: (query: string) => void;
  readonly setSearchResults: (contactIds: readonly string[]) => void;
  readonly clearSearch: () => void;

  readonly isQueueLoading: boolean;
  readonly setQueueLoading: (loading: boolean) => void;
  readonly isTimelineLoading: boolean;
  readonly setTimelineLoading: (loading: boolean) => void;

  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly composerPane: ComposerPaneState;
  readonly openNewDraft: () => void;
  readonly openReplyDraft: (replyContext: InboxComposerReplyContext) => void;
  readonly closeComposer: () => void;

  readonly composerStatus: ComposerStatus;
  readonly composerErrors: readonly ComposerValidationError[];
  readonly setComposerStatus: (status: ComposerStatus) => void;
  readonly setComposerErrors: (errors: readonly ComposerValidationError[]) => void;

  readonly toast: InboxToastState | null;
  readonly showToast: (
    message: string,
    tone?: InboxToastState["tone"]
  ) => void;
  readonly clearToast: () => void;

  readonly aiDraft: AiDraftState;
  readonly startAiGeneration: (input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => void;
  readonly insertAiDraft: (input: {
    readonly request: AiDraftRequestPayload;
    readonly response: AiDraftResponseVm;
    readonly prompt: string;
    readonly repromptDirection?: string;
  }) => void;
  readonly markAiDraftEdited: () => void;
  readonly discardAiDraft: () => void;
  readonly repromptAi: (input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => void;
  readonly setAiUnavailable: () => void;
  readonly setAiError: (message: string) => void;
  readonly resetAiDraft: () => void;
}

const InboxClientContext = createContext<InboxClientState | null>(null);

export function InboxClientProvider({
  children,
  composerAliases,
  currentActorId,
}: {
  readonly children: ReactNode;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly currentActorId: string;
}) {
  const [reminders, setReminders] = useState<ReadonlyMap<string, Reminder>>(
    () => new Map<string, Reminder>()
  );
  const [search, setSearch] = useState(INITIAL_SEARCH);
  const [isQueueLoading, setQueueLoading] = useState(false);
  const [isTimelineLoading, setTimelineLoading] = useState(false);
  const [composerPane, setComposerPane] = useState<ComposerPaneState>({
    mode: "closed"
  });
  const [composerStatus, setComposerStatus] = useState<ComposerStatus>("idle");
  const [composerErrors, setComposerErrors] = useState<
    readonly ComposerValidationError[]
  >([]);
  const [toast, setToast] = useState<InboxToastState | null>(null);
  const [aiDraft, setAiDraft] = useState(INITIAL_AI_DRAFT);

  const setReminder = useCallback((contactId: string, reminder: Reminder) => {
    setReminders((previous) => {
      const next = new Map(previous);
      next.set(contactId, reminder);
      return next;
    });
  }, []);

  const clearReminder = useCallback((contactId: string) => {
    setReminders((previous) => {
      if (!previous.has(contactId)) {
        return previous;
      }

      const next = new Map(previous);
      next.delete(contactId);
      return next;
    });
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setSearch((previous) => ({
      ...previous,
      query,
      isActive: query.length > 0
    }));
  }, []);

  const setSearchResults = useCallback((contactIds: readonly string[]) => {
    setSearch((previous) => ({
      ...previous,
      resultContactIds: contactIds
    }));
  }, []);

  const clearSearch = useCallback(() => {
    setSearch(INITIAL_SEARCH);
  }, []);

  const openNewDraft = useCallback(() => {
    setComposerPane((previous) =>
      reduceComposerPane(previous, {
        type: "open-new-draft"
      })
    );
    setComposerStatus("idle");
    setComposerErrors([]);
  }, []);

  const openReplyDraft = useCallback(
    (replyContext: InboxComposerReplyContext) => {
      setComposerPane((previous) =>
        reduceComposerPane(previous, {
          type: "open-reply",
          replyContext
        })
      );
      setComposerStatus("idle");
      setComposerErrors([]);
    },
    []
  );

  const closeComposer = useCallback(() => {
    setComposerPane((previous) =>
      reduceComposerPane(previous, {
        type: "close"
      })
    );
    setComposerStatus("idle");
    setComposerErrors([]);
  }, []);

  const showToast = useCallback(
    (message: string, tone: InboxToastState["tone"] = "success") => {
      setToast({
        id: Date.now(),
        message,
        tone
      });
    },
    []
  );

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const startAiGeneration = useCallback((input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => {
    setAiDraft({
      status: "generating",
      mode: input.request.mode,
      responseMode: null,
      prompt: input.prompt,
      generatedText: "",
      errorMessage: null,
      grounding: [],
      warnings: [],
      costEstimateUsd: null,
      draftId: null,
      repromptIndex: input.request.repromptIndex ?? 0,
      repromptChain: [],
      promptPreview: "",
      model: null,
      lastRequest: input.request,
    });
  }, []);

  const insertAiDraft = useCallback((input: {
    readonly request: AiDraftRequestPayload;
    readonly response: AiDraftResponseVm;
    readonly prompt: string;
    readonly repromptDirection?: string;
  }) => {
    setAiDraft((previous) => ({
      ...previous,
      status: "inserted",
      mode: input.request.mode,
      responseMode: input.response.mode,
      prompt: input.prompt,
      generatedText: input.response.draft,
      errorMessage: null,
      grounding: input.response.grounding,
      warnings: input.response.warnings,
      costEstimateUsd: input.response.costEstimateUsd,
      draftId: input.response.draftId,
      repromptIndex: input.response.repromptIndex,
      repromptChain:
        input.request.mode === "reprompt" && input.repromptDirection
          ? [
              ...previous.repromptChain,
              {
                direction: input.repromptDirection,
                draft: input.response.draft,
              },
            ]
          : previous.repromptChain,
      promptPreview: input.response.promptPreview,
      model: input.response.model,
      lastRequest: input.request,
    }));
  }, []);

  const markAiDraftEdited = useCallback(() => {
    setAiDraft((previous) => ({
      ...previous,
      status: "edited-after-generation"
    }));
  }, []);

  const discardAiDraft = useCallback(() => {
    setAiDraft((previous) => ({
      ...previous,
      status: "discarded",
      generatedText: ""
    }));
  }, []);

  const repromptAi = useCallback((input: {
    readonly request: AiDraftRequestPayload;
    readonly prompt: string;
  }) => {
    setAiDraft((previous) => ({
      ...previous,
      status: "reprompting",
      mode: "reprompt",
      prompt: input.prompt,
      errorMessage: null,
      lastRequest: input.request,
      repromptIndex: input.request.repromptIndex ?? previous.repromptIndex,
    }));
  }, []);

  const setAiUnavailable = useCallback(() => {
    setAiDraft((previous) => ({
      ...previous,
      status: "unavailable",
      errorMessage: "AI drafting is currently unavailable."
    }));
  }, []);

  const setAiError = useCallback((message: string) => {
    setAiDraft((previous) => ({
      ...previous,
      status: "error",
      errorMessage: message
    }));
  }, []);

  const resetAiDraft = useCallback(() => {
    setAiDraft(INITIAL_AI_DRAFT);
  }, []);

  const value = useMemo<InboxClientState>(
    () => ({
      currentActorId,
      reminders,
      setReminder,
      clearReminder,
      search,
      setSearchQuery,
      setSearchResults,
      clearSearch,
      isQueueLoading,
      setQueueLoading,
      isTimelineLoading,
      setTimelineLoading,
      composerAliases,
      composerPane,
      openNewDraft,
      openReplyDraft,
      closeComposer,
      composerStatus,
      composerErrors,
      setComposerStatus,
      setComposerErrors,
      toast,
      showToast,
      clearToast,
      aiDraft,
      startAiGeneration,
      insertAiDraft,
      markAiDraftEdited,
      discardAiDraft,
      repromptAi,
      setAiUnavailable,
      setAiError,
      resetAiDraft
    }),
    [
      currentActorId,
      reminders,
      setReminder,
      clearReminder,
      search,
      setSearchQuery,
      setSearchResults,
      clearSearch,
      isQueueLoading,
      isTimelineLoading,
      composerAliases,
      composerPane,
      openNewDraft,
      openReplyDraft,
      closeComposer,
      composerStatus,
      composerErrors,
      toast,
      showToast,
      clearToast,
      aiDraft,
      startAiGeneration,
      insertAiDraft,
      markAiDraftEdited,
      discardAiDraft,
      repromptAi,
      setAiUnavailable,
      setAiError,
      resetAiDraft
    ]
  );

  return (
    <InboxClientContext.Provider value={value}>
      {children}
    </InboxClientContext.Provider>
  );
}

export function useInboxClient(): InboxClientState {
  const value = useContext(InboxClientContext);

  if (!value) {
    throw new Error("useInboxClient must be used inside InboxClientProvider");
  }

  return value;
}
