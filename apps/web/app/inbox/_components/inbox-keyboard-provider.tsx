"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent
} from "@/components/ui/popover";

import {
  extractInboxContactId,
  getAdjacentFocusedRowContactId,
  getPreferredFocusedRowContactId,
  INBOX_FOLLOW_UP_TOGGLE_SELECTOR,
  INBOX_LIST_ROOT_SELECTOR,
  INBOX_ROW_SELECTOR,
  INBOX_SEARCH_INPUT_SELECTOR,
  isEditableShortcutTarget,
  isInboxKeyboardPath
} from "./inbox-keyboard-helpers";
import { useInboxClient } from "./inbox-client-provider";
import { XIcon } from "./icons";

interface InboxKeyboardProviderProps {
  readonly children: ReactNode;
}

interface RowTarget {
  readonly contactId: string;
  readonly element: HTMLElement;
}

const SHORTCUTS = [
  { key: "J", description: "Focus the next conversation" },
  { key: "K", description: "Focus the previous conversation" },
  { key: "Enter", description: "Open the focused conversation" },
  { key: "C", description: "Open a new draft" },
  { key: "Esc", description: "Return to the inbox list" },
  { key: "F", description: "Toggle Needs Follow-Up" },
  { key: "/", description: "Focus search" },
  { key: "?", description: "Show this shortcuts list" }
] as const;

