"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { AiDraftState } from "./inbox-client-provider";
import { AboutThisDraft } from "./about-this-draft";

export function AiDraftReprompt({
  aiDraft,
  value,
  onValueChange,
  onReprompt,
  disabled,
}: {
  readonly aiDraft: AiDraftState;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly disabled: boolean;
}) {
  if (aiDraft.status !== "inserted") {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
      <Input
        value={value}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
        placeholder="Reprompt this draft"
        className="flex-1 bg-white"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onReprompt}
          disabled={disabled || value.trim().length === 0}
        >
          Reprompt
        </Button>
        <AboutThisDraft aiDraft={aiDraft} />
      </div>
    </div>
  );
}
