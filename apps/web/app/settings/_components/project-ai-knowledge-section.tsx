"use client";

import * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Plus,
  RefreshCw,
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
  updateAiAutoSyncScheduleAction,
  updateOperatingContextAction
} from "../actions";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

// Source fetches finish in seconds, but the synthesis tail (Claude call +
// Notion publish + setSynthesisMetadata) can take 60-90s. Window is sized so
// the operator sees "Last synthesized" tick forward on a normal run without
// having to refresh the page.
const POLL_WINDOW_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

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

function formatKindLabel(kind: AiKnowledgeSource["kind"]): string {
  switch (kind) {
    case "notion":
      return "Notion";
    case "web_page":
      return "Web page";
    case "inline_text":
      return "Inline text";
    default:
      return kind;
  }
}

type DerivedStatus =
  | "disabled"
  | "pending"
  | "healthy"
  | "stale"
  | "broken";

function deriveStatus(
  source: AiKnowledgeSource,
  enqueuedAt: number | null
): DerivedStatus {
  if (!source.enabled) {
    return "disabled";
  }

  if (enqueuedAt !== null) {
    const lastSyncedMs =
      source.last_synced_at === null
        ? null
        : Date.parse(source.last_synced_at);
    const isAheadOfEnqueue =
      lastSyncedMs !== null && lastSyncedMs >= enqueuedAt;
    if (!isAheadOfEnqueue) {
      return "pending";
    }
  }

  switch (source.last_sync_status) {
    case "healthy":
      return "healthy";
    case "stale":
      return "stale";
    case "broken":
      return "broken";
    case "pending":
    case null:
    default:
      return "pending";
  }
}

