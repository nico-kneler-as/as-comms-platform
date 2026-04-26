"use client";

import { useState } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import {
  type AliasDraft,
  buildSuggestedAliasAddresses,
  getAliasValidationError,
  isBasicEmailAddress,
  normalizeAliasAddress
} from "./shared";

export function StepAliases({
  aliasDraft,
  aliases,
  onAddAlias,
  onMakePrimary,
  onRemoveAlias
}: {
  readonly aliasDraft: string;
  readonly aliases: readonly AliasDraft[];
  readonly onAddAlias: (address: string) => void;
  readonly onMakePrimary: (address: string) => void;
  readonly onRemoveAlias: (address: string) => void;
}) {
  const [draftAddress, setDraftAddress] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const aliasValidationError = getAliasValidationError(aliases);
  const suggestions = buildSuggestedAliasAddresses(aliasDraft, aliases);

  function submitAddress(address: string) {
    const normalizedAddress = normalizeAliasAddress(address);
    if (!isBasicEmailAddress(normalizedAddress)) {
      setLocalError("Enter a valid inbox alias.");
      return;
    }

    if (
      aliases.some(
        (alias) => alias.address.toLowerCase() === normalizedAddress.toLowerCase()
      )
    ) {
      setLocalError("Each inbox alias must be unique.");
      return;
    }

    onAddAlias(normalizedAddress);
    setDraftAddress("");
    setLocalError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 p-4 text-[12px] text-sky-900">
        <div className="flex items-start gap-2">
          <Mail className="mt-0.5 h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
          <p>
            Any email sent to these addresses routes into{" "}
            <span className="font-medium">
              {aliasDraft.trim().length > 0 ? aliasDraft.trim() : "this project"}
            </span>
            {" "}and its AI drafter. You need at least one primary address.
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          Routing addresses
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {aliases.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-[12.5px] text-slate-500">
              <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              No aliases yet. Add the first below.
            </div>
          ) : null}

          {aliases.map((alias) => (
            <div
              key={alias.address}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
            >
              <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-800">
                {alias.address}
              </span>
              {alias.isPrimary ? (
                <StatusBadge
                  label="Primary"
                  colorClasses="bg-sky-50 text-sky-700 ring-sky-200"
                  variant="soft"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onMakePrimary(alias.address);
                  }}
                  className="text-[11.5px] text-slate-500 transition-colors hover:text-slate-900"
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${alias.address}`}
                onClick={() => {
                  onRemoveAlias(alias.address);
                }}
                className="text-slate-400 transition-colors hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2">
          <Input
            value={draftAddress}
            onChange={(event) => {
              setDraftAddress(event.target.value);
              if (localError !== null) {
                setLocalError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitAddress(draftAddress);
              }
            }}
            placeholder="project@adventurescientists.org"
            className="h-10 rounded-lg border-slate-200 font-mono text-[12.5px] text-slate-800"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              submitAddress(draftAddress);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
        {localError !== null ? (
          <p className="mt-2 text-[11.5px] text-rose-600">{localError}</p>
        ) : null}
        {aliasValidationError !== null && aliases.length > 0 ? (
          <p className="mt-2 text-[11.5px] text-rose-600">
            {aliasValidationError}
          </p>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-slate-500">Suggested:</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  submitAddress(suggestion);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/70 transition-colors",
                  "hover:bg-slate-100"
                )}
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add suggested
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
