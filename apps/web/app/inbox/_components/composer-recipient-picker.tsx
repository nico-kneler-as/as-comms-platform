"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  formatContactRecipientLabel,
  resolveTypedEmailRecipient,
} from "../_lib/composer-ui";
import {
  searchContactsAction,
  type ContactSearchResult
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
  result: ContactSearchResult
): ComposerContactRecipient {
  return {
    kind: "contact",
    contactId: result.id,
    displayName: result.displayName,
    primaryEmail: result.primaryEmail,
    primaryProjectName: result.primaryProjectName,
    salesforceContactId: result.salesforceContactId
  };
}

export function ComposerRecipientPicker({
  recipient,
  locked = false,
  onRecipientChange
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

          if (!result.ok) {
            setResults([]);
            setIsSearching(false);
            return;
          }

          setResults(result.data);
          setIsSearching(false);
        } catch {
          if (activeSearchIdRef.current !== searchId) {
            return;
          }

          setResults([]);
          setIsSearching(false);
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
    <div>
      <label className="flex items-start gap-3">
        <span className="mt-3 w-10 text-sm font-medium text-slate-700">To:</span>
        <div className="flex-1">
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
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-4 size-4 text-slate-400" />
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
                    results
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
                className="h-11 rounded-xl border-slate-200 bg-white pl-11 shadow-sm"
              />
              {shouldShowResults ? (
                <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {isSearching ? (
                    <div className="px-4 py-3 text-sm text-slate-500">
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
                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-slate-900">
                                  {formatContactRecipientLabel({
                                    displayName: result.displayName,
                                    primaryEmail: result.primaryEmail,
                                  })}
                                </span>
                                {result.salesforceContactId ? (
                                  <Chip tone="neutral" className="uppercase">
                                    SF
                                  </Chip>
                                ) : null}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                {result.primaryProjectName ? (
                                  <span>{result.primaryProjectName}</span>
                                ) : (
                                  <span>Contact recipient</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : query.trim().length >= 2 ? (
                    <div className="px-4 py-3 text-sm text-slate-500">
                      No matching contacts.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </label>
    </div>
  );
}

function RecipientChip({
  recipient,
  locked,
  onClear
}: {
  readonly recipient: ComposerRecipientValue;
  readonly locked: boolean;
  readonly onClear: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm"
      )}
    >
      <span className="min-w-0 pr-2">
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear recipient"
          className="size-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
    </span>
  );
}
