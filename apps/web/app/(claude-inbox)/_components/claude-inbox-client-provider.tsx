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
 * Prototype-local client state that needs to be shared between the Inbox
 * list column and the Detail workspace — mostly interaction state that, in
 * a real build, would round-trip through a server action and land on the
 * canonical projection. For now we keep it in React context so toggling
 * "Needs Follow Up" in the detail view immediately updates the left column
 * and a reminder set on one contact persists while the operator browses.
 */

export interface Reminder {
  readonly value: number;
  readonly unit: "hours" | "days" | "weeks";
  /** ISO timestamp so the popover can render a relative label. */
  readonly firesAt: string;
}

interface ClaudeInboxClientState {
  readonly followUp: ReadonlySet<string>;
  readonly reminders: ReadonlyMap<string, Reminder>;
  readonly toggleFollowUp: (contactId: string) => void;
  readonly setReminder: (contactId: string, reminder: Reminder) => void;
  readonly clearReminder: (contactId: string) => void;
}

const ClaudeInboxClientContext = createContext<ClaudeInboxClientState | null>(
  null
);

export function ClaudeInboxClientProvider({
  children
}: {
  readonly children: ReactNode;
}) {
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

  const value = useMemo<ClaudeInboxClientState>(
    () => ({
      followUp,
      reminders,
      toggleFollowUp,
      setReminder,
      clearReminder
    }),
    [followUp, reminders, toggleFollowUp, setReminder, clearReminder]
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
