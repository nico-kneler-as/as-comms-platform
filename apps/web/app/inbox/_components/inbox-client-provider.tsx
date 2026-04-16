"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

/**
 * Prototype-local client state shared across the Inbox list column and
 * Detail workspace. These are intentionally ephemeral UI concerns only.
 *
 * Extended to cover every interactive state the UI needs:
 *   - reminders
 *   - search query + results
 *   - composer status (idle → saving → saved / error → sending → sent / failed)
 *   - AI draft lifecycle (idle → generating → inserted → edited / discarded)
 *   - queue & timeline loading flags
 */

// ---------- Reminder ----------

export interface Reminder {
  readonly value: number;
  readonly unit: "hours" | "days" | "weeks";
  readonly firesAt: string;
}

// ---------- Composer status ----------

export type ComposerStatus =
  | "idle"
  | "saving-draft"
  | "draft-saved"
  | "validation-error"
  | "sending"
  | "sent-success"
  | "send-failure";

export interface ComposerValidationError {
  readonly field: "subject" | "body" | "recipient";
  readonly message: string;
}

// ---------- AI draft lifecycle ----------

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
  readonly prompt: string;
  readonly generatedText: string;
  readonly errorMessage: string | null;
}

const INITIAL_AI_DRAFT: AiDraftState = {
  status: "idle",
  prompt: "",
  generatedText: "",
  errorMessage: null
};

// ---------- Search ----------

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

// ---------- Context shape ----------

interface InboxClientState {
  // Reminders
  readonly reminders: ReadonlyMap<string, Reminder>;
  readonly setReminder: (contactId: string, reminder: Reminder) => void;
  readonly clearReminder: (contactId: string) => void;

  // Search
  readonly search: SearchState;
  readonly setSearchQuery: (query: string) => void;
  readonly setSearchResults: (contactIds: readonly string[]) => void;
  readonly clearSearch: () => void;

  // Loading flags
  readonly isQueueLoading: boolean;
  readonly setQueueLoading: (loading: boolean) => void;
  readonly isTimelineLoading: boolean;
  readonly setTimelineLoading: (loading: boolean) => void;

  // Composer status
  readonly composerStatus: ComposerStatus;
  readonly composerErrors: readonly ComposerValidationError[];
  readonly setComposerStatus: (status: ComposerStatus) => void;
  readonly setComposerErrors: (errors: readonly ComposerValidationError[]) => void;

  // AI drafting
  readonly aiDraft: AiDraftState;
  readonly startAiGeneration: (prompt: string) => void;
  readonly insertAiDraft: (text: string) => void;
  readonly markAiDraftEdited: () => void;
  readonly discardAiDraft: () => void;
  readonly repromptAi: (prompt: string) => void;
  readonly setAiUnavailable: () => void;
  readonly setAiError: (message: string) => void;
  readonly resetAiDraft: () => void;
}

const InboxClientContext = createContext<InboxClientState | null>(
  null
);

export function InboxClientProvider({
  children
}: {
  readonly children: ReactNode;
}) {
  // Reminders
  const [reminders, setReminders] = useState<ReadonlyMap<string, Reminder>>(
    () => new Map<string, Reminder>()
  );

  const setReminder = useCallback((contactId: string, reminder: Reminder) => {
    setReminders((prev) => {
      const next = new Map(prev);
      next.set(contactId, reminder);
      return next;
    });
  }, []);

  const clearReminder = useCallback((contactId: string) => {
    setReminders((prev) => {
      if (!prev.has(contactId)) return prev;
      const next = new Map(prev);
      next.delete(contactId);
      return next;
    });
  }, []);

  // Search
  const [search, setSearch] = useState(INITIAL_SEARCH);

  const setSearchQuery = useCallback((query: string) => {
    setSearch((prev) => ({
      ...prev,
      query,
      isActive: query.length > 0
    }));
  }, []);

  const setSearchResults = useCallback((contactIds: readonly string[]) => {
    setSearch((prev) => ({
      ...prev,
      resultContactIds: contactIds
    }));
  }, []);

  const clearSearch = useCallback(() => {
    setSearch(INITIAL_SEARCH);
  }, []);

  // Loading flags
  const [isQueueLoading, setQueueLoading] = useState(false);
  const [isTimelineLoading, setTimelineLoading] = useState(false);

  // Composer status
  const [composerStatus, setComposerStatus] = useState<ComposerStatus>("idle");
  const [composerErrors, setComposerErrors] = useState<
    readonly ComposerValidationError[]
  >([]);

  // AI draft lifecycle
  const [aiDraft, setAiDraft] = useState(INITIAL_AI_DRAFT);

  const startAiGeneration = useCallback((prompt: string) => {
    setAiDraft({
      status: "generating",
      prompt,
      generatedText: "",
      errorMessage: null
    });
  }, []);

  const insertAiDraft = useCallback((text: string) => {
    setAiDraft((prev) => ({
      ...prev,
      status: "inserted",
      generatedText: text
    }));
  }, []);

  const markAiDraftEdited = useCallback(() => {
    setAiDraft((prev) => ({
      ...prev,
      status: "edited-after-generation"
    }));
  }, []);

  const discardAiDraft = useCallback(() => {
    setAiDraft((prev) => ({
      ...prev,
      status: "discarded",
      generatedText: ""
    }));
  }, []);

  const repromptAi = useCallback((prompt: string) => {
    setAiDraft({
      status: "reprompting",
      prompt,
      generatedText: "",
      errorMessage: null
    });
  }, []);

  const setAiUnavailable = useCallback(() => {
    setAiDraft((prev) => ({
      ...prev,
      status: "unavailable",
      errorMessage: "AI drafting is currently unavailable."
    }));
  }, []);

  const setAiError = useCallback((message: string) => {
    setAiDraft((prev) => ({
      ...prev,
      status: "error",
      errorMessage: message
    }));
  }, []);

  const resetAiDraft = useCallback(() => {
    setAiDraft(INITIAL_AI_DRAFT);
  }, []);

  const value = useMemo<InboxClientState>(
    () => ({
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
      composerStatus,
      composerErrors,
      setComposerStatus,
      setComposerErrors,
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
      reminders,
      setReminder,
      clearReminder,
      search,
      setSearchQuery,
      setSearchResults,
      clearSearch,
      isQueueLoading,
      isTimelineLoading,
      composerStatus,
      composerErrors,
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
    throw new Error(
      "useInboxClient must be used inside InboxClientProvider"
    );
  }
  return value;
}
