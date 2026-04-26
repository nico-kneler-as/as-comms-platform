"use client";

import { useDeferredValue, useState } from "react";
import { Check, FolderOpen, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

export function StepPickProject({
  inactiveProjects,
  selectedProjectId,
  aliasDraft,
  onAliasChange,
  onPickProject
}: {
  readonly inactiveProjects: readonly ProjectRowViewModel[];
  readonly selectedProjectId: string | null;
  readonly aliasDraft: string;
  readonly onAliasChange: (nextValue: string) => void;
  readonly onPickProject: (project: ProjectRowViewModel) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredProjects =
    normalizedQuery.length === 0
      ? inactiveProjects
      : inactiveProjects.filter((project) =>
          project.projectName.toLowerCase().includes(normalizedQuery)
        );
  const selectedProject =
    inactiveProjects.find((project) => project.projectId === selectedProjectId) ??
    null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          Salesforce project
        </p>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search inactive projects..."
            className="h-10 rounded-lg border-slate-200 pl-9 text-[13px] text-slate-800"
          />
        </div>

        <div className="mt-3 flex max-h-[280px] flex-col gap-1 overflow-auto rounded-xl border border-slate-200 bg-white p-1">
          {filteredProjects.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-slate-400">
              No matching projects
            </div>
          ) : null}

          {filteredProjects.map((project) => {
            const isSelected = project.projectId === selectedProjectId;

            return (
              <button
                key={project.projectId}
                type="button"
                onClick={() => {
                  onPickProject(project);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    isSelected
                      ? "bg-white/10"
                      : "bg-slate-50 ring-1 ring-inset ring-slate-200"
                  )}
                >
                  <FolderOpen
                    className={cn(
                      "h-4 w-4",
                      isSelected ? "text-white" : "text-slate-500"
                    )}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[13px] font-medium",
                      isSelected ? "text-white" : "text-slate-900"
                    )}
                  >
                    {project.projectName}
                  </p>
                  <p
                    className={cn(
                      "truncate font-mono text-[11.5px]",
                      isSelected ? "text-slate-300" : "text-slate-500"
                    )}
                  >
                    {project.projectId}
                  </p>
                </div>
                {isSelected ? (
                  <Check className="h-4 w-4 text-white" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">
              Project alias
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              Short internal name used in inbox tags and internal UI labels.
            </p>
          </div>
        </div>
        <Input
          value={aliasDraft}
          onChange={(event) => {
            onAliasChange(event.target.value);
          }}
          disabled={selectedProject === null}
          placeholder="e.g. Butternut"
          className="mt-2 h-10 rounded-lg border-slate-200 text-[13px] text-slate-800"
        />
        {selectedProject !== null && aliasDraft.trim().length > 0 ? (
          <div className="mt-3 flex items-center gap-2 text-[11.5px] text-slate-500">
            <span>Preview:</span>
            <StatusBadge
              label={aliasDraft.trim()}
              colorClasses="bg-emerald-50 text-emerald-700 ring-emerald-200"
              variant="soft"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
