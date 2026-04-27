import { Check, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { isNotionUrlLike } from "./shared";

type KnowledgeStatus = "idle" | "syncing" | "done" | "error";

export function StepKnowledge({
  notionUrl,
  knowledgeStatus,
  knowledgeMessage,
  onNotionUrlChange,
  onSync
}: {
  readonly notionUrl: string;
  readonly knowledgeStatus: KnowledgeStatus;
  readonly knowledgeMessage: string | null;
  readonly onNotionUrlChange: (nextValue: string) => void;
  readonly onSync: () => void;
}) {
  const canSync = knowledgeStatus !== "syncing" && isNotionUrlLike(notionUrl);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          AI knowledge source
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          Paste the Notion page URL we&apos;ll sync into this project&apos;s
          knowledge base.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Input
          value={notionUrl}
          onChange={(event) => {
            onNotionUrlChange(event.target.value);
          }}
          disabled={knowledgeStatus === "syncing"}
          placeholder="https://www.notion.so/your-workspace/Page-Name"
          className="h-10 rounded-lg border-slate-200 text-[12.5px] text-slate-800"
        />
        {knowledgeStatus === "error" && knowledgeMessage !== null ? (
          <p className="mt-2 text-[11.5px] text-rose-600">{knowledgeMessage}</p>
        ) : null}
        {knowledgeStatus !== "error" &&
        notionUrl.trim().length > 0 &&
        !isNotionUrlLike(notionUrl) ? (
          <p className="mt-2 text-[11.5px] text-rose-600">
            Enter a Notion page URL.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            onClick={onSync}
            disabled={!canSync}
            className="min-w-[140px]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Save and sync
          </Button>
        </div>
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
                className="mt-0.5 h-4 w-4 animate-spin text-slate-500"
                aria-hidden="true"
              />
              <div>
              <p className="text-[13px] font-semibold text-slate-900">
                Saving and queueing your Notion sync...
              </p>
              <p className="mt-1 text-[12px] text-slate-600">
                We&apos;ll use this page as project context for AI drafts.
              </p>
            </div>
          </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-slate-900" />
            </div>
          </div>
        ) : null}

        {knowledgeStatus === "done" ? (
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold text-slate-900">
                Saved. Sync queued.
              </p>
              <p className="mt-1 text-[12px] text-slate-600">
                Future AI drafts will use this Notion page as project context.
              </p>
            </div>
          </div>
        ) : null}

        {knowledgeStatus === "idle" && knowledgeMessage === null ? (
          <p className="text-[12px] text-slate-500">
            Start a sync after you paste a Notion page URL.
          </p>
        ) : null}

        {knowledgeStatus === "error" && knowledgeMessage !== null ? (
          <p className="text-[12px] text-slate-700">
            Update the URL or try syncing again once the worker is healthy.
          </p>
        ) : null}
      </div>
    </div>
  );
}
