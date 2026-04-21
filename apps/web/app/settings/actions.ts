"use server";

import { randomUUID } from "node:crypto";

import {
  createProjectAliasSchema,
  type IntegrationHealthRecord
} from "@as-comms/contracts";

import { resolveAdminSession } from "@/src/server/auth/api";
import { appendSecurityAudit } from "@/src/server/security/audit";
import {
  isMissingIntegrationHealthTableError,
  refreshIntegrationHealthRecord
} from "@/src/server/settings/integration-health";
import {
  revalidateIntegrationHealth,
  revalidateProjectSettings
} from "@/src/server/settings/revalidate";
import { getSettingsRepositories } from "@/src/server/stage1-runtime";
import type { UiError, UiResult } from "@/src/server/ui-result";

import {
  getProjectAliasSignatureValidationError,
  normalizeProjectAliasSignature
} from "./_lib/project-alias-signature";

function newRequestId(): string {
  return randomUUID();
}

function readOptionalString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function errorResult(
  code: string,
  message: string,
  input?: {
    readonly fieldErrors?: Record<string, string>;
    readonly retryable?: boolean;
  }
): UiError {
  return {
    ok: false,
    code,
    message,
    requestId: newRequestId(),
    ...(input?.fieldErrors === undefined
      ? {}
      : {
          fieldErrors: input.fieldErrors
        }),
    ...(input?.retryable === undefined
      ? {}
      : {
          retryable: input.retryable
        })
  };
}

function hasActivationRequirements(input: {
  readonly aiKnowledgeUrl: string | null;
  readonly emails: readonly { readonly address: string; readonly isPrimary: boolean }[];
}): boolean {
  return (
    input.emails.length >= 1 &&
    (input.aiKnowledgeUrl?.trim().length ?? 0) > 0
  );
}

function serializeProjectMutationData(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: Date | null;
  readonly emails: readonly {
    readonly id: string;
    readonly address: string;
    readonly isPrimary: boolean;
    readonly signature: string;
  }[];
}): ProjectMutationData {
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt?.toISOString() ?? null,
    activationRequirementsMet: hasActivationRequirements({
      aiKnowledgeUrl: input.aiKnowledgeUrl,
      emails: input.emails
    }),
    emails: input.emails.map((email) => ({
      id: email.id,
      address: email.address,
      isPrimary: email.isPrimary,
      signature: email.signature
    }))
  };
}

async function resolveSettingsAdmin(input: {
  readonly unauthorizedMessage: string;
  readonly forbiddenMessage: string;
}): Promise<
  | {
      readonly ok: true;
      readonly userId: string;
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    }
> {
  const session = await resolveAdminSession();
  if (!session.ok) {
    return {
      ok: false,
      error:
        session.code === "unauthorized"
          ? errorResult("unauthorized", input.unauthorizedMessage)
          : errorResult("forbidden", input.forbiddenMessage)
    };
  }

  return {
    ok: true,
    userId: session.user.id
  };
}

async function appendSettingsAudit(input: {
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadataJson?: Readonly<Record<string, unknown>>;
}): Promise<void> {
  await appendSecurityAudit({
    actorType: "user",
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    result: "recorded",
    policyCode: "settings.admin_mutation",
    metadataJson: input.metadataJson ?? {}
  });
}

function notImplementedResult(message: string): UiError {
  return errorResult("not_implemented", message);
}

function normalizeIncomingEmail(address: string): string {
  return address.trim().toLowerCase();
}

