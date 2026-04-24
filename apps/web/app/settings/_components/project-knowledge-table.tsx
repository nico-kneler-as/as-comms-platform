"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

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
  deleteProjectKnowledgeAction,
  setProjectKnowledgeApprovedAction,
  updateProjectKnowledgeAction
} from "../actions";

type ProjectKnowledgeKind = "canonical_reply" | "snippet" | "pattern";

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

interface EditDraft {
  readonly id: string;
  readonly kind: ProjectKnowledgeKind;
  readonly issueType: string;
  readonly volunteerStage: string;
  readonly questionSummary: string;
  readonly replyStrategy: string;
  readonly maskedExample: string;
}

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

export function ProjectKnowledgeTable({
  projectId,
  projectName,
  entries
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly entries: readonly ProjectKnowledgeRow[];
}) {
  const [rows, setRows] = useState(() => [...entries]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectKnowledgeRow | null>(
    null
  );
  const [pending, startTransition] = useTransition();

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
    </div>
  );
}
