"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Pencil, Search as SearchIcon } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  SPACING,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { activateProjectAction } from "../actions";
import type {
  MockInactiveProject,
  MockProject
} from "../_lib/mock-data";
import { SettingsSection } from "./settings-section";

interface ActiveProjectsSectionProps {
  readonly projects: readonly MockProject[];
  readonly inactiveProjects: readonly MockInactiveProject[];
  readonly isAdmin: boolean;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function ActiveProjectsSection({
  projects,
  inactiveProjects,
  isAdmin
}: ActiveProjectsSectionProps) {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  return (
    <SettingsSection
      id="settings-active-projects"
      title="Active Projects"
      description="Each active project receives inbound mail at its connected addresses."
      action={
        isAdmin ? (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm">
                Activate New Project
              </Button>
            </DialogTrigger>
            <ActivateProjectDialog
              inactiveProjects={inactiveProjects}
              onActivated={(project) => {
                setDialogOpen(false);
                announce(
                  `${project.name} queued for activation. (stub)`,
                  "success"
                );
              }}
            />
          </Dialog>
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
        {projects.map((project) => (
          <li
            key={project.id}
            className={cn(
              "group flex items-center gap-3",
              SPACING.listItem,
              TRANSITION.fast,
              "hover:bg-slate-50/80"
            )}
          >
            <Link
              href={`/settings/active-projects/${encodeURIComponent(project.id)}`}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3",
                FOCUS_RING,
                RADIUS.sm
              )}
              aria-label={`Edit ${project.name}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {project.name}
                </p>
              </div>
            </Link>

            <Link
              href={`/settings/active-projects/${encodeURIComponent(project.id)}`}
              aria-label={`Edit ${project.name}`}
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

        {projects.length === 0 && (
          <li className="px-5 py-10 text-center">
            <p className={TEXT.caption}>No active projects yet.</p>
          </li>
        )}
      </ul>
    </SettingsSection>
  );
}

interface ActivateProjectDialogProps {
  readonly inactiveProjects: readonly MockInactiveProject[];
  readonly onActivated: (project: MockInactiveProject) => void;
}

// TODO(stage2): default result set comes from cached Salesforce projects in
// our DB — no Salesforce ping needed. Wire to the real non-active projects
// query when persistence lands.
function ActivateProjectDialog({
  inactiveProjects,
  onActivated
}: ActivateProjectDialogProps) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return inactiveProjects;
    return inactiveProjects.filter((project) => {
      return (
        project.name.toLowerCase().includes(trimmed) ||
        project.alias.toLowerCase().includes(trimmed) ||
        project.description.toLowerCase().includes(trimmed)
      );
    });
  }, [inactiveProjects, query]);

  function handleActivate(project: MockInactiveProject) {
    setPendingId(project.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", project.id);
      formData.set("name", project.name);
      formData.set("alias", project.alias);
      const result = await activateProjectAction(formData);
      setPendingId(null);
      if (result.ok) {
        onActivated(project);
      }
    });
  }

  return (
    <DialogContent className="max-w-xl gap-0 p-0">
      <DialogHeader className="border-b border-slate-100 px-5 py-4">
        <DialogTitle>Activate New Project</DialogTitle>
        <DialogDescription>
          Pick a project from your Salesforce workspace. Activating it opens
          its inbox for inbound mail.
        </DialogDescription>
      </DialogHeader>

      <div className="border-b border-slate-100 px-5 py-3">
        <label className="relative block">
          <span className="sr-only">Search projects</span>
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search Salesforce projects…"
            className="pl-9"
            autoFocus
          />
        </label>
      </div>

      <ul
        className="max-h-[360px] overflow-y-auto divide-y divide-slate-100"
        role="listbox"
        aria-label="Non-active Salesforce projects"
      >
        {filtered.map((project) => {
          const isRowPending = pending && pendingId === project.id;
          return (
            <li
              key={project.id}
              className={cn(
                "flex items-center gap-3 px-5 py-3",
                TRANSITION.fast,
                isRowPending ? "opacity-60" : "hover:bg-slate-50/80"
              )}
              role="option"
              aria-selected="false"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {project.name}
                </p>
                <p className={cn("mt-0.5 truncate", TEXT.caption)}>
                  {project.description}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  handleActivate(project);
                }}
              >
                Activate
              </Button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-5 py-8 text-center">
            <p className={TEXT.caption}>No projects match that search.</p>
          </li>
        )}
      </ul>
    </DialogContent>
  );
}
