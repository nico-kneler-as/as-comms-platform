"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight, FolderOpen, Plus } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  SPACING,
  TYPE,
  TRANSITION
} from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ProjectListEntryViewModel,
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

  // The wizard's pick-project list is a flat row list of inactive +
  // unconnected candidates, not the nested envelope the Settings list uses.
  // Flatten host + sub rows back into a single array for that surface.
  const inactiveFlatProjects = flattenEntries(viewModel.inactive);

  return (
    <>
      <SettingsSection
        id="settings-projects"
        title="Projects"
        description="Projects currently receiving inbound mail"
        action={
          viewModel.isAdmin ? (
            <Button
              type="button"
              onClick={() => {
                openWizard();
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Activate a project
            </Button>
          ) : null
        }
      >
        <ProjectList
          entries={viewModel.active}
          emptyMessage="No active projects yet."
          renderLeading={() => (
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
              <FolderOpen className="size-4" aria-hidden="true" />
            </span>
          )}
        />
      </SettingsSection>

      {wizardRequest !== null ? (
        <ActivationWizard
          open
          onClose={closeWizard}
          inactiveProjects={inactiveFlatProjects}
          {...(wizardRequest.initialProjectId === undefined
            ? {}
            : { initialProjectId: wizardRequest.initialProjectId })}
        />
      ) : null}
    </>
  );
}

function flattenEntries(
  entries: readonly ProjectListEntryViewModel[]
): readonly ProjectRowViewModel[] {
  const out: ProjectRowViewModel[] = [];

  for (const entry of entries) {
    out.push(entry.host);
    for (const sub of entry.connectedSubProjects) {
      out.push(sub);
    }
  }

  return out;
}

function ProjectList({
  entries,
  emptyMessage,
  renderLeading
}: {
  readonly entries: readonly ProjectListEntryViewModel[];
  readonly emptyMessage: string;
  readonly renderLeading?: ((project: ProjectRowViewModel) => ReactNode) | undefined;
}) {
  return (
    <ul
      className={cn(
        "divide-y divide-slate-100",
        RADIUS.lg,
        "border border-slate-200 bg-white",
        SHADOW.sm
      )}
      data-testid="settings-projects-list"
    >
      {entries.map((entry) => (
        <ProjectListEntry
          key={entry.host.projectId}
          entry={entry}
          renderLeading={renderLeading}
        />
      ))}

      {entries.length === 0 ? (
        <li className="px-5 py-10 text-center">
          <p className={TYPE.caption}>{emptyMessage}</p>
        </li>
      ) : null}
    </ul>
  );
}

function ProjectListEntry({
  entry,
  renderLeading
}: {
  readonly entry: ProjectListEntryViewModel;
  readonly renderLeading: ((project: ProjectRowViewModel) => ReactNode) | undefined;
}) {
  const { host, connectedSubProjects } = entry;

  return (
    <li
      className="flex flex-col"
      data-testid="settings-projects-entry"
      data-project-id={host.projectId}
    >
      <ProjectRow project={host} renderLeading={renderLeading} />

      {connectedSubProjects.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/40"
          data-testid="settings-projects-connected-subs"
        >
          {connectedSubProjects.map((sub) => (
            <ProjectRow
              key={sub.projectId}
              project={sub}
              renderLeading={renderLeading}
              hostName={host.projectName}
              isConnectedSub
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ProjectRow({
  project,
  renderLeading,
  hostName,
  isConnectedSub = false
}: {
  readonly project: ProjectRowViewModel;
  readonly renderLeading: ((project: ProjectRowViewModel) => ReactNode) | undefined;
  readonly hostName?: string;
  readonly isConnectedSub?: boolean;
}) {
  const secondaryLabel = isConnectedSub
    ? `Connected to ${hostName ?? ""}`.trim()
    : getProjectSecondaryLabel(project);

  return (
    <li
      className={cn(
        "group flex items-center gap-3",
        SPACING.listItem,
        TRANSITION.fast,
        "hover:bg-slate-50/80",
        isConnectedSub ? "pl-8" : ""
      )}
      data-testid={
        isConnectedSub
          ? "settings-projects-connected-sub-row"
          : "settings-projects-row"
      }
      data-project-id={project.projectId}
    >
      {isConnectedSub ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center text-slate-400"
          aria-hidden="true"
        >
          <CornerDownRight className="size-3.5" />
        </span>
      ) : null}

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
        {renderLeading && !isConnectedSub ? renderLeading(project) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={
                renderLeading && !isConnectedSub
                  ? "truncate text-[14.5px] font-semibold text-slate-900"
                  : "truncate text-sm font-medium text-slate-900"
              }
            >
              {project.projectName}
            </p>
          </div>
          <p className={cn("mt-1 truncate text-slate-500", TYPE.caption)}>
            {secondaryLabel}
          </p>
        </div>
      </Link>
    </li>
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
