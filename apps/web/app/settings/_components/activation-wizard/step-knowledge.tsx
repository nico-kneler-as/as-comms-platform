"use client";

import * as React from "react";
import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { getDraftLineErrors, listEnteredDrafts } from "./shared";
import type { KnowledgeSourceDraft } from "./state";

type KnowledgeStatus = "idle" | "syncing" | "done" | "error";

export function StepKnowledge({
  knowledgeSourceDrafts,
  skipKnowledgeSetup,
  knowledgeStatus,
  knowledgeMessage,
  onAddRow,
  onRemoveRow,
  onFieldChange,
  onSkipKnowledgeSetupChange,
  onSubmit
}: {
  readonly knowledgeSourceDrafts: readonly KnowledgeSourceDraft[];
  readonly skipKnowledgeSetup: boolean;
  readonly knowledgeStatus: KnowledgeStatus;
  readonly knowledgeMessage: string | null;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (index: number) => void;
  readonly onFieldChange: (
    index: number,
    field: "url" | "label",
    value: string
  ) => void;
  readonly onSkipKnowledgeSetupChange: (checked: boolean) => void;
  readonly onSubmit: () => void;
}) {
  const draftErrors = getDraftLineErrors(knowledgeSourceDrafts);
  const enteredDrafts = listEnteredDrafts(knowledgeSourceDrafts);
  const hasErrors = Object.keys(draftErrors).length > 0;
  const canSubmit =
    !skipKnowledgeSetup &&
    knowledgeStatus !== "syncing" &&
    enteredDrafts.length > 0 &&
    !hasErrors;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          AI Knowledge sources
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          Add Notion pages, public web pages, or any source the AI should learn
          from. One row per source — the label is what shows up in the project
          detail page later (handy for Notion URLs that would otherwise read as
          opaque IDs).
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3">
          {knowledgeSourceDrafts.map((draft, index) => {
            const urlError = draftErrors[index] ?? null;
            const showRemove = knowledgeSourceDrafts.length > 1;
            return (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-2"
              >
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`activation-ai-knowledge-url-${String(index)}`}
                    className="text-[10px] font-medium uppercase tracking-wide text-slate-500"
                  >
                    Source URL
                  </label>
                  <Input
                    id={`activation-ai-knowledge-url-${String(index)}`}
                    value={draft.url}
                    placeholder="https://www.notion.so/..."
                    disabled={skipKnowledgeSetup || knowledgeStatus === "syncing"}
                    onChange={(event) => {
                      onFieldChange(index, "url", event.target.value);
                    }}
                    aria-invalid={urlError !== null}
                  />
                  {urlError !== null ? (
                    <p className="text-[11.5px] text-rose-600">{urlError}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`activation-ai-knowledge-label-${String(index)}`}
                    className="text-[10px] font-medium uppercase tracking-wide text-slate-500"
                  >
                    Label
                  </label>
                  <Input
                    id={`activation-ai-knowledge-label-${String(index)}`}
                    value={draft.label}
                    placeholder="Volunteer homepage"
                    disabled={skipKnowledgeSetup || knowledgeStatus === "syncing"}
                    onChange={(event) => {
                      onFieldChange(index, "label", event.target.value);
                    }}
                  />
                </div>
                <div className="flex items-end pb-0.5">
                  {showRemove ? (
                    <button
                      type="button"
                      aria-label={`Remove source ${String(index + 1)}`}
                      title="Remove source"
                      disabled={skipKnowledgeSetup || knowledgeStatus === "syncing"}
                      onClick={() => {
                        onRemoveRow(index);
                      }}
                      className="rounded p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <div className="size-6" aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={skipKnowledgeSetup || knowledgeStatus === "syncing"}
            onClick={onAddRow}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add source
          </Button>
          {knowledgeStatus === "error" && knowledgeMessage !== null ? (
            <p className="text-[11.5px] text-rose-600">{knowledgeMessage}</p>
          ) : null}
        </div>

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

        {knowledgeStatus === "idle" &&
        !skipKnowledgeSetup &&
        knowledgeMessage === null ? (
          <p className="text-[12px] text-slate-500">
            Add at least one source, then save before continuing.
          </p>
        ) : null}

        {knowledgeStatus === "error" && knowledgeMessage !== null ? (
          <p className="text-[12px] text-slate-700">
            Correct the invalid rows or try submitting again once the worker is
            healthy.
          </p>
        ) : null}
      </div>
    </div>
  );
}
