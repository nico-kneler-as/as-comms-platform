"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import type { ClaudeInboxBucket } from "../_lib/view-models";

/**
 * Prototype-local client state shared across the Inbox list column and
 * Detail workspace. In a real build these would round-trip through server
 * actions; for the prototype we keep them in React context so toggling a
 * button in one panel immediately reflects in the other.
 *
 * Extended to cover every interactive state the UI needs:
 *   - follow-up flags and reminders (original)
 *   - search query + results
 *   - active bucket tab (new / opened)
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

interface ClaudeInboxClientState {
  // Follow-up & reminders
  readonly followUp: ReadonlySet<string>;
  readonly reminders: ReadonlyMap<string, Reminder>;
  readonly toggleFollowUp: (contactId: string) => void;
  readonly setReminder: (contactId: string, reminder: Reminder) => void;
  readonly clearReminder: (contactId: string) => void;

  // Bucket tabs
  readonly activeBucket: ClaudeInboxBucket | "all";
  readonly setActiveBucket: (bucket: ClaudeInboxBucket | "all") => void;

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

const ClaudeInboxClientContext = createContext<ClaudeInboxClientState | null>(
  null
);

export function ClaudeInboxClientProvider({
  children
}: {
  readonly children: ReactNode;
}) {
  // Follow-up & reminders
  const [followUp, setFollowUp] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [reminders, setReminders] = useState<ReadonlyMap<string, Reminder>>(
    () => new Map<string, Reminder>()
  );

  const toggleFollowUp = useCallback((contactId: string) => {
    setFollowUp((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  }, []);

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

  // Bucket tabs
  const [activeBucket, setActiveBucket] = useState<ClaudeInboxBucket | "all">(
    "all"
  );

  // Search
  const [search, setSearch] = useState<SearchState>(INITIAL_SEARCH);

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
  const [aiDraft, setAiDraft] = useState<AiDraftState>(INITIAL_AI_DRAFT);

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

  const value = useMemo<ClaudeInboxClientState>(
    () => ({
      followUp,
      reminders,
      toggleFollowUp,
      setReminder,
      clearReminder,
      activeBucket,
      setActiveBucket,
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
      followUp,
      reminders,
      toggleFollowUp,
      setReminder,
      clearReminder,
      activeBucket,
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
    <ClaudeInboxClientContext.Provider value={value}>
      {children}
    </ClaudeInboxClientContext.Provider>
  );
}

export function useClaudeInboxClient(): ClaudeInboxClientState {
  const value = useContext(ClaudeInboxClientContext);
  if (!value) {
    throw new Error(
      "useClaudeInboxClient must be used inside ClaudeInboxClientProvider"
    );
  }
  return value;
}
