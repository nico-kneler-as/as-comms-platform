"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Circle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2
} from "lucide-react";

import type { AiKnowledgeSource } from "@as-comms/contracts";

import { TYPE } from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import {
  addAiKnowledgeSourceAction,
  removeAiKnowledgeSourceAction,
  syncOneAiKnowledgeSourceAction,
  triggerProjectKnowledgeSynthesisAction,
  updateAiKnowledgeSourceAction,
  updateAiAutoSyncScheduleAction,
  updateOperatingContextAction
} from "../actions";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function buildSourceLabel(source: AiKnowledgeSource): string {
  const trimmedLabel = source.label?.trim() ?? null;
  if (trimmedLabel !== null && trimmedLabel.length > 0) {
    return trimmedLabel;
  }

  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}

function getSourceStatus(source: AiKnowledgeSource): {
  readonly label: string;
  readonly icon: typeof Circle;
  readonly classes: string;
} {
  if (!source.enabled) {
    return {
      label: "Disabled",
      icon: Circle,
      classes: "bg-slate-100 text-slate-600 ring-slate-200"
    };
  }

  switch (source.last_sync_status) {
    case "healthy":
      return {
        label: "Healthy",
        icon: Check,
        classes: "bg-emerald-50 text-emerald-700 ring-emerald-200"
      };
    case "stale":
      return {
        label: "Stale",
        icon: RotateCw,
        classes: "bg-amber-50 text-amber-800 ring-amber-200"
      };
    case "broken":
      return {
        label: "Broken",
        icon: AlertTriangle,
        classes: "bg-rose-50 text-rose-700 ring-rose-200"
      };
    case "pending":
    default:
      return {
        label: "Pending",
        icon: RefreshCw,
        classes: "bg-sky-50 text-sky-700 ring-sky-200"
      };
  }
}

