"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { Link2, Link2Off, Plus } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  TRANSITION,
  TYPE
} from "@/app/_lib/design-tokens-v2";
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
import { cn } from "@/lib/utils";
import type {
  ConnectedProjectSummaryViewModel
} from "@/src/server/settings/selectors";

import {
  disconnectProjectAction,
  setProjectConnectedProjectsAction,
  type ProjectConnectedProjectSummary
} from "../actions";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function ProjectConnectedProjectsSection({
  hostProjectId,
  isAdmin,
  initialConnectedProjects,
  initialAvailableCandidates
}: {
  readonly hostProjectId: string;
  readonly isAdmin: boolean;
  readonly initialConnectedProjects: readonly ConnectedProjectSummaryViewModel[];
  readonly initialAvailableCandidates: readonly ConnectedProjectSummaryViewModel[];
}) {
  const [connected, setConnected] = useState(initialConnectedProjects);
  const [available, setAvailable] = useState(initialAvailableCandidates);
  const [addOpen, setAddOpen] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<readonly string[]>(
    []
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingDisconnectId, setPendingDisconnectId] = useState<string | null>(
    null
  );

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function moveCandidatesToConnected(
    newlyConnected: readonly ProjectConnectedProjectSummary[]
  ) {
    const newlyConnectedIds = new Set(
      newlyConnected.map((sub) => sub.projectId)
    );
    setAvailable((current) =>
      current.filter(
        (candidate) => !newlyConnectedIds.has(candidate.projectId)
      )
    );
    setConnected((current) => {
      const merged = [
        ...current,
        ...newlyConnected.map((sub) => ({
          projectId: sub.projectId,
          projectName: sub.projectName
        }))
      ];
      return merged.sort((left, right) =>
        left.projectName.localeCompare(right.projectName)
      );
    });
  }

  function moveConnectedToCandidates(
    disconnectedId: string,
    disconnectedName: string
  ) {
    setConnected((current) =>
      current.filter((sub) => sub.projectId !== disconnectedId)
    );
    setAvailable((current) =>
      [...current, { projectId: disconnectedId, projectName: disconnectedName }].sort(
        (left, right) => left.projectName.localeCompare(right.projectName)
      )
    );
  }

  function togglePickerSelection(projectId: string) {
    setPickerSelection((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  function handleConfirmAdd() {
    if (pickerSelection.length === 0) {
      setAddOpen(false);
      return;
    }

    startTransition(async () => {
      const result = await setProjectConnectedProjectsAction(
        hostProjectId,
        pickerSelection
      );
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      moveCandidatesToConnected(result.data.connectedProjects);
      announce(
        `Connected ${String(result.data.connectedProjects.length)} project${
          result.data.connectedProjects.length === 1 ? "" : "s"
        }.`
      );
      setPickerSelection([]);
      setAddOpen(false);
    });
  }

  function handleDisconnect(sub: ConnectedProjectSummaryViewModel) {
    setPendingDisconnectId(sub.projectId);
    startTransition(async () => {
      const result = await disconnectProjectAction(sub.projectId);
      setPendingDisconnectId(null);
      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      moveConnectedToCandidates(sub.projectId, sub.projectName);
      announce(`Disconnected ${sub.projectName}.`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={TYPE.label}>Connected projects</span>
          <p className={cn(TYPE.caption, "mt-0.5 max-w-xl text-slate-500")}>
            Inactive Salesforce projects whose volunteers and inbound mail roll
            into this project. Connected projects inherit this project&apos;s
            alias and AI Knowledge.
          </p>
        </div>
        {isAdmin ? (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect inactive projects</DialogTitle>
                <DialogDescription>
                  Choose one or more inactive projects to roll into this
                  project. Their existing alias and AI Knowledge URL will be
                  cleared.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 flex flex-col gap-2 max-h-72 overflow-auto">
                {available.length === 0 ? (
                  <p className={cn(TYPE.caption, "text-slate-500")}>
                    No inactive projects available to connect.
                  </p>
                ) : (
                  available.map((candidate) => {
                    const labelId = `connect-candidate-${candidate.projectId}`;
                    const isSelected = pickerSelection.includes(
                      candidate.projectId
                    );

                    return (
                      <label
                        key={candidate.projectId}
                        htmlFor={labelId}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-md border bg-white px-3 py-2 transition-colors",
                          isSelected
                            ? "border-sky-300 bg-sky-50/60"
                            : "border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <input
                          id={labelId}
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            togglePickerSelection(candidate.projectId);
                          }}
                          className="size-4 rounded border-slate-300"
                        />
                        <span className="text-[13px] font-medium text-slate-900">
                          {candidate.projectName}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPickerSelection([]);
                    setAddOpen(false);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleConfirmAdd}
                  disabled={pending || pickerSelection.length === 0}
                >
                  Connect{" "}
                  {pickerSelection.length === 0
                    ? ""
                    : `(${String(pickerSelection.length)})`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-md px-3 py-2 text-[12.5px]",
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
              : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      {connected.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
          <p className={cn(TYPE.caption, "flex items-center gap-2")}>
            <Link2 className="size-3.5 text-slate-400" aria-hidden="true" />
            No connected projects. Connect inactive projects to roll their
            volunteers into this project&apos;s inbox.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {connected.map((sub) => {
            const isRowPending =
              pending && pendingDisconnectId === sub.projectId;
            return (
              <div
                key={sub.projectId}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2",
                  isRowPending && "opacity-60"
                )}
              >
                <Link2
                  className="size-3.5 shrink-0 text-sky-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-800">
                  {sub.projectName}
                </span>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleDisconnect(sub);
                    }}
                    disabled={pending}
                    className={cn(
                      "min-h-9 shrink-0 px-2 text-[11.5px] font-medium text-rose-600 hover:text-rose-800",
                      TRANSITION.fast,
                      FOCUS_RING,
                      RADIUS.sm,
                      "disabled:cursor-not-allowed disabled:opacity-40"
                    )}
                  >
                    <Link2Off
                      className="mr-1 inline size-3.5"
                      aria-hidden="true"
                    />
                    Disconnect
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