function validateProjectEmails(
  emails: readonly ProjectEmailInput[]
):
  | {
      readonly ok: true;
      readonly orderedEmails: readonly ProjectEmailInput[];
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    } {
  const normalizedEmails = emails.map((email) => ({
    address: normalizeIncomingEmail(email.address),
    isPrimary: email.isPrimary
  }));

  for (const email of normalizedEmails) {
    const parsed = createProjectAliasSchema.shape.alias.safeParse(email.address);
    if (!parsed.success) {
      return {
        ok: false,
        error: errorResult(
          "invalid_email_format",
          "Enter a valid project email address.",
          {
            fieldErrors: {
              emails: "Enter a valid project email address."
            }
          }
        )
      };
    }
  }

  const distinctEmails = new Set(normalizedEmails.map((email) => email.address));
  if (distinctEmails.size !== normalizedEmails.length) {
    return {
      ok: false,
      error: errorResult(
        "duplicate_email",
        "Each project email must be unique.",
        {
          fieldErrors: {
            emails: "Each project email must be unique."
          }
        }
      )
    };
  }

  if (normalizedEmails.length === 0) {
    return {
      ok: true,
      orderedEmails: []
    };
  }

  const primaryCount = normalizedEmails.filter((email) => email.isPrimary).length;
  if (primaryCount === 0) {
    return {
      ok: false,
      error: errorResult(
        "primary_email_required",
        "Choose one primary email address.",
        {
          fieldErrors: {
            emails: "Choose one primary email address."
          }
        }
      )
    };
  }

  if (primaryCount > 1) {
    return {
      ok: false,
      error: errorResult(
        "multiple_primary_emails",
        "Choose exactly one primary email address.",
        {
          fieldErrors: {
            emails: "Choose exactly one primary email address."
          }
        }
      )
    };
  }

  const primaryEmail = normalizedEmails.find((email) => email.isPrimary);
  const orderedEmails = normalizedEmails
    .filter((email) => !email.isPrimary)
    .map((email) => ({
      address: email.address,
      isPrimary: false
    }));

  return {
    ok: true,
    orderedEmails:
      primaryEmail === undefined
        ? orderedEmails
        : [
            {
              address: primaryEmail.address,
              isPrimary: true
            },
            ...orderedEmails
          ]
  };
}

function normalizeAiKnowledgeUrl(
  rawUrl: string | null
):
  | {
      readonly ok: true;
      readonly url: string | null;
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    } {
  const trimmed = rawUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    return {
      ok: true,
      url: null
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        error: errorResult(
          "invalid_url",
          "AI knowledge URL must start with https://.",
          {
            fieldErrors: {
              aiKnowledgeUrl: "AI knowledge URL must start with https://."
            }
          }
        )
      };
    }

    return {
      ok: true,
      url: parsed.toString()
    };
  } catch {
    return {
      ok: false,
      error: errorResult(
        "invalid_url",
        "Enter a valid AI knowledge URL.",
        {
          fieldErrors: {
            aiKnowledgeUrl: "Enter a valid AI knowledge URL."
          }
        }
      )
    };
  }
}

function isProjectAliasConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  return (
    code === "23505" ||
    /project_aliases_alias_unique|duplicate key value violates unique constraint/iu.test(
      message
    )
  );
}

export interface ProjectEmailInput {
  readonly address: string;
  readonly isPrimary: boolean;
}

export interface ProjectEmailMutationData extends ProjectEmailInput {
  readonly id: string;
  readonly signature: string;
}

export interface ProjectMutationData {
  readonly projectId: string;
  readonly projectName: string;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: string | null;
  readonly activationRequirementsMet: boolean;
  readonly emails: readonly ProjectEmailMutationData[];
}

function truncateAuditValue(value: string): string {
  return value.slice(0, 500);
}

export interface ProjectAliasSignatureMutationData {
  readonly id: string;
  readonly alias: string;
  readonly signature: string;
}

// ─── Projects ───────────────────────────────────────────────────────────────

export async function activateProjectAction(
  projectId: string
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to activate a project.",
    forbiddenMessage: "Only admins can activate projects."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const project = await repositories.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  if (project.isActive) {
    return errorResult("already_active", "This project is already active.");
  }

  if (project.emails.length < 1) {
    return errorResult(
      "requirements_not_met",
      "Add at least one email and an AI knowledge URL to activate this project.",
      {
        fieldErrors: {
          emails: "Add at least one email to activate this project."
        }
      }
    );
  }

  if ((project.aiKnowledgeUrl?.trim().length ?? 0) === 0) {
    return errorResult(
      "requirements_not_met",
      "Add at least one email and an AI knowledge URL to activate this project.",
      {
        fieldErrors: {
          aiKnowledgeUrl:
            "Add an AI knowledge URL to activate this project."
        }
      }
    );
  }

  const updatedProject = await repositories.projects.setActive(projectId, true);
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.activated",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: {
        isActive: project.isActive
      },
      after: {
        isActive: updatedProject.isActive
      }
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

