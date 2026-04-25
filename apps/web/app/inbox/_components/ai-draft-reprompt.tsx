"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FOCUS_RING, RADIUS } from "@/app/_lib/design-tokens-v2";

import type { AiDraftState } from "./inbox-client-provider";
import { LoaderIcon, RotateCcwIcon, SparkleIcon } from "./icons";

const SUGGESTED_REPROMPTS = [
  "Make it shorter",
  "Add a P.S.",
  "More formal",
] as const;

export function AiDraftReprompt({
  aiDraft,
  value,
  onValueChange,
  onReprompt,
  onSuggestion,
  disabled,
}: {
  readonly aiDraft: AiDraftState;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly onSuggestion: (value: string) => void;
  readonly disabled: boolean;
}) {
  if (
    aiDraft.status !== "inserted" &&
    aiDraft.status !== "edited-after-generation"
  ) {
    return null;
  }

  return (
    <div className={`border-t border-slate-200 bg-slate-50/60 px-4 py-3 ${RADIUS.md}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {disabled ? (
            <LoaderIcon className="size-3 animate-spin" />
          ) : (
            <SparkleIcon className="size-3" />
          )}
          Reprompt
        </span>
        {SUGGESTED_REPROMPTS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => {
              onSuggestion(suggestion);
            }}
            className={`inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900 ${FOCUS_RING}`}
          >
            {suggestion}
          </button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onReprompt}
          className="ml-auto"
        >
          <RotateCcwIcon className="size-4" />
          Regenerate
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => {
            onValueChange(event.currentTarget.value);
          }}
          placeholder="Type instructions..."
          className="bg-white"
        />
        <Button
          type="button"
          onClick={onReprompt}
          disabled={disabled || value.trim().length === 0}
        >
          {disabled ? <LoaderIcon className="size-4 animate-spin" /> : "Reprompt"}
        </Button>
      </div>
    </div>
  );
}
