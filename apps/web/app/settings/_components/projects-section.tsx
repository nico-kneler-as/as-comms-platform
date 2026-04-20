import type { ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  SPACING,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
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
  return (
    <SettingsSection id="settings-projects" title="Active Projects">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Currently active
            </h3>
            <span className={cn(TEXT.caption, "tabular-nums")}>
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
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Inactive projects
            </h3>
            <span className={cn(TEXT.caption, "tabular-nums")}>
              {String(viewModel.counts.inactive)} inactive
            </span>
          </div>
          <ProjectList
            projects={viewModel.inactive}
            emptyMessage="No inactive projects."
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
                    Activate
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
        RADIUS.md,
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
            <p className={cn(TEXT.caption, "truncate")}>
              {project.primaryEmail ??
                (project.aiKnowledgeUrl
                  ? "AI knowledge source configured"
                  : "No email aliases configured")}
            </p>
          </Link>

          {renderAction ? renderAction(project) : null}
        </li>
      ))}

      {projects.length === 0 ? (
        <li className="px-5 py-10 text-center">
          <p className={TEXT.caption}>{emptyMessage}</p>
        </li>
      ) : null}
    </ul>
  );
}
