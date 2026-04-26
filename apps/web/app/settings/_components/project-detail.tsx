"use client";

import Link from "next/link";
import * as React from "react";
import { useOptimistic, useState, useTransition } from "react";
import { ArrowLeft, Mail, Trash2 } from "lucide-react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TYPE,
  TRANSITION
} from "@/app/_lib/design-tokens-v2";
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
  const [knowledgeEditorOpen, setKnowledgeEditorOpen] = useState(
    project.aiKnowledgeUrl === null
  );

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

  function handleSaveKnowledgeUrl(nextDraft = knowledgeDraft) {
    const nextUrl = nextDraft.trim().length === 0 ? null : nextDraft.trim();

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
      setKnowledgeEditorOpen(nextUrl === null);
      announce(
        nextUrl === null
          ? "Cleared the AI knowledge URL."
          : "Updated the AI knowledge URL."
      );
    });
  }

  function handleUnlinkKnowledgeUrl() {
    setKnowledgeDraft("");
    handleSaveKnowledgeUrl("");
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
  const signatureEmails = [...optimisticProject.emails].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) {
      return left.isPrimary ? -1 : 1;
    }

    return left.address.localeCompare(right.address);
  });
  const signaturePlaceholderProjectName =
    optimisticProject.projectAlias ?? optimisticProject.projectName;
  const showKnowledgeEditor =
    project.isAdmin &&
    (knowledgeEditorOpen || optimisticProject.aiKnowledgeUrl === null);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
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
              <h1 className={cn(TYPE.headingLg, "text-balance text-slate-950")}>
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
            <div className="flex min-w-[240px] justify-end">
              <Button type="button" variant="outline" asChild>
                <Link
                  href={`/settings/projects/${encodeURIComponent(project.projectId)}/knowledge`}
                >
                  Knowledge
                </Link>
              </Button>
            </div>
          ) : null}
        </div>

        {!optimisticProject.isActive && project.isAdmin ? (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium text-amber-900">
                  Activation
                </p>
                {inactiveActivationMessage ? (
                  <p className={cn(TYPE.caption, "max-w-2xl text-amber-800")}>
                    {inactiveActivationMessage}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                onClick={handleActivate}
                disabled={
                  activationPending || !optimisticProject.activationRequirementsMet
                }
              >
                Activate project
              </Button>
            </div>
          </div>
        ) : null}
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
        aria-label="Project details"
        className={cn(
          "flex flex-col gap-5 p-5",
          RADIUS.md,
          "border border-slate-200 bg-white",
          SHADOW.sm
        )}
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="project-short-alias"
              className={cn(TYPE.label, "text-slate-600")}
            >
              Project alias
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
            <span className={cn(TYPE.caption, "text-slate-500")}>
              Short internal name used in inbox tags.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="project-salesforce-id"
              className={cn(TYPE.label, "text-slate-600")}
            >
              Salesforce ID
            </label>
            <Input
              id="project-salesforce-id"
              value={project.salesforceProjectId ?? ""}
              disabled
              readOnly
              className="font-mono text-[13px]"
            />
            <span className={cn(TYPE.caption, "text-slate-500")}>
              Read-only, linked via CRM sync.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={TYPE.label}>Inbox aliases</span>
          <div className="flex flex-col gap-1.5">
            {optimisticProject.emails.map((email) => {
              const isRowPending = emailPending && pendingEmail === email.address;

              return (
                <div
                  key={email.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2",
                    isRowPending && "opacity-60"
                  )}
                >
                  <Mail
                    className="h-3.5 w-3.5 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-800">
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
                    <button
                      type="button"
                      disabled={emailPending}
                      onClick={() => {
                        handleMakePrimary(email.address);
                      }}
                      className={cn(
                        "min-h-10 shrink-0 px-2 text-[11.5px] font-medium text-slate-500 hover:text-slate-900",
                        TRANSITION.fast,
                        FOCUS_RING,
                        RADIUS.sm,
                        "disabled:cursor-not-allowed disabled:opacity-40"
                      )}
                    >
                      Make primary
                    </button>
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
                        "flex size-10 shrink-0 items-center justify-center text-slate-400 hover:text-rose-600",
                        TRANSITION.fast,
                        FOCUS_RING,
                        RADIUS.sm,
                        "disabled:cursor-not-allowed disabled:opacity-40"
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {optimisticProject.emails.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
                <p className={TYPE.caption}>No connected addresses yet.</p>
              </div>
            ) : null}

            {project.isAdmin ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                  className="font-mono text-[13px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddEmail}
                  disabled={emailPending || newEmail.trim().length === 0}
                >
                  + Add alias
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={TYPE.label}>AI knowledge source</span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white text-[10px] font-semibold text-slate-900 ring-1 ring-slate-200">
                N
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-slate-800">
                  {optimisticProject.aiKnowledgeUrl ?? "No knowledge source linked"}
                </div>
                <div className={cn(TYPE.micro, "truncate text-slate-500")}>
                  {formatLastSynced(optimisticProject.aiKnowledgeSyncedAt)}
                </div>
              </div>
              {project.isAdmin ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleKnowledgeSync}
                  >
                    Resync
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleUnlinkKnowledgeUrl}
                    disabled={
                      knowledgePending || optimisticProject.aiKnowledgeUrl === null
                    }
                  >
                    Unlink
                  </Button>
                </div>
              ) : null}
            </div>

            {project.isAdmin ? (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-fit px-0 text-slate-600 hover:bg-transparent hover:text-slate-900"
                  onClick={() => {
                    setKnowledgeEditorOpen((current) => !current);
                  }}
                >
                  {showKnowledgeEditor ? "Hide URL editor" : "Edit URL"}
                </Button>
                {showKnowledgeEditor ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor="project-ai-knowledge-url" className="sr-only">
                      AI knowledge URL
                    </label>
                    <Input
                      id="project-ai-knowledge-url"
                      value={knowledgeDraft}
                      onChange={(event) => {
                        setKnowledgeDraft(event.target.value);
                        setActivationMessage(null);
                      }}
                      disabled={knowledgePending}
                      placeholder="https://..."
                      className="font-mono text-[13px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleSaveKnowledgeUrl();
                      }}
                      disabled={knowledgePending || !knowledgeDirty}
                    >
                      Save URL
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <span className={TYPE.label}>Email signatures</span>
          {signatureEmails.length > 0 ? (
            signatureEmails.map((email, index) => {
              const isSignaturePending =
                signaturePending && pendingSignatureId === email.id;
              const signatureDraft = signatureDrafts[email.id] ?? email.signature;
              const signatureError = signatureErrors[email.id];
              const signatureDirty =
                normalizeProjectAliasSignature(signatureDraft) !== email.signature;

              return (
                <div
                  key={email.id}
                  className={cn(
                    "flex flex-col gap-1.5",
                    index > 0 && "border-t border-slate-100 pt-4"
                  )}
                >
                  <label
                    htmlFor={`project-email-signature-${email.id}`}
                    className={cn(TYPE.label, "text-slate-600")}
                  >
                    Email signature - {email.address}
                  </label>
                  <textarea
                    id={`project-email-signature-${email.id}`}
                    value={signatureDraft}
                    onChange={(event) => {
                      handleSignatureDraftChange(email.id, event.target.value);
                    }}
                    disabled={!project.isAdmin || isSignaturePending}
                    readOnly={!project.isAdmin}
                    rows={5}
                    className={cn(
                      "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200",
                      signatureError &&
                        "border-rose-300 bg-rose-50/40 text-rose-900"
                    )}
                    placeholder={`Warmly,\nThe ${signaturePlaceholderProjectName} Team\nAdventure Scientists`}
                  />
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className={cn(TYPE.caption, "text-slate-500")}>
                      Appended to every outbound email from this alias.
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
                    <p className="mt-1 text-[11.5px] text-rose-600">
                      {signatureError}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className={TYPE.caption}>
              Add an inbox alias to configure per-alias signatures.
            </p>
          )}
        </div>

        {project.isAdmin && optimisticProject.isActive ? (
          <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
            <div className="mt-1">
              <div className="flex items-center justify-between rounded-md border border-rose-200/70 bg-rose-50/40 px-3 py-2">
                <div className="text-[12px]">
                  <span className="font-medium text-rose-700">
                    Deactivate project
                  </span>
                  <span className="ml-1.5 text-rose-600/80">
                    Stops routing mail. Existing threads stay searchable.
                  </span>
                </div>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "min-h-10 shrink-0 px-2 text-[12px] font-medium text-rose-700 hover:underline",
                      FOCUS_RING,
                      RADIUS.sm
                    )}
                  >
                    Deactivate
                  </button>
                </DialogTrigger>
              </div>
            </div>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Deactivate {project.projectName}?</DialogTitle>
                <DialogDescription>
                  This will hide the project from the active list. Continue?
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
        ) : null}
      </section>
    </div>
  );
}
