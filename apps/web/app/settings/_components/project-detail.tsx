"use client";

import Link from "next/link";
import * as React from "react";
import { useOptimistic, useState, useTransition } from "react";
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
  activateProjectAction,
  deactivateProjectAction,
  type ProjectEmailInput,
  type ProjectEmailMutationData,
  type ProjectMutationData,
  updateProjectAliasAction,
  updateProjectAiKnowledgeAction,
  updateProjectAliasSignatureAction,
  updateProjectEmailsAction
} from "../actions";
import {
  getProjectAliasSignatureValidationError,
  normalizeProjectAliasSignature
} from "../_lib/project-alias-signature";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

function hasActivationRequirements(input: {
  readonly projectAlias: string | null;
  readonly aiKnowledgeSyncedAt: string | null;
  readonly emails: readonly ProjectEmailInput[];
}): boolean {
  return (
    input.emails.length >= 1 &&
    input.aiKnowledgeSyncedAt !== null &&
    (input.projectAlias?.trim().length ?? 0) > 0
  );
}

function buildProjectState(
  project: ProjectSettingsDetailViewModel
): ProjectMutationData {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectAlias: project.projectAlias,
    isActive: project.isActive,
    aiKnowledgeUrl: project.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: project.aiKnowledgeSyncedAt,
    activationRequirementsMet: project.activationRequirementsMet,
    emails: project.emails
  };
}

function buildSignatureDrafts(
  emails: readonly ProjectEmailMutationData[]
): Record<string, string> {
  return Object.fromEntries(
    emails.map((email) => [email.id, email.signature] as const)
  );
}

function mergeProjectState(
  current: ProjectMutationData,
  patch: Partial<ProjectMutationData>
): ProjectMutationData {
  const next = {
    ...current,
    ...patch
  };

  return {
    ...next,
    activationRequirementsMet: hasActivationRequirements({
      projectAlias: next.projectAlias,
      aiKnowledgeSyncedAt: next.aiKnowledgeSyncedAt,
      emails: next.emails
    })
  };
}

function promotePrimaryEmail(
  emails: readonly ProjectEmailMutationData[],
  address: string
): readonly ProjectEmailMutationData[] {
  const selected = emails.find((email) => email.address === address);
  if (!selected) {
    return emails;
  }

  return [
    {
      id: selected.id,
      address: selected.address,
      isPrimary: true,
      signature: selected.signature
    },
    ...emails
      .filter((email) => email.address !== address)
      .map((email) => ({
        id: email.id,
        address: email.address,
        isPrimary: false,
        signature: email.signature
      }))
  ];
}

function removeEmail(
  emails: readonly ProjectEmailMutationData[],
  address: string
): readonly ProjectEmailMutationData[] {
  const remaining = emails.filter((email) => email.address !== address);
  if (remaining.length === 0) {
    return [];
  }

  if (remaining.some((email) => email.isPrimary)) {
    return remaining;
  }

  return remaining.map((email, index) => ({
    id: email.id,
    address: email.address,
    isPrimary: index === 0,
    signature: email.signature
  }));
}

function toProjectEmailInputs(
  emails: readonly ProjectEmailMutationData[]
): readonly ProjectEmailInput[] {
  return emails.map((email) => ({
    address: email.address,
    isPrimary: email.isPrimary
  }));
}

function formatLastSynced(iso: string | null): string {
  return iso
    ? `Knowledge last synced ${new Date(iso).toLocaleString()}`
    : "Knowledge has not been synced yet.";
}

