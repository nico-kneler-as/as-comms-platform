"use client";

import { useEffect, useId, useRef, useState } from "react";

import { toE164 } from "@as-comms/domain/phone";

import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";

import { searchContactsAction, type ContactSearchResult } from "../actions";
import type { ComposerSmsRecipient } from "../_hooks/composer-draft-reducer";
import { SearchIcon, XIcon } from "./icons";

interface SmsContactSearchResult extends ContactSearchResult {
  readonly primaryPhone: string;
}

function toSmsContactResult(
  result: ContactSearchResult,
): SmsContactSearchResult | null {
  return result.primaryPhone === null
    ? null
    : {
        ...result,
        primaryPhone: result.primaryPhone,
      };
}

function formatPhoneLabel(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  const nationalNumber =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;

  return nationalNumber === null
    ? phoneE164
    : `(${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
}

function isSameRecipient(
  left: ComposerSmsRecipient,
  right: ComposerSmsRecipient,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "contact" && right.kind === "contact") {
    return left.contactId === right.contactId;
  }

  return left.phoneE164 === right.phoneE164;
}

function getContactInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);

  const initials =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`
      : (parts[0]?.slice(0, 2) ?? "");

  return initials.toUpperCase();
}

export function ComposerSmsRecipientPicker({
  recipient,
  locked = false,
  errorMessage,
  onRecipientChange,
}: {
  readonly recipient: ComposerSmsRecipient | null;
  readonly locked?: boolean;
  readonly errorMessage?: string;
  readonly onRecipientChange: (recipient: ComposerSmsRecipient | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SmsContactSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const activeSearchIdRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (rootRef.current?.contains(target) === true) {
        return;
      }

      setIsResultsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (locked || recipient !== null) {
      activeSearchIdRef.current += 1;
      setQuery("");
      setResults([]);
      setIsSearching(false);
      setIsResultsOpen(false);
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      activeSearchIdRef.current += 1;
      setResults([]);
      setIsSearching(false);
      setIsResultsOpen(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const searchId = activeSearchIdRef.current + 1;
      activeSearchIdRef.current = searchId;
      setIsSearching(true);

      void (async () => {
        try {
          const result = await searchContactsAction(trimmedQuery);
          if (activeSearchIdRef.current !== searchId) {
            return;
          }

          setResults(
            result.ok
              ? result.data
                  .map(toSmsContactResult)
                  .filter(
                    (candidate): candidate is SmsContactSearchResult =>
                      candidate !== null,
                  )
              : [],
          );
        } finally {
          if (activeSearchIdRef.current === searchId) {
            setIsSearching(false);
          }
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [locked, query, recipient]);

  const commitTypedPhone = (): boolean => {
    const normalized = toE164(query);
    if (normalized === null) {
      return false;
    }

    const nextRecipient: ComposerSmsRecipient = {
      kind: "phone",
      phoneE164: normalized,
    };

    if (recipient !== null && isSameRecipient(recipient, nextRecipient)) {
      return true;
    }

    onRecipientChange(nextRecipient);
    setQuery("");
    setResults([]);
    setIsResultsOpen(false);
    return true;
  };

  const shouldShowInput = !locked && recipient === null;
  const shouldShowResults =
    isResultsOpen &&
    shouldShowInput &&
    (isSearching || results.length > 0 || query.trim().length >= 2);

  return (
    <div className="space-y-1.5">
      <div ref={rootRef} className="relative">
        <div
          className={cn(
            `flex min-h-8 flex-wrap items-center gap-1.5 rounded-md bg-white px-0 py-0.5`,
            errorMessage ? "border border-rose-300 px-2 ring-1 ring-rose-200" : "",
          )}
        >
          {recipient ? (
            <RecipientChip
              recipient={recipient}
              locked={locked}
              onClear={() => {
                if (!locked) {
                  onRecipientChange(null);
                }
              }}
            />
          ) : null}

          {shouldShowInput ? (
            <div className="flex min-w-[14rem] flex-1 items-center">
              <SearchIcon className="pointer-events-none mr-2 size-3.5 shrink-0 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setIsResultsOpen(true);
                }}
                onFocus={() => {
                  if (query.trim().length >= 2 || results.length > 0) {
                    setIsResultsOpen(true);
                  }
                }}
                onBlur={() => {
                  void commitTypedPhone();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }

                  event.preventDefault();
                  void commitTypedPhone();
                }}
                placeholder="Search contacts"
                aria-expanded={shouldShowResults}
                aria-controls={shouldShowResults ? listboxId : undefined}
                aria-autocomplete="list"
                className={cn(
                  `h-7 flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none ${FOCUS_RING}`,
                )}
              />
            </div>
          ) : null}
        </div>

        {shouldShowResults ? (
          <div
            className={`absolute inset-x-0 top-full z-20 mt-1 overflow-hidden border border-slate-200 bg-white ${RADIUS.md} ${SHADOW.md}`}
          >
            {isSearching ? (
              <div className="px-3 py-3 text-sm text-slate-500">
                Searching contacts...
              </div>
            ) : results.length > 0 ? (
              <ul
                id={listboxId}
                role="listbox"
                className="max-h-64 divide-y divide-slate-100 overflow-y-auto"
              >
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => {
                        onRecipientChange({
                          kind: "contact",
                          contactId: result.id,
                          displayName: result.displayName,
                          phoneE164: result.primaryPhone,
                        });
                        setQuery("");
                        setResults([]);
                        setIsResultsOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-1.5 text-left ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-50`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[10px] font-semibold text-sky-700">
                          {getContactInitials(result.displayName)}
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-[13px] font-semibold leading-4 text-slate-900">
                              {result.displayName}
                            </span>
                            <span className="truncate text-[12px] leading-4 text-slate-500">
                              {formatPhoneLabel(result.primaryPhone)}
                            </span>
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3 py-3 text-sm text-slate-500">
                No matching phone contacts.
              </div>
            )}
          </div>
        ) : null}
      </div>
      {errorMessage ? <p className="text-xs text-rose-700">{errorMessage}</p> : null}
    </div>
  );
}

function RecipientChip({
  recipient,
  locked,
  onClear,
}: {
  readonly recipient: ComposerSmsRecipient;
  readonly locked: boolean;
  readonly onClear: () => void;
}) {
  const label =
    recipient.kind === "contact"
      ? `${recipient.displayName} (${formatPhoneLabel(recipient.phoneE164)})`
      : formatPhoneLabel(recipient.phoneE164);

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1.5 text-[12px] text-slate-700">
      <span className="min-w-0 truncate font-medium text-slate-900">
        {label}
      </span>
      {recipient.kind === "phone" ? <Chip tone="neutral">external</Chip> : null}
      {!locked ? (
        <button
          type="button"
          aria-label="Clear recipient"
          className={cn(
            `inline-flex size-5 items-center justify-center rounded-full text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-200 hover:text-slate-700`,
          )}
          onClick={onClear}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
