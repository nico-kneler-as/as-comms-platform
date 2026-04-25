"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ComposerSourcesPanel } from "./composer-sources-panel";
import type { AiDraftState } from "./inbox-client-provider";

function formatTokenCount(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "-";
}

export function AboutThisDraft({
  aiDraft,
  open,
  onOpenChange,
}: {
  readonly aiDraft: AiDraftState;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
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
  return (
    <div className="space-y-6 text-sm text-slate-700">
      <section className="grid gap-3 border-b border-slate-200 pb-5 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold text-slate-500">Model</p>
          <p className="mt-1 font-medium text-slate-900">
            {aiDraft.model?.name ?? "-"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-500">Cost</p>
          <p className="mt-1 text-slate-600">Cost not tracked yet</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-500">Tokens</p>
          <p className="mt-1 font-medium text-slate-900">
            {aiDraft.model
              ? `${formatTokenCount(aiDraft.model.inputTokens)} in / ${formatTokenCount(aiDraft.model.outputTokens)} out`
              : "-"}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sources</h3>
          <p className="mt-1 text-xs text-slate-500">
            Grounding is shown from the production AI response when available.
          </p>
        </div>
        <ComposerSourcesPanel sources={aiDraft.grounding} />
      </section>

      {aiDraft.promptPreview.length > 0 ? (
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Prompt preview</h3>
          <pre className="max-h-56 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            {aiDraft.promptPreview}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
