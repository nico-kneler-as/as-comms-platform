"use client";

import Link from "next/link";
import * as React from "react";
import { useOptimistic, useState, useTransition } from "react";
import { ArrowLeft, Link2Off, Mail, Pencil, Trash2 } from "lucide-react";

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
  disconnectProjectAction,
  type ProjectEmailInput,
  type ProjectEmailMutationData,
  type ProjectMutationData,
  updateProjectAliasAction,
  updateProjectAliasSignatureAction,
  updateProjectEmailsAction
} from "../actions";
import {
  getProjectAliasSignatureValidationError,
  normalizeProjectAliasSignature
} from "../_lib/project-alias-signature";
import { ProjectAiKnowledgeSection } from "./project-ai-knowledge-section";
import { ProjectConnectedProjectsSection } from "./project-connected-projects-section";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

type TabId = "overview" | "ai-knowledge" | "danger-zone";

function hasActivationRequirements(input: {
  readonly projectAlias: string | null;
  readonly emails: readonly ProjectEmailInput[];
}): boolean {
  return input.emails.length >= 1 && (input.projectAlias?.trim().length ?? 0) > 0;
}

function buildProjectState(
  project: ProjectSettingsDetailViewModel
): ProjectMutationData {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectAlias: project.projectAlias,
    connectedToProjectId: project.connectedToProjectId,
    isActive: project.isActive,
    aiKnowledgeUrl: project.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: project.aiKnowledgeSyncedAt,
    hasCachedAiKnowledge: project.hasCachedAiKnowledge,
    aiKnowledgeSources: project.aiKnowledgeSources,
    aiOperatingContext: project.aiOperatingContext,
    aiOptimizedSynthesizedAt: project.aiOptimizedSynthesizedAt,
    aiOptimizedInputHash: project.aiOptimizedInputHash,
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

function buildSubtitleParts({
  alias,
  salesforceProjectId,
  sourceCount,
  isActive,
  autoSyncSchedule,
  hideAlias
}: {
  readonly alias: string | null;
  readonly salesforceProjectId: string | null;
  readonly sourceCount: number;
  readonly isActive: boolean;
  readonly autoSyncSchedule: "never" | "daily" | "weekly";
  readonly hideAlias: boolean;
}): readonly string[] {
  const parts: string[] = [];

  if (!hideAlias && alias && alias.trim().length > 0) {
    parts.push(alias.trim());
  }

  if (salesforceProjectId && salesforceProjectId.length > 0) {
    parts.push(salesforceProjectId);
  }

  parts.push(`${String(sourceCount)} source${sourceCount === 1 ? "" : "s"}`);

  parts.push(isActive ? `Syncs ${autoSyncSchedule}` : "Inactive");

  return parts;
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
  const [projectAliasDraft, setProjectAliasDraft] = useState(project.projectAlias ?? "");
  const [signatureDrafts, setSignatureDrafts] = useState(() =>
    buildSignatureDrafts(project.emails)
  );
  const [signatureErrors, setSignatureErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(
    null
  );
  const [newEmail, setNewEmail] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingSignatureId, setPendingSignatureId] = useState<string | null>(null);
  const [projectAliasPending, startProjectAliasTransition] = useTransition();
  const [emailPending, startEmailTransition] = useTransition();
  const [signaturePending, startSignatureTransition] = useTransition();
  const [activationPending, startActivationTransition] = useTransition();
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function commitProject(nextProject: ProjectMutationData) {
    setProjectState(nextProject);
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
      setEditingSignatureId((current) => (current === null ? current : null));
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
      setEditingSignatureId(null);
      announce(`Saved the signature for ${result.data.alias}.`);
    });
  }

  function handleCancelSignatureEdit(email: ProjectEmailMutationData) {
    setSignatureDrafts((current) => ({
      ...current,
      [email.id]: email.signature
    }));
    setSignatureErrors((current) => ({
      ...current,
      [email.id]: undefined
    }));
    setEditingSignatureId(null);
  }

  function handleToggleSignatureEdit(emailId: string) {
    setEditingSignatureId((current) => (current === emailId ? null : emailId));
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
      const cascadedCount = result.data.cascadedSubProjects.length;
      const cascadedNote =
        cascadedCount === 0
          ? ""
          : ` (${String(cascadedCount)} connected sub-project${
              cascadedCount === 1 ? "" : "s"
            } also deactivated)`;
      announce(
        `${result.data.projectName} is now inactive.${cascadedNote}`
      );
    });
  }

  function handleDisconnect() {
    startActivationTransition(async () => {
      applyOptimisticProject({
        isActive: false,
        connectedToProjectId: null
      });
      const result = await disconnectProjectAction(project.projectId);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitProject(result.data);
      announce(
        `Disconnected ${result.data.projectName} from its host. The project is now inactive.`
      );
    });
  }

  const projectAliasDirty =
    projectAliasDraft.trim() !== (optimisticProject.projectAlias ?? "");
  const inactiveActivationMessage =
    activationMessage ??
    (!optimisticProject.activationRequirementsMet
      ? "Activation needs a short project alias and a project inbox alias."
      : null);
  const signatureEmails = [...optimisticProject.emails].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) {
      return left.isPrimary ? -1 : 1;
    }

    return left.address.localeCompare(right.address);
  });
  const signaturePlaceholderProjectName =
    optimisticProject.projectAlias ?? optimisticProject.projectName;

  // Connection state derived from the optimistic snapshot. A sub-project
  // (connectedToProjectId set) inherits its alias and AI Knowledge from the
  // host, so the corresponding fields are read-only and show inherited
  // values. A host with non-empty alias and no parent is the only state in
  // which the "Connected projects" card renders.
  const isConnectedSub = optimisticProject.connectedToProjectId !== null;
  const connectedHost = project.connectedToHost;
  const isHost =
    !isConnectedSub &&
    optimisticProject.isActive &&
    (optimisticProject.projectAlias?.trim().length ?? 0) > 0;
  const cascadeSubProjects = project.connectedProjects;

  const subtitleParts = buildSubtitleParts({
    alias: optimisticProject.projectAlias,
    salesforceProjectId: project.salesforceProjectId,
    sourceCount: project.aiKnowledgeSources.length,
    isActive: optimisticProject.isActive,
    autoSyncSchedule: project.aiAutoSyncSchedule,
    hideAlias: isConnectedSub
  });

  // Danger zone tab is admin-only. For sub-projects it surfaces "Disconnect
  // from host"; for hosts/standalone active projects it surfaces "Deactivate
  // project". Inactive standalone projects without a host have no destructive
  // action available, so the tab is hidden in that case.
  const dangerZoneAvailable =
    project.isAdmin &&
    (isConnectedSub || optimisticProject.isActive);

  const tabs: readonly { readonly id: TabId; readonly label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "ai-knowledge", label: "AI knowledge" },
    ...(dangerZoneAvailable
      ? ([{ id: "danger-zone", label: "Danger zone" }] as const)
      : [])
  ];

  return (
    <div className="flex flex-col gap-6">
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
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Projects
        </Link>

        <div className="flex flex-col gap-1.5">
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
            {isConnectedSub && connectedHost ? (
              <Link
                href={`/settings/projects/${encodeURIComponent(
                  connectedHost.projectId
                )}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11.5px] font-medium text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100",
                  TRANSITION.fast,
                  FOCUS_RING
                )}
              >
                Connected to {connectedHost.projectName}
              </Link>
            ) : null}
          </div>
          {subtitleParts.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              {subtitleParts.map((part, index) => (
                <React.Fragment key={`subtitle-${String(index)}`}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                  ) : null}
                  <span
                    className={
                      part === project.salesforceProjectId
                        ? "font-mono text-[12.5px] text-slate-500"
                        : undefined
                    }
                  >
                    {part}
                  </span>
                </React.Fragment>
              ))}
            </p>
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

      <div
        role="tablist"
        aria-label="Project sections"
        className="flex items-center gap-6 border-b border-slate-200"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`project-tabpanel-${tab.id}`}
              id={`project-tab-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              className={cn(
                "-mb-px inline-flex items-center border-b-2 px-0.5 pb-3 pt-2 text-sm",
                TRANSITION.fast,
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2",
                isActive
                  ? "border-slate-900 font-semibold text-slate-900"
                  : "border-transparent font-medium text-slate-500 hover:text-slate-800"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="project-tabpanel-overview"
        aria-labelledby="project-tab-overview"
        hidden={activeTab !== "overview"}
        className={cn(activeTab === "overview" && "flex flex-col gap-5")}
      >
        <SettingsCard
          title="Project basics"
          description="Internal name and CRM record."
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="project-short-alias"
                className={cn(TYPE.label, "text-slate-600")}
              >
                Project alias
              </label>
              {isConnectedSub && connectedHost ? (
                <>
                  <Input
                    id="project-short-alias"
                    value={connectedHost.projectAlias ?? ""}
                    disabled
                    readOnly
                    className="font-mono text-[13px]"
                  />
                  <span className={cn(TYPE.caption, "text-slate-500")}>
                    Inherited from{" "}
                    <Link
                      href={`/settings/projects/${encodeURIComponent(
                        connectedHost.projectId
                      )}`}
                      className="font-medium text-sky-700 hover:underline"
                    >
                      {connectedHost.projectName}
                    </Link>
                    .
                  </span>
                </>
              ) : (
                <>
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
                </>
              )}
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
        </SettingsCard>

        <SettingsCard
          title="Inbox aliases & signatures"
          description="Addresses that route mail in. One signature each."
          action={
            project.isAdmin ? (
              <InboxAliasAddControl
                value={newEmail}
                onChange={(value) => {
                  setNewEmail(value);
                  setActivationMessage(null);
                }}
                onAdd={handleAddEmail}
                disabled={emailPending}
              />
            ) : null
          }
        >
          <div className="flex flex-col gap-2">
            {signatureEmails.map((email) => {
              const isRowPending = emailPending && pendingEmail === email.address;
              const isExpanded = editingSignatureId === email.id;
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
                    "rounded-md border border-slate-200 bg-white",
                    isRowPending && "opacity-60"
                  )}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Mail
                      className="size-3.5 shrink-0 text-slate-400"
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
                    {project.isAdmin ? (
                      <button
                        type="button"
                        aria-label={`Edit signature for ${email.address}`}
                        aria-expanded={isExpanded}
                        onClick={() => {
                          handleToggleSignatureEdit(email.id);
                        }}
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                          TRANSITION.fast,
                          FOCUS_RING,
                          RADIUS.sm,
                          isExpanded && "bg-slate-100 text-slate-700"
                        )}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
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
                          "flex size-9 shrink-0 items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600",
                          TRANSITION.fast,
                          FOCUS_RING,
                          RADIUS.sm,
                          "disabled:cursor-not-allowed disabled:opacity-40"
                        )}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {project.isAdmin && isExpanded ? (
                    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`project-email-signature-${email.id}`}
                          className={cn(TYPE.label, "text-slate-600")}
                        >
                          Email signature
                        </label>
                        <textarea
                          id={`project-email-signature-${email.id}`}
                          value={signatureDraft}
                          onChange={(event) => {
                            handleSignatureDraftChange(
                              email.id,
                              event.target.value
                            );
                          }}
                          disabled={isSignaturePending}
                          rows={5}
                          className={cn(
                            "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200",
                            signatureError &&
                              "border-rose-300 bg-rose-50/40 text-rose-900"
                          )}
                          placeholder={`Warmly,\nThe ${signaturePlaceholderProjectName} Team\nAdventure Scientists`}
                        />
                        <span className={cn(TYPE.caption, "text-slate-500")}>
                          Appended to every outbound email from this alias.
                        </span>
                        {signatureError ? (
                          <p className="text-[11.5px] text-rose-600">
                            {signatureError}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          {!email.isPrimary ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={emailPending}
                              onClick={() => {
                                handleMakePrimary(email.address);
                              }}
                            >
                              Make primary
                            </Button>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isSignaturePending}
                            onClick={() => {
                              handleCancelSignatureEdit(email);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={isSignaturePending || !signatureDirty}
                            onClick={() => {
                              handleSaveSignature(email);
                            }}
                          >
                            Save signature
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {optimisticProject.emails.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
                <p className={TYPE.caption}>No connected addresses yet.</p>
              </div>
            ) : null}
          </div>
        </SettingsCard>

        {isHost ? (
          <SettingsCard
            title="Connected projects"
            description="Inactive projects routed through this one."
          >
            <ProjectConnectedProjectsSection
              hostProjectId={project.projectId}
              isAdmin={project.isAdmin}
              initialConnectedProjects={project.connectedProjects}
              initialAvailableCandidates={project.availableConnectionCandidates}
            />
          </SettingsCard>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="project-tabpanel-ai-knowledge"
        aria-labelledby="project-tab-ai-knowledge"
        hidden={activeTab !== "ai-knowledge"}
        className={cn(activeTab === "ai-knowledge" && "flex flex-col gap-5")}
      >
        {isConnectedSub && connectedHost ? (
          <SettingsCard
            title="AI Knowledge"
            description="AI Knowledge is inherited from the host project."
          >
            <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-3">
              <p className={cn(TYPE.caption, "text-slate-700")}>
                AI Knowledge is inherited from{" "}
                <Link
                  href={`/settings/projects/${encodeURIComponent(
                    connectedHost.projectId
                  )}`}
                  className="font-medium text-sky-700 hover:underline"
                >
                  {connectedHost.projectName}
                </Link>
                {connectedHost.aiKnowledgeUrl !== null
                  ? ". Manage sources from the host project."
                  : ". The host has no AI Knowledge URL configured yet."}
              </p>
            </div>
          </SettingsCard>
        ) : (
          <ProjectAiKnowledgeSection
            projectId={project.projectId}
            isAdmin={project.isAdmin}
            initialSources={project.aiKnowledgeSources}
            initialOperatingContext={project.aiOperatingContext}
            initialAutoSyncSchedule={project.aiAutoSyncSchedule}
            aiOptimizedSynthesizedAt={project.aiOptimizedSynthesizedAt}
            aiKnowledgeSynthesisStale={project.aiKnowledgeSynthesisStale}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="project-tabpanel-danger-zone"
        aria-labelledby="project-tab-danger-zone"
        hidden={activeTab !== "danger-zone"}
        className={cn(activeTab === "danger-zone" && "flex flex-col gap-5")}
      >
        {project.isAdmin && optimisticProject.isActive && !isConnectedSub ? (
          <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-rose-700">
                  Deactivate project
                </h3>
                <p className="max-w-2xl text-[13px] leading-relaxed text-rose-700/90">
                  Stops routing mail to this project. Existing threads stay
                  searchable in the inbox but new mail addressed to this
                  project&apos;s aliases will bounce. You can reactivate from the
                  Projects list later.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rose-200/70 pt-4">
                <p className="text-[12.5px] text-rose-700/90">
                  This will affect{" "}
                  <span className="font-semibold text-rose-800">
                    {String(project.memberCount)}
                  </span>{" "}
                  linked volunteer{project.memberCount === 1 ? "" : "s"}.
                </p>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                  >
                    Deactivate project
                  </Button>
                </DialogTrigger>
              </div>
            </div>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Deactivate {project.projectName}?</DialogTitle>
                <DialogDescription>
                  {cascadeSubProjects.length === 0
                    ? "This will hide the project from the active list. Continue?"
                    : `Deactivating this project will also deactivate ${cascadeSubProjects
                        .map((sub) => sub.projectName)
                        .join(", ")} (currently connected). Continue?`}
                </DialogDescription>
              </DialogHeader>
              {cascadeSubProjects.length > 0 ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900">
                  <p className="font-medium">
                    {String(cascadeSubProjects.length)} connected sub-project
                    {cascadeSubProjects.length === 1 ? "" : "s"} will also
                    deactivate:
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {cascadeSubProjects.map((sub) => (
                      <li key={sub.projectId}>{sub.projectName}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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

        {project.isAdmin && isConnectedSub ? (
          <ConnectedSubDisconnectControl
            projectName={project.projectName}
            hostName={connectedHost?.projectName ?? "host"}
            memberCount={project.memberCount}
            onDisconnect={handleDisconnect}
            disabled={activationPending}
          />
        ) : null}
      </div>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  action,
  children
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "p-5",
        RADIUS.md,
        "border border-slate-200 bg-white",
        SHADOW.sm
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={TYPE.headingSm}>{title}</h3>
          {description ? (
            <p className={cn(TYPE.caption, "mt-1 text-slate-500")}>
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InboxAliasAddControl({
  value,
  onChange,
  onAdd,
  disabled
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onAdd: () => void;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          + Add alias
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add inbox alias</DialogTitle>
          <DialogDescription>
            Mail sent to this address routes into this project&apos;s inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-2">
          <label htmlFor="project-email-input" className={TYPE.label}>
            Email address
          </label>
          <Input
            id="project-email-input"
            type="email"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            disabled={disabled}
            placeholder="project@asc.internal"
            className="font-mono text-[13px]"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
            disabled={disabled}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onAdd();
              setOpen(false);
            }}
            disabled={disabled || value.trim().length === 0}
          >
            Save alias
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectedSubDisconnectControl({
  projectName,
  hostName,
  memberCount,
  onDisconnect,
  disabled
}: {
  readonly projectName: string;
  readonly hostName: string;
  readonly memberCount: number;
  readonly onDisconnect: () => void;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-rose-700">
            Disconnect from {hostName}
          </h3>
          <p className="max-w-2xl text-[13px] leading-relaxed text-rose-700/90">
            Deactivates {projectName} and stops volunteers from rolling up to{" "}
            {hostName}. You can reconnect later from the Projects list.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rose-200/70 pt-4">
          <p className="text-[12.5px] text-rose-700/90">
            This will affect{" "}
            <span className="font-semibold text-rose-800">
              {String(memberCount)}
            </span>{" "}
            linked volunteer{memberCount === 1 ? "" : "s"}.
          </p>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            >
              <Link2Off className="mr-1 inline size-3.5" aria-hidden="true" />
              Disconnect project
            </Button>
          </DialogTrigger>
        </div>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Disconnect {projectName} from {hostName}?
          </DialogTitle>
          <DialogDescription>
            This project will be deactivated and its volunteers will no longer
            roll up to {hostName}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
            disabled={disabled}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            disabled={disabled}
          >
            Disconnect project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
