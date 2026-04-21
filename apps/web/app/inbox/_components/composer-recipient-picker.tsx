"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { resolveTypedEmailRecipient } from "../_lib/composer-ui";
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
    <div className="space-y-2">
      <label className="flex items-start gap-3">
        <span className="mt-2 w-10 text-sm font-medium text-slate-700">To:</span>
        <div className="flex-1 space-y-2">
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
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
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
                className="pl-9"
              />
            </div>
          )}

          {shouldShowResults ? (
            <div className="rounded-md border border-slate-200 bg-white">
              {isSearching ? (
                <div className="px-3 py-2 text-sm text-slate-500">
                  Searching contacts...
                </div>
              ) : results.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onRecipientChange(toContactRecipient(result));
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {result.displayName}
                            </span>
                            {result.salesforceContactId ? (
                              <Chip tone="neutral" className="uppercase">
                                SF
                              </Chip>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            {result.primaryEmail ? (
                              <span className="font-mono text-[11px] text-slate-600">
                                {result.primaryEmail}
                              </span>
                            ) : (
                              <span>No primary email</span>
                            )}
                            {result.primaryProjectName ? (
                              <span>{result.primaryProjectName}</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim().length >= 2 ? (
                <div className="px-3 py-2 text-sm text-slate-500">
                  No matching contacts.
                </div>
              ) : null}
            </div>
          ) : null}
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
        "inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
      )}
    >
      <span className="min-w-0">
        {recipient.kind === "contact" ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-slate-900">
              {recipient.displayName}
            </span>
            {recipient.primaryEmail ? (
              <span className="truncate font-mono text-[11px] text-slate-500">
                {recipient.primaryEmail}
              </span>
            ) : null}
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
          className="size-7 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
    </span>
  );
}