function statusBadgeProps(status: DerivedStatus): {
  readonly label: string;
  readonly classes: string;
} {
  switch (status) {
    case "disabled":
      return {
        label: "Disabled",
        classes: "bg-slate-100 text-slate-600 ring-slate-200"
      };
    case "healthy":
      return {
        label: "Healthy",
        classes: "bg-emerald-50 text-emerald-700 ring-emerald-200"
      };
    case "stale":
      return {
        label: "Stale",
        classes: "bg-amber-50 text-amber-800 ring-amber-200"
      };
    case "broken":
      return {
        label: "Broken",
        classes: "bg-rose-50 text-rose-700 ring-rose-200"
      };
    case "pending":
    default:
      return {
        label: "Syncing…",
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
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [operatingContext, setOperatingContext] = useState(initialOperatingContext);
  const [savedOperatingContext, setSavedOperatingContext] = useState(
    initialOperatingContext
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [autoSyncSchedule, setAutoSyncSchedule] = useState(initialAutoSyncSchedule);
  const [enqueuedAt, setEnqueuedAt] = useState<number | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [rowPending, startRowTransition] = useTransition();
  const [saveContextPending, startSaveContextTransition] = useTransition();
  const [syncAllPending, startSyncAllTransition] = useTransition();
  const [schedulePending, startScheduleTransition] = useTransition();
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull fresh server data into local state whenever the parent re-renders
  // (e.g. after a router.refresh()). Optimistic local mutations from add/remove
  // converge as soon as the server-provided list arrives.
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  // While a re-sync is in flight, poll the server for updated source statuses
  // by issuing router.refresh() at a steady cadence. The parent re-renders
  // with new initialSources, and the useEffect above syncs them in.
  useEffect(() => {
    if (enqueuedAt === null) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    const timeoutId = setTimeout(() => {
      setEnqueuedAt(null);
    }, POLL_WINDOW_MS);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [enqueuedAt, router]);

  // Lift the optimistic pending overlay early once both legs of the run have
  // caught up past the enqueue mark: every enabled source has been re-synced
  // AND the synthesis tail has written aiOptimizedSynthesizedAt. Otherwise the
  // 120s window keeps polling so the operator sees the synthesis timestamp
  // appear without a manual refresh.
  useEffect(() => {
    if (enqueuedAt === null) {
      return;
    }
    const sourcesPending = sources.some((source) => {
      if (!source.enabled) {
        return false;
      }
      const lastSyncedMs =
        source.last_synced_at === null
          ? null
          : Date.parse(source.last_synced_at);
      return lastSyncedMs === null || lastSyncedMs < enqueuedAt;
    });
    const synthesizedAtMs =
      aiOptimizedSynthesizedAt === null
        ? null
        : Date.parse(aiOptimizedSynthesizedAt);
    const synthesisPending =
      synthesizedAtMs === null || synthesizedAtMs < enqueuedAt;

    if (!sourcesPending && !synthesisPending) {
      setEnqueuedAt(null);
    }
  }, [sources, enqueuedAt, aiOptimizedSynthesizedAt]);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  const enabledHealthySources = sources.filter(
    (source) => source.enabled && source.last_sync_status === "healthy"
  );
  const sourcesDirty = operatingContext.trim() !== savedOperatingContext.trim();

  function markSyncEnqueued() {
    setEnqueuedAt(Date.now());
    router.refresh();
  }

  function handleSyncAll() {
    startSyncAllTransition(async () => {
      const result = await triggerProjectKnowledgeSynthesisAction(projectId);
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      markSyncEnqueued();
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

  function handleSyncOne(sourceId: string) {
    setPendingSourceId(sourceId);
    startRowTransition(async () => {
      const result = await syncOneAiKnowledgeSourceAction(projectId, sourceId);
      setPendingSourceId(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      markSyncEnqueued();
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
              the project&apos;s AI Knowledge. Notion pages must be shared with
              the AS Comms integration before they can be read (Share →
              Connections in Notion).
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
                disabled={syncAllPending || enqueuedAt !== null}
              >
                {enqueuedAt !== null ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                    Syncing…
                  </>
                ) : (
                  "Re-sync all"
                )}
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
                <th className="px-3 py-2 font-medium">Last synced</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sources.map((source) => {
                const status = deriveStatus(source, enqueuedAt);
                const badge = statusBadgeProps(status);
                const isRowPending = rowPending && pendingSourceId === source.id;
                const showError =
                  status === "broken" &&
                  source.last_sync_error !== null &&
                  source.last_sync_error.trim().length > 0;

                return (
                  <tr
                    key={source.id}
                    className={cn(!source.enabled && "opacity-70", isRowPending && "opacity-60")}
                  >
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge
                          label={badge.label}
                          colorClasses={badge.classes}
                          variant="subtle"
                          className="ring-1 ring-inset"
                        />
                        {showError ? (
                          <p
                            className="flex items-start gap-1 text-[11px] leading-snug text-rose-700"
                            title={source.last_sync_error ?? undefined}
                          >
                            <AlertTriangle
                              className="mt-0.5 size-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{source.last_sync_error}</span>
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {formatKindLabel(source.kind)}
                    </td>
                    <td
                      className="px-3 py-3 align-top font-medium text-slate-900"
                      title={source.url}
                    >
                      {buildSourceLabel(source)}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {formatTimestamp(source.last_synced_at)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={isRowPending || enqueuedAt !== null}
                            onClick={() => {
                              handleSyncOne(source.id);
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Sync ${buildSourceLabel(source)}`}
                            title="Sync now"
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5",
                                status === "pending" && "animate-spin"
                              )}
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            disabled={isRowPending}
                            onClick={() => {
                              handleRemoveSource(source.id);
                            }}
                            className="rounded p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Delete ${buildSourceLabel(source)}`}
                            title="Delete source"
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
                  <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Synthesis status</p>
          <p
            className={cn(
              TYPE.caption,
              "mt-1 flex items-start gap-1.5 text-slate-600"
            )}
          >
            {enqueuedAt !== null ? (
              <>
                <RefreshCw
                  className="mt-0.5 size-3 shrink-0 animate-spin text-sky-600"
                  aria-hidden="true"
                />
                <span>
                  Synthesizing now — Claude call + Notion publish typically
                  takes 30–90s.
                </span>
              </>
            ) : aiOptimizedSynthesizedAt === null ? (
              <span>Not yet synthesized.</span>
            ) : (
              <span>{`Last synthesized: ${formatTimestamp(aiOptimizedSynthesizedAt)} (${String(enabledHealthySources.length)} healthy enabled sources, model metadata unavailable).`}</span>
            )}
          </p>
          {aiKnowledgeSynthesisStale && enqueuedAt === null ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Synthesis is stale. One or more source hashes no longer match the
              last synthesized input. Re-sync recommended.
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Auto-sync schedule</p>
              <p className={cn(TYPE.caption, "mt-1 text-slate-600")}>
                Hourly polling checks whether this project is due for a refresh,
                then skips synthesis when source hashes are unchanged.
              </p>
            </div>
            <label className="flex flex-col gap-1.5 text-[12px] text-slate-600">
              <span className={TYPE.label}>Frequency</span>
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
      </div>
    </div>
  );
}
