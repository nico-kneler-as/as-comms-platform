"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  deleteProjectKnowledgeSourceLinkAction,
  deleteProjectKnowledgeAction,
  setProjectKnowledgeApprovedAction,
  triggerBootstrapAction,
  upsertProjectKnowledgeSourceLinkAction,
  updateProjectKnowledgeAction
} from "../actions";

type ProjectKnowledgeKind = "canonical_reply" | "snippet" | "pattern";
type ProjectKnowledgeSourceKind =
  | "public_project_page"
  | "volunteer_homepage"
  | "training_site"
  | "gmail_alias_history"
  | "other";
type BootstrapRunStatus =
  | "queued"
  | "fetching"
  | "synthesizing"
  | "writing"
  | "done"
  | "error";

interface ProjectKnowledgeRow {
  readonly id: string;
  readonly kind: ProjectKnowledgeKind;
  readonly issueType: string | null;
  readonly volunteerStage: string | null;
  readonly questionSummary: string;
  readonly replyStrategy: string | null;
  readonly maskedExample: string | null;
  readonly sourceKind:
    | "hand_authored"
    | "captured_from_send"
    | "bootstrap_synthesized";
  readonly approvedForAi: boolean;
  readonly lastReviewedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProjectKnowledgeSourceRow {
  readonly id: string;
  readonly kind: ProjectKnowledgeSourceKind;
  readonly label: string | null;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BootstrapRunStats {
  readonly sourcesFetched: number | null;
  readonly topicsFound: number | null;
  readonly candidatesWritten: number | null;
  readonly costEstimateUsd: number | null;
  readonly budgetWarn: boolean;
}

interface BootstrapRunRow {
  readonly id: string;
  readonly status: BootstrapRunStatus;
  readonly force: boolean;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly stats: BootstrapRunStats;
  readonly errorDetail: string | null;
}

interface EditDraft {
  readonly id: string;
  readonly kind: ProjectKnowledgeKind;
  readonly issueType: string;
  readonly volunteerStage: string;
  readonly questionSummary: string;
  readonly replyStrategy: string;
  readonly maskedExample: string;
}

interface SourceDraft {
  readonly id: string | null;
  readonly kind: ProjectKnowledgeSourceKind;
  readonly label: string;
  readonly url: string;
}

const emptySourceDraft: SourceDraft = {
  id: null,
  kind: "public_project_page",
  label: "",
  url: ""
};

function formatDate(value: string | null): string {
  return value === null ? "Not reviewed" : new Date(value).toLocaleString();
}

function readableLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildDraft(row: ProjectKnowledgeRow): EditDraft {
  return {
    id: row.id,
    kind: row.kind,
    issueType: row.issueType ?? "",
    volunteerStage: row.volunteerStage ?? "",
    questionSummary: row.questionSummary,
    replyStrategy: row.replyStrategy ?? "",
    maskedExample: row.maskedExample ?? ""
  };
}

function buildSourceDraft(row: ProjectKnowledgeSourceRow): SourceDraft {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label ?? "",
    url: row.url
  };
}

function formatCost(value: number | null): string {
  return value === null ? "$0.0000" : `$${value.toFixed(4)}`;
}

function hasActiveRun(runs: readonly BootstrapRunRow[]): boolean {
  return runs.some((run) =>
    ["queued", "fetching", "synthesizing", "writing"].includes(run.status)
  );
}

export function ProjectKnowledgeTable({
  projectId,
  projectName,
  entries,
  sourceLinks,
  runs
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly entries: readonly ProjectKnowledgeRow[];
  readonly sourceLinks: readonly ProjectKnowledgeSourceRow[];
  readonly runs: readonly BootstrapRunRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() => [...entries]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [sourceDraft, setSourceDraft] = useState(emptySourceDraft);
  const [confirmBootstrapOpen, setConfirmBootstrapOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectKnowledgeRow | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRows([...entries]);
  }, [entries]);

  useEffect(() => {
    if (!hasActiveRun(runs)) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 5_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [router, runs]);

  function showError(message: string) {
    setFeedback(message);
  }

  function toggleApproved(row: ProjectKnowledgeRow, approved: boolean) {
    startTransition(async () => {
      const result = await setProjectKnowledgeApprovedAction({
        id: row.id,
        projectId,
        approved
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      const reviewedAt = new Date().toISOString();
      setRows((current) =>
        current.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                approvedForAi: approved,
                lastReviewedAt: reviewedAt
              }
            : entry
        )
      );
      setFeedback(null);
    });
  }

  function saveEdit() {
    if (editDraft === null) {
      return;
    }

    startTransition(async () => {
      const result = await updateProjectKnowledgeAction({
        id: editDraft.id,
        projectId,
        kind: editDraft.kind,
        issueType: toNullable(editDraft.issueType),
        volunteerStage: toNullable(editDraft.volunteerStage),
        questionSummary: editDraft.questionSummary,
        replyStrategy: toNullable(editDraft.replyStrategy),
        maskedExample: toNullable(editDraft.maskedExample)
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      setRows((current) =>
        current.map((entry) =>
          entry.id === editDraft.id
            ? {
                ...entry,
                kind: editDraft.kind,
                issueType: toNullable(editDraft.issueType),
                volunteerStage: toNullable(editDraft.volunteerStage),
                questionSummary: editDraft.questionSummary.trim(),
                replyStrategy: toNullable(editDraft.replyStrategy),
                maskedExample: toNullable(editDraft.maskedExample),
                updatedAt: new Date().toISOString()
              }
            : entry
        )
      );
      setEditDraft(null);
      setFeedback(null);
    });
  }

  function confirmDelete() {
    if (deleteTarget === null) {
      return;
    }

    startTransition(async () => {
      const result = await deleteProjectKnowledgeAction({
        id: deleteTarget.id,
        projectId
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      setRows((current) =>
        current.filter((entry) => entry.id !== deleteTarget.id)
      );
      setDeleteTarget(null);
      setFeedback(null);
    });
  }

  function saveSourceLink() {
    startTransition(async () => {
      const result = await upsertProjectKnowledgeSourceLinkAction({
        ...(sourceDraft.id === null ? {} : { id: sourceDraft.id }),
        projectId,
        kind: sourceDraft.kind,
        label: toNullable(sourceDraft.label),
        url: sourceDraft.url
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      setSourceDraft(emptySourceDraft);
      setFeedback(null);
      router.refresh();
    });
  }

  function deleteSourceLink(source: ProjectKnowledgeSourceRow) {
    startTransition(async () => {
      const result = await deleteProjectKnowledgeSourceLinkAction({
        id: source.id,
        projectId
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      setFeedback(null);
      router.refresh();
    });
  }

  function triggerBootstrap(force: boolean) {
    startTransition(async () => {
      const result = await triggerBootstrapAction({
        projectId,
        force
      });

      if (!result.ok) {
        showError(result.message);
        return;
      }

      setConfirmBootstrapOpen(false);
      setFeedback(null);
      router.refresh();
    });
  }

  function handleGenerateClick() {
    if (rows.length > 50) {
      setConfirmBootstrapOpen(true);
      return;
    }

    triggerBootstrap(false);
  }

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={`/settings/projects/${encodeURIComponent(projectId)}`}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to project
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-950">
            {projectName} Knowledge
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review captured canonicals, snippets, and patterns before they are used for AI grounding.
          </p>
        </div>
      </div>

      {feedback ? (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {feedback}
        </div>
      ) : null}

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Knowledge Sources
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Add project pages, training references, or Gmail alias history for baseline synthesis.
            </p>
          </div>
          <Button
            type="button"
            onClick={handleGenerateClick}
            disabled={pending || sourceLinks.length === 0}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Generate baseline knowledge
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[180px_1fr_1.5fr_auto]">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Kind</span>
            <select
              value={sourceDraft.kind}
              onChange={(event) => {
                setSourceDraft({
                  ...sourceDraft,
                  kind: event.currentTarget.value as ProjectKnowledgeSourceKind
                });
              }}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="public_project_page">Public project page</option>
              <option value="volunteer_homepage">Volunteer homepage</option>
              <option value="training_site">Training site</option>
              <option value="gmail_alias_history">Gmail alias history</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Label</span>
            <Input
              value={sourceDraft.label}
              onChange={(event) => {
                setSourceDraft({
                  ...sourceDraft,
                  label: event.currentTarget.value
                });
              }}
              placeholder="Optional"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">URL</span>
            <Input
              value={sourceDraft.url}
              onChange={(event) => {
                setSourceDraft({
                  ...sourceDraft,
                  url: event.currentTarget.value
                });
              }}
              placeholder={
                sourceDraft.kind === "gmail_alias_history"
                  ? "gmail-alias-history"
                  : "https://"
              }
            />
          </label>
          <div className="flex items-end gap-2">
            <Button type="button" disabled={pending} onClick={saveSourceLink}>
              <Plus className="size-4" aria-hidden="true" />
              {sourceDraft.id === null ? "Add" : "Save"}
            </Button>
            {sourceDraft.id !== null ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSourceDraft(emptySourceDraft);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
          {sourceLinks.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              No knowledge sources have been added.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sourceLinks.map((source) => (
                  <tr key={source.id}>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                      {readableLabel(source.kind)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                      {source.label ?? "Untitled"}
                    </td>
                    <td className="max-w-lg px-3 py-3 text-slate-700">
                      <span className="line-clamp-1 break-all">{source.url}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSourceDraft(buildSourceDraft(source));
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-rose-700 hover:text-rose-800"
                          onClick={() => {
                            deleteSourceLink(source);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-950">Recent runs</h2>
        <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
          {runs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              No bootstrap runs yet.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Fetched</th>
                  <th className="px-3 py-2">Topics</th>
                  <th className="px-3 py-2">Written</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800">
                      {readableLabel(run.status)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {formatDate(run.startedAt)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-700">
                      {run.stats.sourcesFetched ?? 0}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-700">
                      {run.stats.topicsFound ?? 0}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-700">
                      {run.stats.candidatesWritten ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">
                      {formatCost(run.stats.costEstimateUsd)}
                      {run.stats.budgetWarn ? (
                        <span className="ml-2 text-amber-700">budget warn</span>
                      ) : null}
                    </td>
                    <td className="max-w-sm px-3 py-3 text-slate-600">
                      {run.errorDetail ? (
                        <span className="line-clamp-2 text-rose-700">
                          {run.errorDetail}
                        </span>
                      ) : (
                        <span>{run.completedAt ? "Complete" : "In progress"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600">
          No knowledge entries have been captured for this project yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Approved</th>
                <th className="px-3 py-2">Last reviewed</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {readableLabel(row.kind)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {row.issueType ?? "Unset"}
                  </td>
                  <td className="max-w-md px-3 py-3 text-slate-900">
                    <span className="line-clamp-2">{row.questionSummary}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {readableLabel(row.sourceKind)}
                  </td>
                  <td className="px-3 py-3">
                    <label className="inline-flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={row.approvedForAi}
                        disabled={pending}
                        onChange={(event) => {
                          toggleApproved(row, event.currentTarget.checked);
                        }}
                        className="size-4 rounded border-slate-300"
                      />
                      <span>{row.approvedForAi ? "Yes" : "No"}</span>
                    </label>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                    {formatDate(row.lastReviewedAt)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditDraft(buildDraft(row));
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-rose-700 hover:text-rose-800"
                        onClick={() => {
                          setDeleteTarget(row);
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={editDraft !== null}
        onOpenChange={(open) => {
          if (!open) setEditDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit knowledge entry</DialogTitle>
            <DialogDescription>
              Changes affect future AI grounding after the entry is approved.
            </DialogDescription>
          </DialogHeader>
          {editDraft ? (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Kind</span>
                <select
                  value={editDraft.kind}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      kind: event.currentTarget.value as ProjectKnowledgeKind
                    });
                  }}
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="canonical_reply">Canonical reply</option>
                  <option value="snippet">Snippet</option>
                  <option value="pattern">Pattern</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Issue type</span>
                <Input
                  value={editDraft.issueType}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      issueType: event.currentTarget.value
                    });
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Volunteer stage</span>
                <Input
                  value={editDraft.volunteerStage}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      volunteerStage: event.currentTarget.value
                    });
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Question summary</span>
                <Input
                  value={editDraft.questionSummary}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      questionSummary: event.currentTarget.value
                    });
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Reply strategy</span>
                <textarea
                  value={editDraft.replyStrategy}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      replyStrategy: event.currentTarget.value
                    });
                  }}
                  className="min-h-24 rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Masked example</span>
                <textarea
                  value={editDraft.maskedExample}
                  onChange={(event) => {
                    setEditDraft({
                      ...editDraft,
                      maskedExample: event.currentTarget.value
                    });
                  }}
                  className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={saveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete knowledge entry?</DialogTitle>
            <DialogDescription>
              This removes the entry from future AI retrieval.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmBootstrapOpen} onOpenChange={setConfirmBootstrapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate baseline knowledge?</DialogTitle>
            <DialogDescription>
              This project already has more than 50 knowledge entries. Generated entries will be added as unapproved candidates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmBootstrapOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                triggerBootstrap(true);
              }}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