export function ProjectDetail({
  project
}: {
  readonly project: ProjectSettingsDetailViewModel;
}) {
  const [projectState, setProjectState] = useState(() => buildProjectState(project));
  const [optimisticProject, applyOptimisticProject] = useOptimistic(
    projectState,
    mergeProjectState
  );
  const [knowledgeDraft, setKnowledgeDraft] = useState(project.aiKnowledgeUrl ?? "");
  const [projectAliasDraft, setProjectAliasDraft] = useState(project.projectAlias ?? "");
  const [signatureDrafts, setSignatureDrafts] = useState(() =>
    buildSignatureDrafts(project.emails)
  );
  const [signatureErrors, setSignatureErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [newEmail, setNewEmail] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingSignatureId, setPendingSignatureId] = useState<string | null>(null);
  const [knowledgePending, startKnowledgeTransition] = useTransition();
  const [projectAliasPending, startProjectAliasTransition] = useTransition();
  const [emailPending, startEmailTransition] = useTransition();
  const [signaturePending, startSignatureTransition] = useTransition();
  const [activationPending, startActivationTransition] = useTransition();
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function commitProject(nextProject: ProjectMutationData) {
    setProjectState(nextProject);
    setKnowledgeDraft(nextProject.aiKnowledgeUrl ?? "");
    setProjectAliasDraft(nextProject.projectAlias ?? "");
    setSignatureDrafts((current) =>
      Object.fromEntries(
        nextProject.emails.map((email) => [
          email.id,
          current[email.id] ?? email.signature
        ])
      )
    );
    setSignatureErrors((current) =>
      Object.fromEntries(
        nextProject.emails.flatMap((email) =>
          current[email.id] === undefined ? [] : [[email.id, current[email.id]]]
        )
      )
    );
    setActivationMessage(null);
  }

  function handleKnowledgeSync() {
    announce("Knowledge sync stays stubbed in this brief.", "error");
  }

  function handleAddEmail() {
    const normalizedAddress = newEmail.trim().toLowerCase();
    if (normalizedAddress.length === 0) {
      return;
    }

    if (
      optimisticProject.emails.some(
        (email) => email.address.toLowerCase() === normalizedAddress
      )
    ) {
      announce(`${normalizedAddress} is already connected.`, "error");
      return;
    }

    const nextEmails =
      optimisticProject.emails.length === 0
        ? [
            {
              id: `temp:${normalizedAddress}`,
              address: normalizedAddress,
              isPrimary: true,
              signature: ""
            }
          ]
        : [
            ...optimisticProject.emails,
            {
              id: `temp:${normalizedAddress}`,
              address: normalizedAddress,
              isPrimary: false,
              signature: ""
            }
          ];

    setPendingEmail(normalizedAddress);
    startEmailTransition(async () => {
      applyOptimisticProject({ emails: nextEmails });
      const result = await updateProjectEmailsAction(
        project.projectId,
        toProjectEmailInputs(nextEmails)
      );
      setPendingEmail(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      setNewEmail("");
      announce(`Added ${normalizedAddress}.`);
    });
  }

  function handleRemoveEmail(address: string) {
    const nextEmails = removeEmail(optimisticProject.emails, address);

    setPendingEmail(address);
    startEmailTransition(async () => {
      applyOptimisticProject({ emails: nextEmails });
      const result = await updateProjectEmailsAction(
        project.projectId,
        toProjectEmailInputs(nextEmails)
      );
      setPendingEmail(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(`Removed ${address}.`);
    });
  }

  function handleMakePrimary(address: string) {
    const nextEmails = promotePrimaryEmail(optimisticProject.emails, address);

    setPendingEmail(address);
    startEmailTransition(async () => {
      applyOptimisticProject({ emails: nextEmails });
      const result = await updateProjectEmailsAction(
        project.projectId,
        toProjectEmailInputs(nextEmails)
      );
      setPendingEmail(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(`${address} is now the primary email.`);
    });
  }

  function handleSignatureDraftChange(aliasId: string, nextValue: string) {
    setSignatureDrafts((current) => ({
      ...current,
      [aliasId]: nextValue
    }));
    setSignatureErrors((current) => ({
      ...current,
      [aliasId]: undefined
    }));
  }

  function handleSaveSignature(email: ProjectEmailMutationData) {
    const currentDraft = signatureDrafts[email.id] ?? email.signature;
    const normalizedSignature = normalizeProjectAliasSignature(currentDraft);
    const validationError =
      getProjectAliasSignatureValidationError(normalizedSignature);

    if (validationError !== null) {
      setSignatureErrors((current) => ({
        ...current,
        [email.id]: validationError
      }));
      return;
    }

    startSignatureTransition(async () => {
      setPendingSignatureId(email.id);
      const result = await updateProjectAliasSignatureAction(
        email.id,
        currentDraft
      );
      setPendingSignatureId(null);

      if (!result.ok) {
        setSignatureErrors((current) => ({
          ...current,
          [email.id]: result.fieldErrors?.signature ?? result.message
        }));
        announce(result.message, "error");
        return;
      }

      setProjectState((current) => ({
        ...current,
        emails: current.emails.map((currentEmail) =>
          currentEmail.id === result.data.id
            ? {
                ...currentEmail,
                signature: result.data.signature
              }
            : currentEmail
        )
      }));
      setSignatureDrafts((current) => ({
        ...current,
        [result.data.id]: result.data.signature
      }));
      setSignatureErrors((current) => ({
        ...current,
        [result.data.id]: undefined
      }));
      announce(`Saved the signature for ${result.data.alias}.`);
    });
  }

  function handleSaveKnowledgeUrl() {
    const nextUrl = knowledgeDraft.trim().length === 0 ? null : knowledgeDraft.trim();

    startKnowledgeTransition(async () => {
      applyOptimisticProject({ aiKnowledgeUrl: nextUrl });
      const result = await updateProjectAiKnowledgeAction(
        project.projectId,
        nextUrl
      );

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(
        nextUrl === null
          ? "Cleared the AI knowledge URL."
          : "Updated the AI knowledge URL."
      );
    });
  }

  function handleSaveProjectAlias() {
    const nextAlias =
      projectAliasDraft.trim().length === 0 ? null : projectAliasDraft.trim();

    startProjectAliasTransition(async () => {
      applyOptimisticProject({ projectAlias: nextAlias });
      const result = await updateProjectAliasAction(project.projectId, nextAlias);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(
        nextAlias === null
          ? "Cleared the project alias."
          : "Updated the project alias."
      );
    });
  }

  function handleActivate() {
    startActivationTransition(async () => {
      applyOptimisticProject({ isActive: true });
      const result = await activateProjectAction(project.projectId);

      if (!result.ok) {
        setActivationMessage(result.message);
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(`${result.data.projectName} is now active.`);
    });
  }

  function handleDeactivate() {
    startActivationTransition(async () => {
      applyOptimisticProject({ isActive: false });
      const result = await deactivateProjectAction(project.projectId);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      setDeactivateOpen(false);
      announce(`${result.data.projectName} is now inactive.`);
    });
  }

  const knowledgeDirty =
    knowledgeDraft.trim() !== (optimisticProject.aiKnowledgeUrl ?? "");
  const projectAliasDirty =
    projectAliasDraft.trim() !== (optimisticProject.projectAlias ?? "");
  const inactiveActivationMessage =
    activationMessage ??
    (!optimisticProject.activationRequirementsMet
      ? "Activation needs a short project alias, a project inbox alias, and completed AI knowledge sync."
      : null);
  const hasProjectAlias = (optimisticProject.projectAlias?.trim().length ?? 0) > 0;
  const hasProjectInboxAlias = optimisticProject.emails.length > 0;
  const hasAiKnowledgeSync = optimisticProject.aiKnowledgeSyncedAt !== null;
  const projectAliasStatusLabel = hasProjectAlias
    ? `Short alias set to ${optimisticProject.projectAlias ?? ""}.`
    : "Set a short project alias before activation.";
  const aiKnowledgeStatusLabel =
    hasAiKnowledgeSync && optimisticProject.aiKnowledgeSyncedAt !== null
      ? `AI knowledge last synced ${new Date(
          optimisticProject.aiKnowledgeSyncedAt
        ).toLocaleString()}.`
      : "Run AI knowledge sync before activation.";

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-4">
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
          Back to Projects
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-slate-950">
                {project.projectName}
              </h1>
              <StatusBadge
                label={optimisticProject.isActive ? "Active" : "Inactive"}
                colorClasses={
                  optimisticProject.isActive
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }
                variant="soft"
              />
            </div>
          </div>

          {project.isAdmin ? (
            <div className="flex min-w-[240px] flex-col items-start gap-2">
              {optimisticProject.isActive ? (
                <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={activationPending}
                    >
                      Deactivate project
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        Deactivate {project.projectName}?
                      </DialogTitle>
                      <DialogDescription>
                        This will hide the project from the active list.
                        Continue?
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
                        disabled={activationPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={handleDeactivate}
                        disabled={activationPending}
                      >
                        Deactivate project
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : (
                <Button
                  type="button"
                  onClick={handleActivate}
                  disabled={
                    activationPending ||
                    !optimisticProject.activationRequirementsMet
                  }
                >
                  Activate project
                </Button>
              )}

              {!optimisticProject.isActive && inactiveActivationMessage ? (
                <p
                  className={cn(
                    "max-w-[240px]",
                    TEXT.caption,
                    "text-slate-600"
                  )}
                >
                  {inactiveActivationMessage}
                </p>
              ) : null}
            </div>
          ) : null}
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
              htmlFor="project-short-alias"
              className={cn(TEXT.label, "text-slate-600")}
            >
              Project alias
            </label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  id="project-short-alias"
                  value={projectAliasDraft}
                  onChange={(event) => {
                    setProjectAliasDraft(event.target.value);
                    setActivationMessage(null);
                  }}
                  disabled={!project.isAdmin || projectAliasPending}
                  readOnly={!project.isAdmin}
                  placeholder="Short internal project name"
                  className="font-mono text-[13px]"
                />
                {project.isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSaveProjectAlias}
                    disabled={projectAliasPending || !projectAliasDirty}
                  >
                    Save alias
                  </Button>
                ) : null}
              </div>
              <span className={TEXT.caption}>
                Short name used in inbox tags and internal UI labels.
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:col-span-2">
            <label
              htmlFor="project-ai-knowledge-url"
              className={cn(TEXT.label, "text-slate-600")}
            >
              AI knowledge source
            </label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  id="project-ai-knowledge-url"
                  value={knowledgeDraft}
                  onChange={(event) => {
                    setKnowledgeDraft(event.target.value);
                    setActivationMessage(null);
                  }}
                  disabled={!project.isAdmin || knowledgePending}
                  readOnly={!project.isAdmin}
                  placeholder="https://..."
                  className="font-mono text-[13px]"
                />
                {project.isAdmin ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleSaveKnowledgeUrl}
                      disabled={knowledgePending || !knowledgeDirty}
                    >
                      Save URL
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleKnowledgeSync}
                    >
                      <RefreshCw
                        className="mr-1.5 h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      Sync
                    </Button>
                  </>
                ) : null}
              </div>
              <span className={TEXT.caption}>
                {formatLastSynced(optimisticProject.aiKnowledgeSyncedAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={
              optimisticProject.activationRequirementsMet
                ? "Activation ready"
                : "Needs setup"
            }
            colorClasses={
              optimisticProject.activationRequirementsMet
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
          <StatusBadge
            label={hasProjectAlias ? "Project alias set" : "Project alias required"}
            colorClasses={
              hasProjectAlias
                ? "bg-sky-50 text-sky-700 ring-sky-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
          <StatusBadge
            label={
              hasProjectInboxAlias
                ? "Project inbox alias connected"
                : "Project inbox alias required"
            }
            colorClasses={
              hasProjectInboxAlias
                ? "bg-sky-50 text-sky-700 ring-sky-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
          <StatusBadge
            label={hasAiKnowledgeSync ? "AI knowledge synced" : "AI sync required"}
            colorClasses={
              hasAiKnowledgeSync
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }
            variant="soft"
          />
        </div>

        <ul className="grid gap-2 md:grid-cols-2">
          <li
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              hasProjectAlias
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            )}
          >
            {projectAliasStatusLabel}
          </li>
          <li
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              hasProjectInboxAlias
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            )}
          >
            {hasProjectInboxAlias
              ? "A project inbox alias is connected and ready to route mail."
              : "Add a project inbox alias below before activation."}
          </li>
          <li
            className={cn(
              "rounded-md border px-3 py-2 text-sm md:col-span-2",
              hasAiKnowledgeSync
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            )}
          >
            {aiKnowledgeStatusLabel}
          </li>
        </ul>
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
            Project inbox aliases
          </h2>
          <p className={cn("mt-0.5", TEXT.caption)}>
            Inbound mail to any alias listed here is routed to this project&apos;s
            inbox.
          </p>
        </div>

        <ul
          className={cn(
            "divide-y divide-slate-100 overflow-hidden",
            RADIUS.sm,
            "border border-slate-100"
          )}
        >
          {optimisticProject.emails.map((email) => {
            const isRowPending = emailPending && pendingEmail === email.address;
            const isSignaturePending =
              signaturePending && pendingSignatureId === email.id;
            const signatureDraft = signatureDrafts[email.id] ?? email.signature;
            const signatureError = signatureErrors[email.id];
            const signatureDirty =
              normalizeProjectAliasSignature(signatureDraft) !== email.signature;
            return (
              <li
                key={email.id}
                className={cn(
                  "flex flex-col gap-3 px-3 py-3",
                  isRowPending && "opacity-60"
                )}
              >
                <div className="flex items-center gap-2">
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
                  {project.isAdmin && !email.isPrimary ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={emailPending}
                      onClick={() => {
                        handleMakePrimary(email.address);
                      }}
                    >
                      Make primary
                    </Button>
                  ) : null}
                  {project.isAdmin ? (
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
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`project-email-signature-${email.id}`}
                    className={cn(TEXT.label, "text-slate-600")}
                  >
                    Signature
                  </label>
                  <textarea
                    id={`project-email-signature-${email.id}`}
                    value={signatureDraft}
                    onChange={(event) => {
                      handleSignatureDraftChange(email.id, event.target.value);
                    }}
                    disabled={!project.isAdmin || isSignaturePending}
                    readOnly={!project.isAdmin}
                    rows={4}
                    className={cn(
                      "w-full resize-y border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-900 outline-none",
                      RADIUS.sm,
                      FOCUS_RING,
                      signatureError &&
                        "border-rose-300 bg-rose-50/40 text-rose-900"
                    )}
                    placeholder="Plain-text signature..."
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn(TEXT.caption, "tabular-nums")}>
                      {String(normalizeProjectAliasSignature(signatureDraft).length)}/2000
                    </span>
                    {project.isAdmin ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSignaturePending || !signatureDirty}
                        onClick={() => {
                          handleSaveSignature(email);
                        }}
                      >
                        Save signature
                      </Button>
                    ) : null}
                  </div>
                  {signatureError ? (
                    <p className={cn(TEXT.caption, "text-rose-700")}>
                      {signatureError}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
          {optimisticProject.emails.length === 0 ? (
            <li className="px-3 py-4 text-center">
              <p className={TEXT.caption}>
                No connected addresses yet.
              </p>
            </li>
          ) : null}
        </ul>

        {project.isAdmin ? (
          <div className="flex items-center gap-2">
            <label htmlFor="project-email-input" className="sr-only">
              Add project inbox alias
            </label>
            <Input
              id="project-email-input"
              type="email"
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value);
                setActivationMessage(null);
              }}
              disabled={emailPending}
              placeholder="project@asc.internal"
              className="max-w-sm font-mono text-[13px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAddEmail}
              disabled={emailPending || newEmail.trim().length === 0}
            >
              Add alias
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
