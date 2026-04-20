"use client";

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
import { cn } from "@/lib/utils";
import type { ProjectsSettingsViewModel } from "@/src/server/settings/selectors";

import { SettingsSection } from "./settings-section";

interface ProjectsSectionProps {
  readonly viewModel: ProjectsSettingsViewModel;
}

export function ProjectsSection({ viewModel }: ProjectsSectionProps) {
  return (
    <SettingsSection id="settings-projects" title="Active Projects">
      <ul
        className={cn(
          "divide-y divide-slate-100",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        {viewModel.active.map((project) => (
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
                "flex min-w-0 flex-1 items-center gap-3",
                FOCUS_RING,
                RADIUS.sm
              )}
              aria-label={`Open ${project.projectName}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {project.projectName}
                </p>
              </div>
            </Link>

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
          </li>
        ))}

        {viewModel.active.length === 0 && (
          <li className="px-5 py-10 text-center">
            <p className={TEXT.caption}>No active projects yet.</p>
          </li>
        )}
      </ul>
    </SettingsSection>
  );
}
