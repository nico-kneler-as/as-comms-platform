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
import { ChevronDownIcon } from "./icons";

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
              `inline-flex min-h-8 max-w-full items-center gap-2 border border-slate-200 bg-white px-2.5 py-1 text-left ${RADIUS.md} ${SHADOW.sm} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:border-slate-300`,
              errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
            )}
          >
            <span className="min-w-0">
              {selectedAlias ? (
                <span className="block min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-slate-900">
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 shrink-0 rounded-full bg-emerald-500"
                    />
                    <span className="truncate">{selectedAlias.alias}</span>
                  </span>
                </span>
              ) : (
                <span className="text-[13px] text-slate-400">
                  Choose a sender alias
                </span>
              )}
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-slate-400" />
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
                className="rounded-lg"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {alias.alias}
                  </span>
                  <span className={`truncate ${TYPE.caption}`}>{alias.projectName}</span>
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
