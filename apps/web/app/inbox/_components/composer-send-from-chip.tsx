"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";

import type { InboxComposerAliasOption } from "../_lib/view-models";
import { ChevronDownIcon, SparkleIcon } from "./icons";

export function ComposerSendFromChip({
  value,
  aliases,
  onChange,
  errorMessage,
}: {
  readonly value: string | null;
  readonly aliases: readonly InboxComposerAliasOption[];
  readonly onChange: (value: string | null) => void;
  readonly errorMessage?: string;
}) {
  const selectedAlias = aliases.find((alias) => alias.alias === value) ?? null;

  return (
    <div className="space-y-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-invalid={errorMessage ? true : undefined}
            className={cn(
              `flex min-h-11 w-full items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 text-left ${RADIUS.md} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:border-slate-300`,
              errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
            )}
          >
            <span className="min-w-0">
              {selectedAlias ? (
                <span className="block min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-900">
                    {selectedAlias.alias}
                  </span>
                  <span className={`mt-0.5 flex items-center gap-1.5 ${TYPE.caption}`}>
                    <span className="truncate">{selectedAlias.projectName}</span>
                    {selectedAlias.isAiReady ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <SparkleIcon className="h-3 w-3" />
                        AI ready
                      </span>
                    ) : null}
                  </span>
                </span>
              ) : (
                <span className="text-[13px] text-slate-400">
                  Choose a sender alias
                </span>
              )}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-slate-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[22rem] rounded-xl p-2"
        >
          <DropdownMenuLabel className="px-2 pb-2 pt-1 text-[11px] font-semibold text-slate-500">
            Send from
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value ?? ""}
            onValueChange={(nextValue) => {
              onChange(nextValue.length > 0 ? nextValue : null);
            }}
          >
            <DropdownMenuRadioItem value="" className="rounded-lg">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-slate-700">
                  No alias selected
                </span>
                <span className={TYPE.caption}>Pick a sender before sending</span>
              </div>
            </DropdownMenuRadioItem>
            {aliases.map((alias) => (
              <DropdownMenuRadioItem
                key={alias.id}
                value={alias.alias}
                className={cn(
                  "rounded-lg",
                  alias.isAiReady ? "" : "opacity-75",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {alias.alias}
                  </span>
                  <span className={`truncate ${TYPE.caption}`}>
                    {alias.projectName}
                    {alias.isAiReady ? " - AI ready" : " - AI unavailable"}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {errorMessage ? (
        <p className="text-xs text-rose-700">{errorMessage}</p>
      ) : null}
    </div>
  );
}
