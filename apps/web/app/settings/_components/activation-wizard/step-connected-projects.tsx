"use client";

import * as React from "react";
import { AlertTriangle, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

export function StepConnectedProjects({
  candidates,
  selectedProjectIds,
  onToggle
}: {
  readonly candidates: readonly ProjectRowViewModel[];
  readonly selectedProjectIds: readonly string[];
  readonly onToggle: (projectId: string) => void;
}) {
  const selectedSet = new Set(selectedProjectIds);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          Connected projects (optional)
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          Pick inactive Salesforce projects whose volunteers should roll into
          this project&apos;s inbox and dashboard. The selected projects will
          become active and inherit this project&apos;s alias and AI Knowledge.
          You can skip this step.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
          <Link2
            className="mx-auto size-5 text-slate-400"
            aria-hidden="true"
          />
          <p className="mt-2 text-[12.5px] font-medium text-slate-700">
            No inactive projects to connect.
          </p>
          <p className="mt-1 text-[11.5px] text-slate-500">
            All Salesforce projects are either already active or already
            connected. You can manage connections later from this project&apos;s
            detail page.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map((candidate) => {
            const isSelected = selectedSet.has(candidate.projectId);
            const willClearAlias =
              isSelected &&
              candidate.projectAlias !== null &&
              candidate.projectAlias.trim().length > 0;
            const willClearKnowledge =
              isSelected &&
              candidate.aiKnowledgeUrl !== null &&
              candidate.aiKnowledgeUrl.trim().length > 0;
            const labelId = `connected-project-${candidate.projectId}`;

            return (
              <label
                key={candidate.projectId}
                htmlFor={labelId}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3 transition-colors",
                  isSelected
                    ? "border-sky-300 bg-sky-50/50"
                    : "border-slate-200 hover:border-slate-300"
                )}
              >
                <input
                  id={labelId}
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    onToggle(candidate.projectId);
                  }}
                  className="mt-1 size-4 rounded border-slate-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-900">
                    {candidate.projectName}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">
                    {candidate.projectAlias ?? candidate.suggestedAlias}
                    {" · "}
                    {String(candidate.memberCount)} member
                    {candidate.memberCount === 1 ? "" : "s"}
                  </p>
                  {willClearAlias || willClearKnowledge ? (
                    <p className="mt-2 inline-flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-inset ring-amber-200">
                      <AlertTriangle
                        className="mt-0.5 size-3 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        Will be cleared on connect:
                        {willClearAlias ? " project alias" : ""}
                        {willClearAlias && willClearKnowledge ? "," : ""}
                        {willClearKnowledge ? " AI Knowledge URL" : ""}
                      </span>
                    </p>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-[11.5px] text-slate-600">
        <p>
          Connecting is optional. You can leave this empty and add connections
          later from the project detail page.
        </p>
      </div>
    </div>
  );
}
