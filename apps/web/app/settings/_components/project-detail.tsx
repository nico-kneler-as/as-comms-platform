"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";

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
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ProjectSettingsDetailViewModel } from "@/src/server/settings/selectors";

import {
  addProjectEmailAction,
  deactivateProjectAction,
  removeProjectEmailAction
} from "../actions";

interface ProjectDetailProps {
  readonly project: ProjectSettingsDetailViewModel;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function ProjectDetail({ project }: ProjectDetailProps) {
  const router = useRouter();
  const [emails, setEmails] = useState(project.emails);
  const [newEmail, setNewEmail] = useState("");
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

  function handleKnowledgeSync() {
    announce("Knowledge sync will be wired in a follow-up brief. (stub)");
  }

  function handleAddEmail() {
    const trimmed = newEmail.trim();
    if (trimmed.length === 0) return;
    if (
      emails.some(
        (email) => email.address.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      announce(`${trimmed} is already connected.`, "error");
      return;
    }
    setPendingEmail(trimmed);
    startEmailTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", project.projectId);
      formData.set("email", trimmed);
      const result = await addProjectEmailAction(formData);
      setPendingEmail(null);
      if (result.ok) {
        setEmails((current) => [
          ...current,
          { address: trimmed, isPrimary: current.length === 0 }
        ]);
        setNewEmail("");
        announce(`Added ${trimmed}. (stub)`);
      }
    });
  }

  function handleRemoveEmail(email: string) {
    setPendingEmail(email);
    startEmailTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", project.projectId);
      formData.set("email", email);
      const result = await removeProjectEmailAction(formData);
      setPendingEmail(null);
      if (result.ok) {
        setEmails((current) => {
          const next = current.filter((value) => value.address !== email);
          if (next.length === 0 || next.some((value) => value.isPrimary)) {
            return next;
          }

          return next.map((value, index) => ({
            ...value,
            isPrimary: index === 0
          }));
        });
        announce(`Removed ${email}. (stub)`);
      }
    });
  }

  function handleDeactivate() {
    startDeactivateTransition(async () => {
      const formData = new FormData();
      formData.set("id", project.projectId);
      const result = await deactivateProjectAction(formData);
      if (result.ok) {
        setDeactivateOpen(false);
        router.push("/settings/projects");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/settings/projects"
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
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-slate-950">
            {project.projectName}
          </h1>
          <StatusBadge
            label={project.isActive ? "Active" : "Inactive"}
            colorClasses={
              project.isActive
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
        </div>
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
        aria-labelledby="project-details-heading"
        className={cn(
          "flex flex-col gap-4 p-5",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        <div>
          <h2 id="project-details-heading" className={TEXT.headingSm}>
            Project details
          </h2>
          <p className={cn("mt-0.5", TEXT.caption)}>
            Activation requires at least one connected inbox email and an AI
            knowledge source.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="project-salesforce-id"
              className={cn(TEXT.label, "text-slate-600")}
            >
              Salesforce project ID
            </label>
            <Input
              id="project-salesforce-id"
              value={project.salesforceProjectId ?? ""}
              disabled
              readOnly
              className="font-mono text-[13px]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="project-ai-knowledge-url"
              className={cn(TEXT.label, "text-slate-600")}
            >
              AI knowledge source
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="project-ai-knowledge-url"
                value={project.aiKnowledgeUrl ?? ""}
                disabled
                readOnly
                placeholder="No source configured"
                className="font-mono text-[13px]"
              />
              {project.isAdmin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleKnowledgeSync}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Sync
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={
              project.activationRequirementsMet
                ? "Activation ready"
                : "Needs setup"
            }
            colorClasses={
              project.activationRequirementsMet
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
          <span className={TEXT.caption}>
            {project.aiKnowledgeSyncedAt
              ? `Knowledge last synced ${new Date(project.aiKnowledgeSyncedAt).toLocaleString()}`
              : "Knowledge has not been synced yet."}
          </span>
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
            const isRowPending = emailPending && pendingEmail === email.address;
            return (
              <li
                key={email.address}
                className={cn(
                  "flex items-center gap-2 px-3 py-2",
                  isRowPending && "opacity-60"
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700">
                  {email.address}
                </span>
                {email.isPrimary ? (
                  <StatusBadge
                    label="Primary"
                    colorClasses="bg-sky-50 text-sky-700 ring-sky-200"
                    variant="soft"
                  />
                ) : null}
                {project.isAdmin && emails.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove ${email.address}`}
                    disabled={isRowPending}
                    onClick={() => {
                      handleRemoveEmail(email.address);
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

        {project.isAdmin ? (
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

      {project.isAdmin ? (
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
                <DialogTitle>Deactivate {project.projectName}?</DialogTitle>
                <DialogDescription>
                  Deactivated projects stop routing inbound mail but are
                  preserved in the record. You can reactivate them from a
                  follow-up admin workflow later.
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
