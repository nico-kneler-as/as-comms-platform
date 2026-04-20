"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  addProjectEmailAction,
  deactivateProjectAction,
  removeProjectEmailAction,
  updateProjectAliasAction
} from "../actions";
import type { MockProject } from "../_lib/mock-data";

interface ProjectDetailProps {
  readonly project: MockProject;
  readonly isAdmin: boolean;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function ProjectDetail({ project, isAdmin }: ProjectDetailProps) {
  const router = useRouter();
  const [alias, setAlias] = useState(project.alias);
  const [emails, setEmails] = useState(project.emails);
  const [newEmail, setNewEmail] = useState("");
  const [aliasPending, startAliasTransition] = useTransition();
  const [emailPending, startEmailTransition] = useTransition();
  const [deactivatePending, startDeactivateTransition] = useTransition();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function handleSaveAlias() {
    startAliasTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", project.id);
      formData.set("alias", alias);
      const result = await updateProjectAliasAction(formData);
      if (result.ok) {
        announce(`Alias saved for ${project.name}. (stub)`);
      }
    });
  }

  function handleAddEmail() {
    const trimmed = newEmail.trim();
    if (trimmed.length === 0) return;
    if (emails.includes(trimmed)) {
      announce(`${trimmed} is already connected.`, "error");
      return;
    }
    setPendingEmail(trimmed);
    startEmailTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", project.id);
      formData.set("email", trimmed);
      const result = await addProjectEmailAction(formData);
      setPendingEmail(null);
      if (result.ok) {
        setEmails((current) => [...current, trimmed]);
        setNewEmail("");
        announce(`Added ${trimmed}. (stub)`);
      }
    });
  }

  function handleRemoveEmail(email: string) {
    setPendingEmail(email);
    startEmailTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", project.id);
      formData.set("email", email);
      const result = await removeProjectEmailAction(formData);
      setPendingEmail(null);
      if (result.ok) {
        setEmails((current) => current.filter((value) => value !== email));
        announce(`Removed ${email}. (stub)`);
      }
    });
  }

  function handleDeactivate() {
    startDeactivateTransition(async () => {
      const formData = new FormData();
      formData.set("id", project.id);
      const result = await deactivateProjectAction(formData);
      if (result.ok) {
        setDeactivateOpen(false);
        // Stub mutation — let the caller route back so the list re-renders.
        router.push("/settings/active-projects");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/settings/active-projects"
          className={cn(
            "inline-flex items-center gap-1.5 self-start text-sm font-medium text-slate-600 hover:text-slate-900",
            TRANSITION.fast,
            FOCUS_RING,
            RADIUS.sm
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Active Projects
        </Link>
        <h1 className="text-lg font-semibold tracking-tight text-slate-950">
          {project.name}
        </h1>
      </div>

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
              : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      <section
        aria-labelledby="project-alias-heading"
        className={cn(
          "flex flex-col gap-3 p-5",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        <div>
          <h2 id="project-alias-heading" className={TEXT.headingSm}>
            Alias
          </h2>
          <p className={cn("mt-0.5", TEXT.caption)}>
            The short name used across the platform.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-alias-input" className="sr-only">
            Project alias
          </label>
          <Input
            id="project-alias-input"
            value={alias}
            onChange={(event) => {
              setAlias(event.target.value);
            }}
            disabled={!isAdmin || aliasPending}
            placeholder="project-slug"
            className="max-w-sm font-mono text-[13px]"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSaveAlias}
            disabled={
              !isAdmin || aliasPending || alias.trim() === project.alias
            }
          >
            Save
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="project-emails-heading"
        className={cn(
          "flex flex-col gap-3 p-5",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        <div>
          <h2 id="project-emails-heading" className={TEXT.headingSm}>
            Connected email addresses
          </h2>
          <p className={cn("mt-0.5", TEXT.caption)}>
            Inbound mail to any of these addresses is routed to this
            project&apos;s inbox.
          </p>
        </div>

        <ul
          className={cn(
            "divide-y divide-slate-100 overflow-hidden",
            RADIUS.sm,
            "border border-slate-100"
          )}
        >
          {emails.map((email) => {
            const isRowPending = emailPending && pendingEmail === email;
            return (
              <li
                key={email}
                className={cn(
                  "flex items-center gap-2 px-3 py-2",
                  isRowPending && "opacity-60"
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700">
                  {email}
                </span>
                {isAdmin && emails.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    disabled={isRowPending}
                    onClick={() => {
                      handleRemoveEmail(email);
                    }}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-700",
                      RADIUS.sm,
                      TRANSITION.fast,
                      FOCUS_RING,
                      "disabled:cursor-not-allowed disabled:opacity-40"
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
          {emails.length === 0 && (
            <li className="px-3 py-4 text-center">
              <p className={TEXT.caption}>
                No connected addresses. Add one below.
              </p>
            </li>
          )}
        </ul>

        {isAdmin ? (
          <div className="flex items-center gap-2">
            <label htmlFor="project-email-input" className="sr-only">
              Add email
            </label>
            <Input
              id="project-email-input"
              type="email"
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value);
              }}
              disabled={emailPending}
              placeholder="inbox@asc.internal"
              className="max-w-sm font-mono text-[13px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAddEmail}
              disabled={emailPending || newEmail.trim().length === 0}
            >
              Add email
            </Button>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section
          aria-labelledby="project-danger-heading"
          className={cn(
            "flex flex-col gap-3 p-5",
            RADIUS.md,
            "border border-rose-200 bg-white ring-1 ring-inset ring-rose-100",
            SHADOW.sm
          )}
        >
          <div>
            <h2
              id="project-danger-heading"
              className="text-sm font-semibold text-rose-800"
            >
              Danger zone
            </h2>
            <p className={cn("mt-0.5", TEXT.caption)}>
              Deactivated projects stop routing inbound mail but are preserved
              in the record.
            </p>
          </div>
          <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-fit border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              >
                Deactivate project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Deactivate {project.name}?</DialogTitle>
                <DialogDescription>
                  Deactivated projects stop routing inbound mail but are
                  preserved in the record. You can reactivate from the
                  Active Projects list later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeactivateOpen(false);
                  }}
                  disabled={deactivatePending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDeactivate}
                  disabled={deactivatePending}
                  className="bg-rose-600 hover:bg-rose-700"
                >
                  Deactivate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      ) : null}
    </div>
  );
}