export function InboxKeyboardProvider({
  children
}: InboxKeyboardProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const lastFocusedContactIdRef = useRef<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { composerPane, closeComposer, openNewDraft } = useInboxClient();

  const getRowTargets = useCallback((): readonly RowTarget[] => {
    const root = rootRef.current;

    if (!root) {
      return [];
    }

    return Array.from(root.querySelectorAll<HTMLElement>(INBOX_ROW_SELECTOR))
      .map((element) => ({
        element,
        contactId: element.dataset.contactId ?? ""
      }))
      .filter((target) => target.contactId.length > 0);
  }, []);

  const getCurrentFocusedContactId = useCallback((): string | null => {
    const root = rootRef.current;

    if (!root) {
      return lastFocusedContactIdRef.current;
    }

    const activeElement = root.ownerDocument.activeElement;

    if (!(activeElement instanceof HTMLElement)) {
      return lastFocusedContactIdRef.current;
    }

    const row = activeElement.closest<HTMLElement>(INBOX_ROW_SELECTOR);

    return row?.dataset.contactId ?? lastFocusedContactIdRef.current;
  }, []);

  const focusAdjacentRow = useCallback(
    (direction: 1 | -1) => {
      const rows = getRowTargets();
      const nextContactId = getAdjacentFocusedRowContactId({
        rowContactIds: rows.map((row) => row.contactId),
        currentFocusedContactId: getCurrentFocusedContactId(),
        activeContactId: extractInboxContactId(pathname),
        direction
      });

      if (nextContactId === null) {
        return;
      }

      const nextRow = rows.find((row) => row.contactId === nextContactId);

      if (!nextRow) {
        return;
      }

      lastFocusedContactIdRef.current = nextContactId;
      nextRow.element.focus();
      nextRow.element.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    },
    [getCurrentFocusedContactId, getRowTargets, pathname]
  );

  const openFocusedRow = useCallback(() => {
    const rows = getRowTargets();
    const contactId = getPreferredFocusedRowContactId({
      rowContactIds: rows.map((row) => row.contactId),
      currentFocusedContactId: getCurrentFocusedContactId(),
      activeContactId: extractInboxContactId(pathname)
    });

    if (contactId === null) {
      return;
    }

    router.push(`/inbox/${encodeURIComponent(contactId)}`, {
      scroll: false
    });
  }, [getCurrentFocusedContactId, getRowTargets, pathname, router]);

  const focusSearch = useCallback(() => {
    const root = rootRef.current;
    const input = root?.querySelector<HTMLInputElement>(
      INBOX_SEARCH_INPUT_SELECTOR
    );

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, []);

  const triggerFollowUpToggle = useCallback(() => {
    const root = rootRef.current;
    const button = root?.querySelector<HTMLButtonElement>(
      INBOX_FOLLOW_UP_TOGGLE_SELECTOR
    );

    if (!button || button.disabled) {
      return;
    }

    button.click();
  }, []);

  const isListFocused = useCallback((target: HTMLElement | null): boolean => {
    const root = rootRef.current;
    const listRoot = root?.querySelector<HTMLElement>(INBOX_LIST_ROOT_SELECTOR);

    if (!listRoot || target === null) {
      return false;
    }

    return listRoot.contains(target);
  }, []);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const row = target.closest<HTMLElement>(INBOX_ROW_SELECTOR);

      if (row?.dataset.contactId) {
        lastFocusedContactIdRef.current = row.dataset.contactId;
      }
    };

    root.addEventListener("focusin", handleFocusIn);

    return () => {
      root.removeEventListener("focusin", handleFocusIn);
    };
  }, []);

  useEffect(() => {
    if (!isInboxKeyboardPath(pathname)) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target =
        event.target instanceof HTMLElement ? event.target : null;
      const targetMeta = {
        tagName: target?.closest("input, textarea, select")?.tagName ??
          target?.tagName ??
          null,
        isContentEditable:
          target?.isContentEditable === true ||
          target?.closest("[contenteditable='true']") !== null
      };
      const isEditable = isEditableShortcutTarget(targetMeta);

      if (event.key === "?") {
        if (isEditable) {
          return;
        }

        event.preventDefault();
        setShortcutsOpen((previous) => !previous);
        return;
      }

      if (event.key === "Escape") {
        if (shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen(false);
        }

        if (composerPane.mode !== "closed") {
          event.preventDefault();
          closeComposer();
          return;
        }

        if (pathname !== "/inbox") {
          event.preventDefault();
          router.push("/inbox", { scroll: false });
        }
        return;
      }

      if (isEditable) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case "j":
          event.preventDefault();
          focusAdjacentRow(1);
          return;
        case "k":
          event.preventDefault();
          focusAdjacentRow(-1);
          return;
        case "c":
          if (!isListFocused(target)) {
            return;
          }

          event.preventDefault();
          openNewDraft();
          return;
        case "f":
          event.preventDefault();
          triggerFollowUpToggle();
          return;
        default:
          break;
      }

      if (event.key === "/") {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.key === "Enter") {
        const activeElement = target;
        const focusedRow = activeElement?.closest(INBOX_ROW_SELECTOR);
        const documentBody = rootRef.current?.ownerDocument.body ?? null;
        const shouldHandleEnter =
          activeElement === null ||
          focusedRow !== null ||
          activeElement === documentBody;

        if (!shouldHandleEnter) {
          return;
        }

        event.preventDefault();
        openFocusedRow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    focusAdjacentRow,
    focusSearch,
    openFocusedRow,
    pathname,
    router,
    shortcutsOpen,
    triggerFollowUpToggle,
    composerPane.mode,
    closeComposer,
    isListFocused,
    openNewDraft
  ]);

  return (
    <div
      ref={rootRef}
      className="relative flex h-dvh w-full overflow-hidden bg-slate-100 text-slate-900 antialiased"
    >
      <Popover open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-6 top-4 h-px w-px"
          />
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Keyboard shortcuts
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Gmail-style navigation for the inbox.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-700"
              aria-label="Close shortcuts"
              onClick={() => {
                setShortcutsOpen(false);
              }}
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </div>

          <ul className="mt-4 space-y-2">
            {SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.key}
                className="flex items-center justify-between gap-3 text-sm text-slate-700"
              >
                <span>{shortcut.description}</span>
                <kbd className="min-w-10 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-center text-[11px] font-semibold text-slate-600">
                  {shortcut.key}
                </kbd>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {children}
    </div>
  );
}
