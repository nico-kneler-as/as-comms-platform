"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Pencil, Plus } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  SPACING,
  TYPE,
  TRANSITION
} from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type {
  ProjectRowViewModel,
  ProjectsSettingsViewModel
} from "@/src/server/settings/selectors";

import { ActivationWizard } from "./activation-wizard";
import { SettingsSection } from "./settings-section";

export function ProjectsSection({
  viewModel
}: {
  readonly viewModel: ProjectsSettingsViewModel;
}) {
  const router = useRouter();
  const [wizardRequest, setWizardRequest] = useState<{
    readonly initialProjectId?: string;
  } | null>(null);

  function openWizard(initialProjectId?: string) {
    setWizardRequest(
      initialProjectId === undefined ? {} : { initialProjectId }
    );
  }

  function closeWizard() {
    setWizardRequest(null);
    router.refresh();
  }

  return (
    <>
      <SettingsSection id="settings-projects" title="Projects">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Currently active
              </h3>
              <div className="flex items-center gap-2">
                <span className={cn(TYPE.caption, "tabular-nums")}>
                  {String(viewModel.counts.active)} active
                </span>
                {viewModel.isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      openWizard();
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Activate a project
                  </Button>
                ) : null}
              </div>
            </div>
            <ProjectList
              projects={viewModel.active}
              emptyMessage="No active projects yet."
              renderLeading={() => (
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              renderMeta={() => (
                <StatusBadge
                  label="Active"
                  colorClasses="bg-emerald-50 text-emerald-700 ring-emerald-200"
                  variant="soft"
                />
              )}
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
        </div>
      </SettingsSection>

      {wizardRequest !== null ? (
        <ActivationWizard
          open
          onClose={closeWizard}
          inactiveProjects={viewModel.inactive}
          {...(wizardRequest.initialProjectId === undefined
            ? {}
            : { initialProjectId: wizardRequest.initialProjectId })}
        />
      ) : null}
    </>
  );
}

function ProjectList({
  projects,
  emptyMessage,
  renderLeading,
  renderMeta,
  renderAction
}: {
  readonly projects: readonly ProjectRowViewModel[];
  readonly emptyMessage: string;
  readonly renderLeading?: (project: ProjectRowViewModel) => ReactNode;
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
              renderLeading
                ? "flex min-w-0 flex-1 items-start gap-4"
                : "flex min-w-0 flex-1 flex-col gap-1",
              FOCUS_RING,
              RADIUS.sm
            )}
            aria-label={`Open ${project.projectName}`}
          >
            {renderLeading ? renderLeading(project) : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p
                  className={
                    renderLeading
                      ? "truncate text-[14.5px] font-semibold text-slate-900"
                      : "truncate text-sm font-medium text-slate-900"
                  }
                >
                  {project.projectName}
                </p>
                {renderMeta ? renderMeta(project) : null}
              </div>
              {renderLeading ? (
                <p className={cn("mt-1 truncate text-slate-500", TYPE.caption)}>
                  {getProjectSecondaryLabel(project)}
                </p>
              ) : (
                <>
                  <p className={cn(TYPE.caption, "truncate text-slate-500")}>
                    {getProjectSecondaryLabel(project)}
                  </p>
                </>
              )}
            </div>
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

function getProjectSecondaryLabel(project: ProjectRowViewModel) {
  if (project.projectAlias) {
    return `Alias · ${project.projectAlias}`;
  }

  if (!project.primaryEmail) {
    return "No project inbox aliases configured";
  }

  if (project.additionalEmailCount > 0) {
    return `${project.primaryEmail} + ${String(project.additionalEmailCount)} more alias${project.additionalEmailCount === 1 ? "" : "es"}`;
  }

  return project.primaryEmail;
}
