"use client";

import { useState, useTransition } from "react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  addProjectAction,
  archiveProjectAction,
  updateProjectAliasAction
} from "../actions";
import type { MockProject } from "../_lib/mock-data";
import { SettingsSection } from "./settings-section";

interface ProjectsSectionProps {
  readonly projects: readonly MockProject[];
  readonly isAdmin: boolean;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function ProjectsSection({ projects, isAdmin }: ProjectsSectionProps) {
  const [items, setItems] = useState(projects);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function handleToggleActive(project: MockProject) {
    setItems((current) =>
      current.map((item) =>
        item.id === project.id ? { ...item, active: !item.active } : item
      )
    );
    announce(
      project.active
        ? `Paused ${project.name}. (stub)`
        : `Activated ${project.name}. (stub)`
    );
  }

  function handleAdd() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", "New project");
      formData.set("inboxAlias", "new-project@asc.internal");
      const result = await addProjectAction(formData);
      if (result.ok) {
        announce("Add project flow is not wired yet. (stub)");
      }
    });
  }

  function handleEditAlias(project: MockProject) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", project.id);
      formData.set("inboxAlias", project.inboxAlias);
      const result = await updateProjectAliasAction(formData);
      if (result.ok) {
        announce(`Edit alias for ${project.name} — not wired yet. (stub)`);
      }
    });
  }

  function handleRename(project: MockProject) {
    announce(`Rename ${project.name} — not wired yet. (stub)`);
  }

  function handleArchive(project: MockProject) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", project.id);
      const result = await archiveProjectAction(formData);
      if (result.ok) {
        announce(`Archive ${project.name} — not wired yet. (stub)`);
      }
    });
  }

  return (
    <SettingsSection
      id="settings-projects"
      title="Projects"
      description="Inbound routing — each alias points incoming mail to the project's inbox."
      action={
        isAdmin ? (
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={pending}
          >
            Add project
          </Button>
        ) : null
      }
      feedback={feedback}
    >
      <ul
        className={cn(
          "divide-y divide-slate-100",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        {items.map((project) => (
          <li
            key={project.id}
            className="flex items-center gap-4 px-5 py-3.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {project.name}
              </p>
              <p
                className={cn(
                  "mt-0.5 truncate font-mono text-[12px] text-slate-500"
                )}
              >
                {project.inboxAlias}
              </p>
            </div>

            <ActiveToggle
              active={project.active}
              disabled={!isAdmin}
              onToggle={() => {
                handleToggleActive(project);
              }}
              label={project.name}
            />

            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${project.name}`}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                      TRANSITION.fast,
                      FOCUS_RING
                    )}
                  >
                    <MoreIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      handleEditAlias(project);
                    }}
                  >
                    Edit alias
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      handleRename(project);
                    }}
                  >
                    Rename project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      handleArchive(project);
                    }}
                    className="text-rose-700 focus:bg-rose-50 focus:text-rose-800"
                  >
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}

        {items.length === 0 && (
          <li className="px-5 py-10 text-center">
            <p className={TEXT.caption}>No projects yet.</p>
          </li>
        )}
      </ul>
    </SettingsSection>
  );
}

interface ActiveToggleProps {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly label: string;
}

function ActiveToggle({
  active,
  disabled,
  onToggle,
  label
}: ActiveToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? `Pause ${label}` : `Activate ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
        TRANSITION.fast,
        FOCUS_RING,
        active ? "bg-emerald-500" : "bg-slate-300",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm",
          TRANSITION.fast,
          active ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function MoreIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}
