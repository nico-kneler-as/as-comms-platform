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
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phoneE164);
  const area = match?.[1];
  const prefix = match?.[2];
  const line = match?.[3];
  return match === null
    ? phoneE164
    : `+1 (${area ?? ""}) ${prefix ?? ""}-${line ?? ""}`;
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
  const activeSearchIdRef = useRef(0);
  const listboxId = useId();

  useEffect(() => {
    if (locked || recipient !== null) {
      activeSearchIdRef.current += 1;
      setQuery("");
      setResults([]);
      setIsSearching(false);
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      activeSearchIdRef.current += 1;
      setResults([]);
      setIsSearching(false);
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
    return true;
  };

  const shouldShowInput = !locked && recipient === null;
  const shouldShowResults =
    shouldShowInput &&
    (isSearching || results.length > 0 || query.trim().length >= 2);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <div
          className={cn(
            `flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 ${RADIUS.md} ${SHADOW.sm}`,
            errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
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
              <SearchIcon className="pointer-events-none mr-2 size-4 shrink-0 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
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
                placeholder="Search contacts or type a phone number"
                aria-expanded={shouldShowResults}
                aria-controls={shouldShowResults ? listboxId : undefined}
                aria-autocomplete="list"
                className={cn(
                  `h-8 flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none ${FOCUS_RING}`,
                )}
              />
            </div>
          ) : null}
        </div>

        {shouldShowResults ? (
          <div
            className={`absolute inset-x-0 top-full z-20 mt-2 overflow-hidden border border-slate-200 bg-white ${RADIUS.md} ${SHADOW.md}`}
          >
            {isSearching ? (
              <div className="px-3 py-3 text-sm text-slate-500">
                Searching contacts...
              </div>
            ) : results.length > 0 ? (
              <ul
                id={listboxId}
                role="listbox"
                className="max-h-72 divide-y divide-slate-100 overflow-y-auto"
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
                      }}
                      className={`flex w-full items-start justify-between gap-3 px-3 py-3 text-left ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-50`}
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {result.displayName}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {formatPhoneLabel(result.primaryPhone)}
                        </span>
                      </div>
                      {result.salesforceContactId ? (
                        <Chip tone="neutral" className="uppercase">
                          SF
                        </Chip>
                      ) : null}
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
      : recipient.phoneE164;

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