export interface UpdateProjectAliasResult {
  readonly id: string;
  readonly alias: string;
}

export async function updateProjectAliasAction(
  formData: FormData
): Promise<UiResult<UpdateProjectAliasResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update project aliases.",
    forbiddenMessage: "Only admins can update project aliases."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult(
    "Project alias editing is not implemented in this brief."
  );
}

export async function updateProjectEmailsAction(
  projectId: string,
  emails: readonly ProjectEmailInput[]
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update project emails.",
    forbiddenMessage: "Only admins can update project emails."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const project = await repositories.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  const validation = validateProjectEmails(emails);
  if (!validation.ok) {
    return validation.error;
  }

  for (const email of validation.orderedEmails) {
    const existingAlias = await repositories.aliases.findByAlias(email.address);
    if (
      existingAlias !== null &&
      existingAlias.projectId !== null &&
      existingAlias.projectId !== projectId
    ) {
      return errorResult(
        "email_in_use",
        `${email.address} is already assigned to another project.`,
        {
          fieldErrors: {
            emails: `${email.address} is already assigned to another project.`
          }
        }
      );
    }
  }

  try {
    await repositories.aliases.replaceForProject({
      projectId,
      aliases: validation.orderedEmails.map((email) => email.address),
      actorId: admin.userId
    });
  } catch (error) {
    if (isProjectAliasConflictError(error)) {
      return errorResult(
        "email_in_use",
        "One of those email addresses is already assigned to another project.",
        {
          fieldErrors: {
            emails:
              "One of those email addresses is already assigned to another project."
          }
        }
      );
    }

    throw error;
  }

  const updatedProject = await repositories.projects.findById(projectId);
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.email_changed",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: project.emails,
      after: updatedProject.emails
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

export async function updateProjectAliasSignatureAction(
  aliasId: string,
  signature: string
): Promise<UiResult<ProjectAliasSignatureMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update an alias signature.",
    forbiddenMessage: "Only admins can update alias signatures."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const alias = await repositories.aliases.findById(aliasId);
  if (alias?.projectId == null) {
    return errorResult("not_found", "That project email no longer exists.");
  }

  const normalizedSignature = normalizeProjectAliasSignature(signature);
  const validationError =
    getProjectAliasSignatureValidationError(normalizedSignature);
  if (validationError !== null) {
    return errorResult("invalid_signature", validationError, {
      fieldErrors: {
        signature: validationError
      }
    });
  }

  const updatedAlias = await repositories.aliases.updateSignature({
    aliasId,
    signature: normalizedSignature,
    actorId: admin.userId
  });
  if (updatedAlias === null) {
    return errorResult("not_found", "That project email no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.alias_signature_updated",
    entityType: "project_alias",
    entityId: aliasId,
    metadataJson: {
      alias: updatedAlias.alias,
      projectId: alias.projectId,
      before: truncateAuditValue(alias.signature),
      after: truncateAuditValue(updatedAlias.signature)
    }
  });

  revalidateProjectSettings(alias.projectId);

  return {
    ok: true,
    data: {
      id: updatedAlias.id,
      alias: updatedAlias.alias,
      signature: updatedAlias.signature
    },
    requestId: newRequestId()
  };
}

