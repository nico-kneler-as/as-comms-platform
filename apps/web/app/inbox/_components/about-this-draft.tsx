"use client";

import { useState, type ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { AiDraftState } from "./inbox-client-provider";
import { ChevronDownIcon } from "./icons";

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

export function AboutThisDraft({
  aiDraft,
}: {
  readonly aiDraft: AiDraftState;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
        >
          About this draft
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>About this draft</DialogTitle>
        </DialogHeader>
        <AboutThisDraftPanel aiDraft={aiDraft} />
      </DialogContent>
    </Dialog>
  );
}

export function AboutThisDraftPanel({
  aiDraft,
}: {
  readonly aiDraft: AiDraftState;
}) {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
      <Section title="Grounding Sources">
        <div className="space-y-2 text-sm text-slate-700">
          {aiDraft.grounding.length === 0 ? (
            <p>No grounding sources were attached.</p>
          ) : (
            aiDraft.grounding.map((source) => (
              <div
                key={`${String(source.tier)}:${source.sourceId}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <p className="font-medium text-slate-900">
                  Tier {source.tier} · {source.title ?? source.sourceId}
                </p>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  {source.sourceProvider}
                </p>
                {source.sourceUrl ? (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-sm text-sky-700 underline-offset-4 hover:underline"
                  >
                    {source.sourceUrl}
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Prompt Preview">
        <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800">
            <span>{promptOpen ? "Hide prompt" : "Show prompt"}</span>
            <ChevronDownIcon
              className={`size-4 transition-transform ${
                promptOpen ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
              {aiDraft.promptPreview || "No prompt preview recorded."}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Model Params">
        <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <p>Model: {aiDraft.model?.name ?? "Unknown"}</p>
          <p>Temperature: {aiDraft.model?.temperature ?? 0}</p>
          <p>Max tokens: {aiDraft.model?.maxTokens ?? 0}</p>
          <p>Stop reason: {aiDraft.model?.stopReason ?? "n/a"}</p>
          <p>Input tokens: {aiDraft.model?.inputTokens ?? 0}</p>
          <p>Output tokens: {aiDraft.model?.outputTokens ?? 0}</p>
        </div>
      </Section>

      <Section title="Cost Estimate">
        <p className="text-sm text-slate-700">
          $
          {(aiDraft.costEstimateUsd ?? 0).toLocaleString("en-US", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}
        </p>
      </Section>

      {aiDraft.repromptChain.length > 0 ? (
        <Section title="Reprompt Chain">
          <div className="space-y-2 text-sm text-slate-700">
            {aiDraft.repromptChain.map((step, index) => (
              <div
                key={`${String(index)}:${step.direction}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <p className="font-medium text-slate-900">
                  Reprompt {index + 1}
                </p>
                <p className="mt-1 text-slate-600">{step.direction}</p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                  {step.draft}
                </pre>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Warnings">
        <div className="space-y-2 text-sm text-slate-700">
          {aiDraft.warnings.length === 0 ? (
            <p>No warnings were returned.</p>
          ) : (
            aiDraft.warnings.map((warning) => (
              <div
                key={`${warning.code}:${warning.message}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <p className="font-medium text-slate-900">{warning.code}</p>
                <p className="mt-1">{warning.message}</p>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}
