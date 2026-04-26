"use client";

import type { ReactNode } from "react";
import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { Pencil, Search } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  SPACING,
  TYPE,
  TRANSITION
} from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type {
  ProjectRowViewModel,
  ProjectsSettingsViewModel
} from "@/src/server/settings/selectors";

import { SettingsSection } from "./settings-section";

export function ProjectsSection({
  viewModel
}: {
  readonly viewModel: ProjectsSettingsViewModel;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filteredInactive =
    normalizedSearch.length === 0
      ? viewModel.inactive.slice(0, 3)
      : viewModel.inactive.filter((project) => {
          return (
            project.projectName.toLowerCase().includes(normalizedSearch) ||
            (project.projectAlias?.toLowerCase().includes(normalizedSearch) ?? false) ||
            project.emailAliases.some((alias) =>
              alias.toLowerCase().includes(normalizedSearch)
            )
          );
        });
  const isSearching = normalizedSearch.length > 0;

  return (
    <SettingsSection id="settings-projects" title="Projects">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Currently active
            </h3>
            <span className={cn(TYPE.caption, "tabular-nums")}>
              {String(viewModel.counts.active)} active
            </span>
          </div>
          <ProjectList
            projects={viewModel.active}
            emptyMessage="No active projects yet."
            renderAction={(project) => (
              <Link
                href={`/settings/projects/${encodeURIComponent(project.projectId)}`}
                aria-label={`Open ${project.projectName}`}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center",
                  RADIUS.sm,
                  "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                  TRANSITION.fast,
                  FOCUS_RING
                )}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center justify-between gap-3 md:min-w-0">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Inactive projects
                </h3>
                <p className={cn("mt-0.5", TYPE.caption)}>
                  {isSearching
                    ? "Search results across inactive project names, project aliases, and inbox aliases."
                    : "Showing the 3 most recently created inactive projects. Search to find older ones."}
                </p>
              </div>
              <span className={cn(TYPE.caption, "tabular-nums")}>
                {String(viewModel.counts.inactive)} inactive
              </span>
            </div>

            <label className="relative block md:w-[320px]" htmlFor="inactive-project-search">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                id="inactive-project-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder="Search inactive projects, aliases"
                className="pl-9"
              />
            </label>
          </div>
          <ProjectList
            projects={filteredInactive}
            emptyMessage={
              isSearching
                ? "No inactive projects matched that search."
                : "No inactive projects."
            }
            renderMeta={(project) => (
              <StatusBadge
                label={
                  project.activationRequirementsMet ? "Activation ready" : "Needs setup"
                }
                colorClasses={
                  project.activationRequirementsMet
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }
                variant="soft"
              />
            )}
            renderAction={(project) =>
              viewModel.isAdmin ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/settings/projects/${encodeURIComponent(project.projectId)}`}
                  >
                    Review
                  </Link>
                </Button>
              ) : null
            }
          />
        </div>
      </div>
    </SettingsSection>
  );
}

function ProjectList({
  projects,
  emptyMessage,
  renderMeta,
  renderAction
}: {
  readonly projects: readonly ProjectRowViewModel[];
  readonly emptyMessage: string;
  readonly renderMeta?: (project: ProjectRowViewModel) => ReactNode;
  readonly renderAction?: (project: ProjectRowViewModel) => ReactNode;
}) {
  return (
    <ul
      className={cn(
        "divide-y divide-slate-100",
        RADIUS.lg,
        "border border-slate-200 bg-white",
        SHADOW.sm
      )}
    >
      {projects.map((project) => (
        <li
          key={project.projectId}
          className={cn(
            "group flex items-center gap-3",
            SPACING.listItem,
            TRANSITION.fast,
            "hover:bg-slate-50/80"
          )}
        >
          <Link
            href={`/settings/projects/${encodeURIComponent(project.projectId)}`}
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1",
              FOCUS_RING,
              RADIUS.sm
            )}
            aria-label={`Open ${project.projectName}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-slate-900">
                {project.projectName}
              </p>
              {renderMeta ? renderMeta(project) : null}
            </div>
            {project.projectAlias ? (
              <p className={cn(TYPE.caption, "truncate text-slate-500")}>
                Alias: {project.projectAlias}
              </p>
            ) : null}
            <p className={cn(TYPE.caption, "truncate")}>
              {project.primaryEmail
                ? project.additionalEmailCount > 0
                  ? `${project.primaryEmail} + ${String(project.additionalEmailCount)} more alias${project.additionalEmailCount === 1 ? "" : "es"}`
                  : project.primaryEmail
                : "No project inbox aliases configured"}
            </p>
          </Link>

          {renderAction ? renderAction(project) : null}
        </li>
      ))}

      {projects.length === 0 ? (
        <li className="px-5 py-10 text-center">
          <p className={TYPE.caption}>{emptyMessage}</p>
        </li>
      ) : null}
    </ul>
  );
}