export async function updateProjectAiKnowledgeAction(
  projectId: string,
  url: string | null
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage:
      "You must be signed in to update the AI knowledge URL.",
    forbiddenMessage: "Only admins can update the AI knowledge URL."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const project = await repositories.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  const normalizedUrl = normalizeAiKnowledgeUrl(url);
  if (!normalizedUrl.ok) {
    return normalizedUrl.error;
  }

  const updatedProject = await repositories.projects.setAiKnowledgeUrl(
    projectId,
    normalizedUrl.url
  );
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.ai_knowledge_updated",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: project.aiKnowledgeUrl,
      after: updatedProject.aiKnowledgeUrl
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

export async function deactivateProjectAction(
  projectId: string
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to deactivate a project.",
    forbiddenMessage: "Only admins can deactivate projects."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const project = await repositories.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  if (!project.isActive) {
    return errorResult("already_inactive", "This project is already inactive.");
  }

  const updatedProject = await repositories.projects.setActive(projectId, false);
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.deactivated",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: {
        isActive: project.isActive
      },
      after: {
        isActive: updatedProject.isActive
      }
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

// ─── Access (users) ─────────────────────────────────────────────────────────

export interface InviteUserResult {
  readonly email: string;
  readonly role: "admin" | "internal_user";
}

export async function inviteUserAction(
  formData: FormData
): Promise<UiResult<InviteUserResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to invite teammates.",
    forbiddenMessage: "Only admins can invite teammates."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const rawRole = readOptionalString(formData, "role") ?? "internal_user";
  const role: "admin" | "internal_user" =
    rawRole === "admin" ? "admin" : "internal_user";

  void role;
  void formData;

  return notImplementedResult("User invites are intentionally stubbed in this brief.");
}

export interface UserIdResult {
  readonly id: string;
}

export async function promoteUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update user access.",
    forbiddenMessage: "Only admins can update user access."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult(
    "User promotion is intentionally stubbed in this brief."
  );
}

export async function demoteUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update user access.",
    forbiddenMessage: "Only admins can update user access."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult(
    "User demotion is intentionally stubbed in this brief."
  );
}

export async function deactivateUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update user access.",
    forbiddenMessage: "Only admins can update user access."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult(
    "User deactivation is intentionally stubbed in this brief."
  );
}

export async function reactivateUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update user access.",
    forbiddenMessage: "Only admins can update user access."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult(
    "User reactivation is intentionally stubbed in this brief."
  );
}

// ─── Integrations ───────────────────────────────────────────────────────────

export interface IntegrationIdResult {
  readonly id: string;
}

export async function syncIntegrationAction(
  formData: FormData
): Promise<UiResult<IntegrationIdResult>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to refresh integrations.",
    forbiddenMessage: "Only admins can refresh integrations."
  });
  if (!admin.ok) {
    return admin.error;
  }

  void formData;

  return notImplementedResult("Use refreshIntegrationHealthAction instead.");
}

export async function refreshIntegrationHealthAction(
  serviceName: string
): Promise<UiResult<IntegrationHealthRecord>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to refresh integration health.",
    forbiddenMessage: "Only admins can refresh integration health."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const normalizedServiceName = serviceName.trim();
  if (normalizedServiceName.length === 0) {
    return errorResult("validation_error", "A service name is required.");
  }

  try {
    const record = await refreshIntegrationHealthRecord(normalizedServiceName);
    await appendSettingsAudit({
      actorId: admin.userId,
      action: "settings.integration.refreshed",
      entityType: "integration",
      entityId: record.serviceName,
      metadataJson: {
        status: record.status,
        checkedAt: record.lastCheckedAt
      }
    });
    revalidateIntegrationHealth();
    return {
      ok: true,
      data: record,
      requestId: newRequestId()
    };
  } catch (error) {
    if (isMissingIntegrationHealthTableError(error)) {
      return errorResult(
        "dependency_unavailable",
        "Integration health storage is not available yet.",
        {
          retryable: true
        }
      );
    }

    if (
      error instanceof Error &&
      /invalid_enum_value|Invalid enum value/iu.test(error.message)
    ) {
      return errorResult("validation_error", "Unknown integration service.");
    }

    return errorResult(
      "integration_refresh_failed",
      "Unable to refresh integration health right now.",
      {
        retryable: true
      }
    );
  }
}
