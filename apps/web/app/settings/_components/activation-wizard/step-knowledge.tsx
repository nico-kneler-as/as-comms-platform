"use client";

import * as React from "react";
import { Check, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  getAiKnowledgeSourceLineErrors,
  splitAiKnowledgeSourceLines
} from "./shared";

type KnowledgeStatus = "idle" | "syncing" | "done" | "error";

export function StepKnowledge({
  knowledgeSourcesText,
  skipKnowledgeSetup,
  knowledgeStatus,
  knowledgeMessage,
  onKnowledgeSourcesTextChange,
  onSkipKnowledgeSetupChange,
  onSubmit
}: {
  readonly knowledgeSourcesText: string;
  readonly skipKnowledgeSetup: boolean;
  readonly knowledgeStatus: KnowledgeStatus;
  readonly knowledgeMessage: string | null;
  readonly onKnowledgeSourcesTextChange: (nextValue: string) => void;
  readonly onSkipKnowledgeSetupChange: (checked: boolean) => void;
  readonly onSubmit: () => void;
}) {
  const lineErrors = getAiKnowledgeSourceLineErrors(knowledgeSourcesText);
  const sourceLines = splitAiKnowledgeSourceLines(knowledgeSourcesText);
  const hasInvalidLines = Object.keys(lineErrors).length > 0;
  const canSubmit =
    !skipKnowledgeSetup &&
    knowledgeStatus !== "syncing" &&
    sourceLines.length > 0 &&
    !hasInvalidLines;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          AI Knowledge sources
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          Paste links to Notion pages, public web pages, or any source the AI
          should learn from. The system will fetch each one and synthesize them
          into the project&apos;s AI Knowledge.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label htmlFor="activation-ai-knowledge-sources" className="sr-only">
          AI Knowledge sources
        </label>
        <textarea
          id="activation-ai-knowledge-sources"
          value={knowledgeSourcesText}
          onChange={(event) => {
            onKnowledgeSourcesTextChange(event.target.value);
          }}
          disabled={knowledgeStatus === "syncing" || skipKnowledgeSetup}
          rows={8}
          placeholder={"https://www.notion.so/...\nhttps://www.adventurescientists.org/..."}
          className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
        />
        {Object.entries(lineErrors).length > 0 ? (
          <div className="mt-3 flex flex-col gap-1 text-[11.5px] text-rose-600">
            {Object.entries(lineErrors).map(([lineIndex, message]) => (
              <p key={lineIndex}>Line {String(Number(lineIndex) + 1)}: {message}</p>
            ))}
          </div>
        ) : null}
        {knowledgeStatus === "error" && knowledgeMessage !== null ? (
          <p className="mt-3 text-[11.5px] text-rose-600">{knowledgeMessage}</p>
        ) : null}
        <label className="mt-4 flex items-start gap-2 text-[12px] text-slate-600">
          <input
            type="checkbox"
            checked={skipKnowledgeSetup}
            onChange={(event) => {
              onSkipKnowledgeSetupChange(event.target.checked);
            }}
            disabled={knowledgeStatus === "syncing"}
            className="mt-0.5 size-4 rounded border-slate-300"
          />
          <span>Skip - set up AI Knowledge later</span>
        </label>
        {!skipKnowledgeSetup ? (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="min-w-[140px]"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Save sources
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-xl border p-4",
          knowledgeStatus === "done"
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-slate-200 bg-white"
        )}
      >
        {knowledgeStatus === "syncing" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <RefreshCw
                className="mt-0.5 size-4 animate-spin text-slate-500"
                aria-hidden="true"
              />
              <div>
                <p className="text-[13px] font-semibold text-slate-900">
                  Saving sources and queueing synthesis...
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  The worker will fetch each source and synthesize the result in
                  the background.
                </p>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-[#253746]" />
            </div>
          </div>
        ) : null}

        {knowledgeStatus === "done" ? (
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 size-4 text-emerald-600" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold text-slate-900">
                Sources saved. Synthesis queued.
              </p>
              <p className="mt-1 text-[12px] text-slate-600">
                The activation can continue while the worker fetches these
                sources in the background.
              </p>
            </div>
          </div>
        ) : null}

        {knowledgeStatus === "idle" && skipKnowledgeSetup ? (
          <p className="text-[12px] text-slate-500">
            AI Knowledge setup is skipped for now. You can manage sources from the
            project detail page later.
          </p>
        ) : null}

        {knowledgeStatus === "idle" && !skipKnowledgeSetup && knowledgeMessage === null ? (
          <p className="text-[12px] text-slate-500">
            Add one source per line, then save them before continuing.
          </p>
        ) : null}

        {knowledgeStatus === "error" && knowledgeMessage !== null ? (
          <p className="text-[12px] text-slate-700">
            Correct the invalid lines or try submitting again once the worker is
            healthy.
          </p>
        ) : null}
      </div>
    </div>
  );
}
