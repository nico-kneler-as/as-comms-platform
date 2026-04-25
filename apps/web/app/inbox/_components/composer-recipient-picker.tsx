"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FOCUS_RING, RADIUS, SHADOW, TRANSITION } from "@/app/_lib/design-tokens-v2";

import {
  formatContactRecipientLabel,
  resolveTypedEmailRecipient,
} from "../_lib/composer-ui";
import {
  searchContactsAction,
  type ContactSearchResult,
} from "../actions";
import { SearchIcon, XIcon } from "./icons";

export interface ComposerContactRecipient {
  readonly kind: "contact";
  readonly contactId: string;
  readonly displayName: string;
  readonly primaryEmail: string | null;
  readonly primaryProjectName: string | null;
  readonly salesforceContactId: string | null;
}

export interface ComposerEmailRecipient {
  readonly kind: "email";
  readonly emailAddress: string;
}

export type ComposerRecipientValue =
  | ComposerContactRecipient
  | ComposerEmailRecipient;

function toContactRecipient(
  result: ContactSearchResult,
): ComposerContactRecipient {
  return {
    kind: "contact",
    contactId: result.id,
    displayName: result.displayName,
    primaryEmail: result.primaryEmail,
    primaryProjectName: result.primaryProjectName,
    salesforceContactId: result.salesforceContactId,
  };
}

export function ComposerRecipientPicker({
  recipient,
  locked = false,
  onRecipientChange,
}: {
  readonly recipient: ComposerRecipientValue | null;
  readonly locked?: boolean;
  readonly onRecipientChange: (recipient: ComposerRecipientValue | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly ContactSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const activeSearchIdRef = useRef(0);
  const listboxId = useId();

  useEffect(() => {
    if (recipient !== null) {
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

          setResults(result.ok ? result.data : []);
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
  }, [query, recipient]);

  const shouldShowResults =
    recipient === null &&
    (isSearching || results.length > 0 || query.trim().length >= 2);

  return (
    <div className="relative">
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
      ) : (
        <>
          <SearchIcon className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }

              const trimmedQuery = query.trim();

              if (trimmedQuery.length === 0) {
                event.preventDefault();
                return;
              }

              const typedEmailRecipient = resolveTypedEmailRecipient({
                query: trimmedQuery,
                results,
              });

              if (typedEmailRecipient === null) {
                return;
              }

              event.preventDefault();
              onRecipientChange(typedEmailRecipient);
            }}
            placeholder="Search Salesforce contacts or type an email"
            aria-expanded={shouldShowResults}
            aria-controls={shouldShowResults ? listboxId : undefined}
            aria-autocomplete="list"
            className={`h-11 border-0 bg-transparent pl-10 shadow-none ${FOCUS_RING}`}
          />
        </>
      )}

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
                    onClick={() => {
                      onRecipientChange(toContactRecipient(result));
                    }}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-3 text-left ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-50`}
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {formatContactRecipientLabel({
                          displayName: result.displayName,
                          primaryEmail: result.primaryEmail,
                        })}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {result.primaryProjectName ?? "Contact recipient"}
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
              No matching contacts.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecipientChip({
  recipient,
  locked,
  onClear,
}: {
  readonly recipient: ComposerRecipientValue;
  readonly locked: boolean;
  readonly onClear: () => void;
}) {
  return (
    <span className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <span className="min-w-0">
        {recipient.kind === "contact" ? (
          <span className="block truncate font-medium text-slate-900">
            {formatContactRecipientLabel({
              displayName: recipient.displayName,
              primaryEmail: recipient.primaryEmail,
            })}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-slate-900">
              {recipient.emailAddress}
            </span>
            <Chip tone="neutral">external</Chip>
          </span>
        )}
      </span>
      {!locked ? (
        <button
          type="button"
          aria-label="Clear recipient"
          className={cn(
            `inline-flex size-7 items-center justify-center rounded-full text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-200 hover:text-slate-700`,
          )}
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </span>
  );
}