export function ProjectAiKnowledgeSection({
  projectId,
  isAdmin,
  initialSources,
  initialOperatingContext,
  initialAutoSyncSchedule,
  aiOptimizedSynthesizedAt,
  aiKnowledgeSynthesisStale
}: {
  readonly projectId: string;
  readonly isAdmin: boolean;
  readonly initialSources: readonly AiKnowledgeSource[];
  readonly initialOperatingContext: string;
  readonly initialAutoSyncSchedule: "never" | "daily" | "weekly";
  readonly aiOptimizedSynthesizedAt: string | null;
  readonly aiKnowledgeSynthesisStale: boolean;
}) {
  const [sources, setSources] = useState(initialSources);
  const [operatingContext, setOperatingContext] = useState(initialOperatingContext);
  const [savedOperatingContext, setSavedOperatingContext] = useState(
    initialOperatingContext
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<AiKnowledgeSource | null>(null);
  const [editingUrl, setEditingUrl] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [autoSyncSchedule, setAutoSyncSchedule] = useState(initialAutoSyncSchedule);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [rowPending, startRowTransition] = useTransition();
  const [saveContextPending, startSaveContextTransition] = useTransition();
  const [syncAllPending, startSyncAllTransition] = useTransition();
  const [schedulePending, startScheduleTransition] = useTransition();

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  const enabledHealthySources = sources.filter(
    (source) => source.enabled && source.last_sync_status === "healthy"
  );
  const sourcesDirty = operatingContext.trim() !== savedOperatingContext.trim();

  function handleSyncAll() {
    startSyncAllTransition(async () => {
      const result = await triggerProjectKnowledgeSynthesisAction(projectId);
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      announce("Queued a full AI Knowledge re-sync.");
    });
  }

  function handleSaveOperatingContext() {
    startSaveContextTransition(async () => {
      const result = await updateOperatingContextAction(projectId, operatingContext);
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      setOperatingContext(result.data.content);
      setSavedOperatingContext(result.data.content);
      announce("Saved the operating context.");
    });
  }

  function handleAutoSyncScheduleChange(
    nextSchedule: "never" | "daily" | "weekly",
  ) {
    const previousSchedule = autoSyncSchedule;
    setAutoSyncSchedule(nextSchedule);
    startScheduleTransition(async () => {
      const result = await updateAiAutoSyncScheduleAction(
        projectId,
        nextSchedule,
      );
      if (!result.ok) {
        setAutoSyncSchedule(previousSchedule);
        announce(result.message, "error");
        return;
      }

      setAutoSyncSchedule(result.data.schedule);
      announce("Updated the auto-sync schedule.");
    });
  }

  function beginEdit(source: AiKnowledgeSource) {
    setEditingSource(source);
    setEditingUrl(source.url);
    setEditingLabel(source.label ?? "");
  }

  function handleSaveEdit() {
    if (editingSource === null) {
      return;
    }

    const sourceId = editingSource.id;
    setPendingSourceId(sourceId);
    startRowTransition(async () => {
      const result = await updateAiKnowledgeSourceAction(projectId, sourceId, {
        url: editingUrl,
        label: editingLabel
      });
      setPendingSourceId(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      setSources((current) =>
        current.map((source) =>
          source.id === sourceId ? result.data.source : source
        )
      );
      setEditingSource(null);
      announce("Updated the AI Knowledge source.");
    });
  }

  function handleAddSource() {
    startRowTransition(async () => {
      const result = await addAiKnowledgeSourceAction(projectId, {
        url: addUrl,
        label: addLabel
      });
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      setSources((current) => [...current, result.data.source]);
      setAddOpen(false);
      setAddUrl("");
      setAddLabel("");
      announce("Added a new AI Knowledge source.");
    });
  }

  function handleRemoveSource(sourceId: string) {
    setPendingSourceId(sourceId);
    startRowTransition(async () => {
      const result = await removeAiKnowledgeSourceAction(projectId, sourceId);
      setPendingSourceId(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      setSources((current) => current.filter((source) => source.id !== sourceId));
      announce("Removed the AI Knowledge source.");
    });
  }

  function handleToggleEnabled(source: AiKnowledgeSource, enabled: boolean) {
    setPendingSourceId(source.id);
    startRowTransition(async () => {
      const result = await updateAiKnowledgeSourceAction(projectId, source.id, {
        enabled
      });
      setPendingSourceId(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      setSources((current) =>
        current.map((item) => (item.id === source.id ? result.data.source : item))
      );
      announce(enabled ? "Re-enabled the source." : "Disabled the source.");
    });
  }

  function handleSyncOne(sourceId: string) {
    setPendingSourceId(sourceId);
    startRowTransition(async () => {
      const result = await syncOneAiKnowledgeSourceAction(projectId, sourceId);
      setPendingSourceId(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      announce("Queued a project synthesis run.");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
              : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">AI Knowledge</p>
            <p className={cn(TYPE.caption, "mt-1 max-w-2xl text-slate-500")}>
              Manage the sources the synthesis worker fetches and combines into
              the project&apos;s AI Knowledge.
            </p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add source
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add AI Knowledge source</DialogTitle>
                    <DialogDescription>
                      Add a Notion page or public web page to this project.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-3 py-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="add-ai-knowledge-url" className={TYPE.label}>
                        Source URL
                      </label>
                      <Input
                        id="add-ai-knowledge-url"
                        value={addUrl}
                        onChange={(event) => {
                          setAddUrl(event.target.value);
                        }}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="add-ai-knowledge-label" className={TYPE.label}>
                        Label
                      </label>
                      <Input
                        id="add-ai-knowledge-label"
                        value={addLabel}
                        onChange={(event) => {
                          setAddLabel(event.target.value);
                        }}
                        placeholder="Optional operator label"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddSource}
                      disabled={rowPending || addUrl.trim().length === 0}
                    >
                      Save source
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSyncAll}
                disabled={syncAllPending}
              >
                Re-sync all
              </Button>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Last synced</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sources.map((source) => {
                const status = getSourceStatus(source);
                const StatusIcon = status.icon;
                const isExpanded = expandedSourceId === source.id;
                const isPending = rowPending && pendingSourceId === source.id;

                return (
                  <tr
                    key={source.id}
                    className={cn(!source.enabled && "opacity-70", isPending && "opacity-60")}
                  >
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusIcon className="size-3 text-slate-500" aria-hidden="true" />
                        <StatusBadge
                          label={status.label}
                          colorClasses={status.classes}
                          variant="soft"
                        />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        label={source.kind}
                        colorClasses="bg-slate-100 text-slate-700 ring-slate-200"
                        variant="soft"
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {buildSourceLabel(source)}
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedSourceId((current) =>
                            current === source.id ? null : source.id
                          );
                        }}
                        className={cn(
                          "w-full text-left text-slate-600 hover:text-slate-900",
                          !isExpanded && "truncate"
                        )}
                        title={source.url}
                      >
                        {source.url}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {formatTimestamp(source.last_synced_at)}
                    </td>
                    <td className="px-3 py-3">
                      {isAdmin ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              beginEdit(source);
                            }}
                            className="text-slate-600 hover:text-slate-900"
                          >
                            <span className="sr-only">Edit</span>
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              handleSyncOne(source.id);
                            }}
                            className="text-slate-600 hover:text-slate-900 disabled:opacity-40"
                          >
                            Sync now
                          </button>
                          {!source.enabled ? (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                handleToggleEnabled(source, true);
                              }}
                              className="text-slate-600 hover:text-slate-900 disabled:opacity-40"
                            >
                              Re-enable
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                handleToggleEnabled(source, false);
                              }}
                              className="text-slate-600 hover:text-slate-900 disabled:opacity-40"
                            >
                              Disable
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              handleRemoveSource(source.id);
                            }}
                            className="text-rose-600 hover:text-rose-700 disabled:opacity-40"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                    No AI Knowledge sources yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Operating context (operator-maintained)
          </p>
          <p className={cn(TYPE.caption, "mt-1 text-slate-500")}>
            What&apos;s true right now. The AI sees this every time it drafts. No
            re-synthesis needed when you edit this.
          </p>
        </div>
        <textarea
          value={operatingContext}
          onChange={(event) => {
            setOperatingContext(event.target.value);
          }}
          rows={6}
          disabled={!isAdmin || saveContextPending}
          className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        {isAdmin ? (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSaveOperatingContext}
              disabled={saveContextPending || !sourcesDirty}
            >
              Save context
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Auto-sync schedule</p>
            <p className={cn(TYPE.caption, "mt-1 text-slate-600")}>
              Hourly polling checks whether this project is due for a daily or
              weekly refresh, then skips synthesis when source hashes are unchanged.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-[12px] text-slate-600">
            <span className={TYPE.label}>Schedule</span>
            <select
              value={autoSyncSchedule}
              onChange={(event) => {
                handleAutoSyncScheduleChange(
                  event.target.value as "never" | "daily" | "weekly",
                );
              }}
              disabled={!isAdmin || schedulePending}
              className="min-w-[160px] rounded-md border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
            >
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Synthesis status</p>
        <p className={cn(TYPE.caption, "mt-1 text-slate-600")}>
          {aiOptimizedSynthesizedAt === null
            ? "Not yet synthesized."
            : `Last synthesized: ${formatTimestamp(aiOptimizedSynthesizedAt)} (${String(enabledHealthySources.length)} healthy enabled sources, model metadata unavailable).`}
        </p>
        {aiKnowledgeSynthesisStale ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Synthesis is stale. One or more source hashes no longer match the
            last synthesized input. Re-sync recommended.
          </div>
        ) : null}
      </div>

      <Dialog
        open={editingSource !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSource(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit AI Knowledge source</DialogTitle>
            <DialogDescription>
              Update the source URL or operator label.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-ai-knowledge-url" className={TYPE.label}>
                Source URL
              </label>
              <Input
                id="edit-ai-knowledge-url"
                value={editingUrl}
                onChange={(event) => {
                  setEditingUrl(event.target.value);
                }}
                placeholder="https://..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-ai-knowledge-label" className={TYPE.label}>
                Label
              </label>
              <Input
                id="edit-ai-knowledge-label"
                value={editingLabel}
                onChange={(event) => {
                  setEditingLabel(event.target.value);
                }}
                placeholder="Optional operator label"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingSource(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveEdit}
              disabled={rowPending || editingUrl.trim().length === 0}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
