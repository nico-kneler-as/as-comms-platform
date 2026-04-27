"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";

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

function isSameRecipient(
  left: ComposerRecipientValue,
  right: ComposerRecipientValue,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "contact" && right.kind === "contact") {
    return left.contactId === right.contactId;
  }

  if (left.kind === "email" && right.kind === "email") {
    return left.emailAddress === right.emailAddress;
  }

  return false;
}

export function ComposerRecipientPicker({
  recipients,
  locked = false,
  single = false,
  placeholder = "Search Salesforce contacts or type an email",
  rightSlot,
  onRecipientsChange,
}: {
  readonly recipients: readonly ComposerRecipientValue[];
  readonly locked?: boolean;
  readonly single?: boolean;
  readonly placeholder?: string;
  readonly rightSlot?: ReactNode;
  readonly onRecipientsChange: (
    recipients: readonly ComposerRecipientValue[],
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly ContactSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const activeSearchIdRef = useRef(0);
  const listboxId = useId();

  useEffect(() => {
    if (locked || (single && recipients.length > 0)) {
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
  }, [locked, query, recipients.length, single]);

  const shouldShowInput = !locked && (!single || recipients.length === 0);
  const shouldShowResults =
    shouldShowInput &&
    (isSearching || results.length > 0 || query.trim().length >= 2);

  const commitRecipient = (recipient: ComposerRecipientValue) => {
    if (single) {
      onRecipientsChange([recipient]);
      return;
    }

    if (recipients.some((existing) => isSameRecipient(existing, recipient))) {
      return;
    }

    onRecipientsChange([...recipients, recipient]);
  };

  return (
    <div className="relative">
      <div
        className={cn(
          `flex min-h-9 flex-wrap items-center gap-1.5 rounded-md px-0 py-0.5`,
          !shouldShowInput && recipients.length > 0 ? "" : "pr-2",
        )}
      >
        {recipients.map((recipient, index) => (
          <RecipientChip
            key={
              recipient.kind === "contact"
                ? `contact:${recipient.contactId}`
                : `email:${recipient.emailAddress}`
            }
            recipient={recipient}
            locked={locked}
            onClear={() => {
              if (locked) {
                return;
              }

              onRecipientsChange(
                recipients.filter((_, candidateIndex) => candidateIndex !== index),
              );
            }}
          />
        ))}

        {shouldShowInput ? (
          <div className="flex min-w-[14rem] flex-1 items-center">
            {recipients.length === 0 ? (
              <SearchIcon className="pointer-events-none mr-2 size-4 shrink-0 text-slate-400" />
            ) : null}
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
                commitRecipient(typedEmailRecipient);
                setQuery("");
                setResults([]);
              }}
              placeholder={recipients.length === 0 ? placeholder : ""}
              aria-expanded={shouldShowResults}
              aria-controls={shouldShowResults ? listboxId : undefined}
              aria-autocomplete="list"
              className={cn(
                `h-8 flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none ${FOCUS_RING}`,
                recipients.length === 0 ? "pl-0" : "",
              )}
            />
          </div>
        ) : null}

        {rightSlot ? (
          <div className="ml-auto flex items-center self-start pt-1">
            {rightSlot}
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
                    onClick={() => {
                      commitRecipient(toContactRecipient(result));
                      setQuery("");
                      setResults([]);
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
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1.5 text-[12px] text-slate-700">
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
