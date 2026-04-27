"use server";

import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import {
  createProjectAliasSchema,
  deactivateUserSchema,
  demoteUserSchema,
  notionKnowledgeSyncJobName,
  notionKnowledgeSyncPayloadSchema,
  promoteUserSchema,
  reactivateUserSchema,
  type IntegrationHealthRecord
} from "@as-comms/contracts";

import { resolveAdminSession } from "@/src/server/auth/api";
import { appendSecurityAudit } from "@/src/server/security/audit";
import {
  isMissingIntegrationHealthTableError,
  refreshIntegrationHealthRecord
} from "@/src/server/settings/integration-health";
import {
  revalidateAccessSettings,
  revalidateIntegrationHealth,
  revalidateProjectSettings
} from "@/src/server/settings/revalidate";
import {
  getSettingsRepositories,
  getStage1WebRuntime
} from "@/src/server/stage1-runtime";
import type { UiError, UiResult } from "@/src/server/ui-result";

import {
  getProjectAliasSignatureValidationError,
  normalizeProjectAliasSignature
} from "./_lib/project-alias-signature";

type SettingsRepositories = Awaited<ReturnType<typeof getSettingsRepositories>>;

const projectKnowledgeUpdateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["canonical_reply", "snippet", "pattern"]),
  issueType: z.string().trim().min(1).nullable(),
  volunteerStage: z.string().trim().min(1).nullable(),
  questionSummary: z.string().trim().min(1),
  replyStrategy: z.string().trim().min(1).nullable(),
  maskedExample: z.string().trim().min(1).nullable()
});

const projectKnowledgeIdSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1)
});

const projectKnowledgeApprovedSchema = projectKnowledgeIdSchema.extend({
  approved: z.boolean()
});

const activationWizardAliasSchema = z.object({
  address: z.string().trim().min(1, "Alias address is required."),
  isPrimary: z.boolean()
});

const activationWizardInputSchema = z
  .object({
    projectId: z.string().trim().min(1, "Project is required."),
    projectAlias: z
      .string()
      .trim()
      .min(2, "Project alias must be at least 2 characters.")
      .max(80, "Project alias must be 80 characters or fewer."),
    aliases: z
      .array(activationWizardAliasSchema)
      .min(1, "Add at least one inbox alias.")
      .max(20, "Add no more than 20 inbox aliases."),
    signature: z.string()
  })
  .superRefine((input, ctx) => {
    const normalizedSignature = normalizeActivationWizardSignature(
      input.signature
    );
    if (normalizedSignature.length < 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signature"],
        message: "Signature must be at least 4 characters."
      });
    }

    const signatureValidationError =
      getProjectAliasSignatureValidationError(normalizedSignature);
    if (signatureValidationError !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signature"],
        message: signatureValidationError
      });
    }

    const primaryCount = input.aliases.filter((alias) => alias.isPrimary).length;
    if (primaryCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aliases"],
        message: "Choose one primary inbox alias."
      });
    }
    if (primaryCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aliases"],
        message: "Choose exactly one primary inbox alias."
      });
    }

    const seenAliases = new Set<string>();
    for (const [index, alias] of input.aliases.entries()) {
      const normalizedAddress = normalizeIncomingEmail(alias.address);
      const parsed = createProjectAliasSchema.shape.alias.safeParse(
        normalizedAddress
      );
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", index, "address"],
          message: "Enter a valid inbox alias."
        });
      }

      if (seenAliases.has(normalizedAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases"],
          message: "Each inbox alias must be unique."
        });
      }
      seenAliases.add(normalizedAddress);
    }
  });

export interface ProjectKnowledgeMutationData {
  readonly id: string;
}

export interface ActivationWizardInput {
  readonly projectId: string;
  readonly projectAlias: string;
  readonly aliases: readonly {
    readonly address: string;
    readonly isPrimary: boolean;
  }[];
  readonly signature: string;
}

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
  readonly projectAlias: string | null;
  readonly aiKnowledgeUrl: string | null;
  readonly emails: readonly { readonly address: string; readonly isPrimary: boolean }[];
}): boolean {
  return (
    input.emails.length >= 1 &&
    input.aiKnowledgeUrl !== null &&
    (input.projectAlias?.trim().length ?? 0) > 0
  );
}

function serializeProjectMutationData(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias: string | null;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: Date | null;
  readonly hasCachedAiKnowledge: boolean;
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
    projectAlias: input.projectAlias,
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt?.toISOString() ?? null,
    hasCachedAiKnowledge: input.hasCachedAiKnowledge,
    activationRequirementsMet: hasActivationRequirements({
      projectAlias: input.projectAlias,
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

function normalizeIncomingEmail(address: string): string {
  return address.trim().toLowerCase();
}

function notImplementedResult(message: string): UiError {
  return errorResult("not_implemented", message);
}

function normalizeProjectAliasValue(
  rawAlias: string | null
):
  | {
      readonly ok: true;
      readonly projectAlias: string | null;
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    } {
  const normalized = rawAlias?.trim().replace(/\s+/g, " ") ?? "";

  if (normalized.length === 0) {
    return {
      ok: true,
      projectAlias: null
    };
  }

  if (normalized.length > 40) {
    return {
      ok: false,
      error: errorResult(
        "invalid_project_alias",
        "Project alias must be 40 characters or fewer.",
        {
          fieldErrors: {
            projectAlias: "Project alias must be 40 characters or fewer."
          }
        }
      )
    };
  }

  return {
    ok: true,
    projectAlias: normalized
  };
}

function normalizeActivationWizardProjectAlias(projectAlias: string): string {
  return projectAlias.trim().replace(/\s+/g, " ");
}

function normalizeActivationWizardSignature(signature: string): string {
  return normalizeProjectAliasSignature(signature).trim();
}

function orderActivationWizardAliases(
  aliases: readonly {
    readonly address: string;
    readonly isPrimary: boolean;
  }[]
): readonly {
  readonly address: string;
  readonly isPrimary: boolean;
}[] {
  const normalizedAliases = aliases.map((alias) => ({
    address: normalizeIncomingEmail(alias.address),
    isPrimary: alias.isPrimary
  }));
  const primaryAlias = normalizedAliases.find((alias) => alias.isPrimary);
  const secondaryAliases = normalizedAliases.filter((alias) => !alias.isPrimary);

  return primaryAlias === undefined
    ? secondaryAliases
    : [primaryAlias, ...secondaryAliases];
}

function flattenZodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const key = path.length === 0 ? "form" : path;
    fieldErrors[key] ??= issue.message;
  }

  return fieldErrors;
}

function readRequiredString(
  formData: FormData,
  name: string
):
  | {
      readonly ok: true;
      readonly value: string;
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    } {
  const value = readOptionalString(formData, name);
  if (value === undefined) {
    return {
      ok: false,
      error: errorResult("validation_error", "Required information is missing.", {
        fieldErrors: {
          [name]: "This field is required."
        }
      })
    };
  }

  return {
    ok: true,
    value
  };
}

function isUniqueEmailViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  return (
    code === "23505" ||
    /users_email_unique|duplicate key value violates unique constraint/iu.test(
      message
    )
  );
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
  readonly projectAlias: string | null;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: string | null;
  readonly hasCachedAiKnowledge: boolean;
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

async function enqueueNotionKnowledgeSyncJob(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly projectId: string;
  readonly trigger: "manual" | "url_save" | "activation";
}): Promise<void> {
  if (input.runtime.connection === null) {
    return;
  }

  const payload = notionKnowledgeSyncPayloadSchema.parse({
    projectId: input.projectId,
    trigger: input.trigger
  });

  await input.runtime.connection.sql`
    select graphile_worker.add_job(
      identifier => ${notionKnowledgeSyncJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => ${`notion-knowledge-sync:${input.projectId}`},
      job_key_mode => 'replace',
      max_attempts => 1
    )
  `;
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
      "Add at least one project inbox alias before activating this project.",
      {
        fieldErrors: {
          emails: "Add at least one project inbox alias to activate this project."
        }
      }
    );
  }

  if ((project.projectAlias?.trim().length ?? 0) === 0) {
    return errorResult(
      "requirements_not_met",
      "Set a project alias before activating this project.",
      {
        fieldErrors: {
          projectAlias: "Set a project alias before activating this project."
        }
      }
    );
  }

  if (project.aiKnowledgeUrl === null) {
    return errorResult(
      "requirements_not_met",
      "Set a Notion page URL before this project can be activated.",
      {
        fieldErrors: {
          aiKnowledgeUrl: "Set a Notion page URL before activating this project."
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

  try {
    const runtime = await getStage1WebRuntime();
    await enqueueNotionKnowledgeSyncJob({
      runtime,
      projectId,
      trigger: "activation"
    });
  } catch {
    // Activation remains successful even if the follow-up sync queue misses.
  }

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

export async function updateProjectAliasAction(
  projectId: string,
  projectAlias: string | null
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update the project alias.",
    forbiddenMessage: "Only admins can update the project alias."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const repositories = await getSettingsRepositories();
  const project = await repositories.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  const normalizedAlias = normalizeProjectAliasValue(projectAlias);
  if (!normalizedAlias.ok) {
    return normalizedAlias.error;
  }

  const updatedProject = await repositories.projects.setProjectAlias(
    projectId,
    normalizedAlias.projectAlias
  );
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.alias_updated",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: project.projectAlias,
      after: updatedProject.projectAlias
    }
  });

  revalidateProjectSettings(projectId);
  revalidateTag("inbox");

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
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

  const updatedProject =
    normalizedUrl.url === null
      ? await repositories.projects.unlinkAiKnowledge(projectId)
      : await repositories.projects.setAiKnowledgeUrl(projectId, normalizedUrl.url);
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  if (normalizedUrl.url !== null) {
    const runtime = await getStage1WebRuntime();
    try {
      await enqueueNotionKnowledgeSyncJob({
        runtime,
        projectId,
        trigger: "url_save"
      });
    } catch (error) {
      return errorResult(
        "enqueue_failed",
        error instanceof Error
          ? error.message
          : "The Notion sync could not be queued.",
        {
          retryable: true
        }
      );
    }
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.ai_knowledge_updated",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      before: project.aiKnowledgeUrl,
      after: updatedProject.aiKnowledgeUrl,
      cacheCleared: normalizedUrl.url === null || project.aiKnowledgeUrl !== normalizedUrl.url
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: serializeProjectMutationData(updatedProject),
    requestId: newRequestId()
  };
}

export async function updateProjectKnowledgeAction(
  rawInput: z.input<typeof projectKnowledgeUpdateSchema>
): Promise<UiResult<ProjectKnowledgeMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to update project knowledge.",
    forbiddenMessage: "Only admins can update project knowledge."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const parsed = projectKnowledgeUpdateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return errorResult("validation_error", "Project knowledge input is invalid.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message
        ])
      )
    });
  }

  const runtime = await getStage1WebRuntime();
  const entries = await runtime.repositories.projectKnowledge.list({
    projectId: parsed.data.projectId
  });
  const existing = entries.find((entry) => entry.id === parsed.data.id);
  if (existing === undefined) {
    return errorResult("not_found", "That knowledge entry no longer exists.");
  }

  await runtime.repositories.projectKnowledge.upsert({
    ...existing,
    kind: parsed.data.kind,
    issueType: parsed.data.issueType,
    volunteerStage: parsed.data.volunteerStage,
    questionSummary: parsed.data.questionSummary,
    replyStrategy: parsed.data.replyStrategy,
    maskedExample: parsed.data.maskedExample,
    updatedAt: new Date().toISOString()
  });

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project_knowledge.updated",
    entityType: "project_knowledge_entry",
    entityId: parsed.data.id,
    metadataJson: {
      projectId: parsed.data.projectId
    }
  });

  revalidateProjectSettings(parsed.data.projectId);

  return {
    ok: true,
    data: {
      id: parsed.data.id
    },
    requestId: newRequestId()
  };
}

export async function setProjectKnowledgeApprovedAction(
  rawInput: z.input<typeof projectKnowledgeApprovedSchema>
): Promise<UiResult<ProjectKnowledgeMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to approve project knowledge.",
    forbiddenMessage: "Only admins can approve project knowledge."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const parsed = projectKnowledgeApprovedSchema.safeParse(rawInput);
  if (!parsed.success) {
    return errorResult("validation_error", "Approval input is invalid.");
  }

  const runtime = await getStage1WebRuntime();
  await runtime.repositories.projectKnowledge.setApproved({
    id: parsed.data.id,
    approved: parsed.data.approved,
    reviewedAt: new Date()
  });

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project_knowledge.approval_updated",
    entityType: "project_knowledge_entry",
    entityId: parsed.data.id,
    metadataJson: {
      projectId: parsed.data.projectId,
      approved: parsed.data.approved
    }
  });

  revalidateProjectSettings(parsed.data.projectId);

  return {
    ok: true,
    data: {
      id: parsed.data.id
    },
    requestId: newRequestId()
  };
}

export async function deleteProjectKnowledgeAction(
  rawInput: z.input<typeof projectKnowledgeIdSchema>
): Promise<UiResult<ProjectKnowledgeMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to delete project knowledge.",
    forbiddenMessage: "Only admins can delete project knowledge."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const parsed = projectKnowledgeIdSchema.safeParse(rawInput);
  if (!parsed.success) {
    return errorResult("validation_error", "Delete input is invalid.");
  }

  const runtime = await getStage1WebRuntime();
  await runtime.repositories.projectKnowledge.deleteById(parsed.data.id);

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project_knowledge.deleted",
    entityType: "project_knowledge_entry",
    entityId: parsed.data.id,
    metadataJson: {
      projectId: parsed.data.projectId
    }
  });

  revalidateProjectSettings(parsed.data.projectId);

  return {
    ok: true,
    data: {
      id: parsed.data.id
    },
    requestId: newRequestId()
  };
}

export async function syncProjectAiKnowledgeAction(
  projectId: string,
): Promise<UiResult<{ projectId: string }>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to sync AI knowledge.",
    forbiddenMessage: "Only admins can sync AI knowledge."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const runtime = await getStage1WebRuntime();
  const project = await runtime.settings.projects.findById(projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  if (project.aiKnowledgeUrl === null) {
    return errorResult(
      "requirements_not_met",
      "Set a Notion page URL before syncing AI knowledge.",
      {
        fieldErrors: {
          aiKnowledgeUrl: "Set a Notion page URL before syncing AI knowledge."
        }
      }
    );
  }

  try {
    await enqueueNotionKnowledgeSyncJob({
      runtime,
      projectId,
      trigger: "manual"
    });
  } catch {
    return errorResult(
      "enqueue_failed",
      "The Notion sync could not be queued. Try again after checking the worker.",
      {
        retryable: true
      }
    );
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.ai_knowledge_sync_requested",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      projectId,
      notionUrl: project.aiKnowledgeUrl
    }
  });

  revalidateProjectSettings(projectId);

  return {
    ok: true,
    data: {
      projectId
    },
    requestId: newRequestId()
  };
}

export async function activateProjectFromWizardAction(
  input: ActivationWizardInput
): Promise<UiResult<ProjectMutationData>> {
  const admin = await resolveSettingsAdmin({
    unauthorizedMessage: "You must be signed in to activate a project.",
    forbiddenMessage: "Only admins can activate projects."
  });
  if (!admin.ok) {
    return admin.error;
  }

  const parsed = activationWizardInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult("validation_error", "Activation input is invalid.", {
      fieldErrors: flattenZodFieldErrors(parsed.error)
    });
  }

  const normalizedProjectAlias = normalizeActivationWizardProjectAlias(
    parsed.data.projectAlias
  );
  const normalizedSignature = normalizeActivationWizardSignature(
    parsed.data.signature
  );
  const orderedAliases = orderActivationWizardAliases(parsed.data.aliases);

  const runtime = await getStage1WebRuntime();
  const project = await runtime.settings.projects.findById(parsed.data.projectId);
  if (project === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  if (project.isActive) {
    return errorResult("already_active", "This project is already active.");
  }

  if (project.aiKnowledgeUrl === null) {
    return errorResult(
      "requirements_not_met",
      "Add a Notion page URL before activating this project."
    );
  }

  for (const alias of orderedAliases) {
    const existingAlias = await runtime.settings.aliases.findByAlias(alias.address);
    if (
      existingAlias !== null &&
      existingAlias.projectId !== null &&
      existingAlias.projectId !== parsed.data.projectId
    ) {
      return errorResult(
        "alias_collision",
        "An inbox alias is already taken by another project.",
        {
          fieldErrors: {
            aliases: "An inbox alias is already taken by another project."
          }
        }
      );
    }
  }

  try {
    const aliasedProject = await runtime.settings.projects.setProjectAlias(
      parsed.data.projectId,
      normalizedProjectAlias
    );
    if (aliasedProject === null) {
      return errorResult("not_found", "That project no longer exists.");
    }

    const replacedAliases = await runtime.settings.aliases.replaceForProject({
      projectId: parsed.data.projectId,
      aliases: orderedAliases.map((alias) => alias.address),
      actorId: admin.userId
    });

    for (const alias of replacedAliases) {
      const updatedAlias = await runtime.settings.aliases.updateSignature({
        aliasId: alias.id,
        signature: normalizedSignature,
        actorId: admin.userId
      });
      if (updatedAlias === null) {
        return errorResult("not_found", "That project email no longer exists.");
      }
    }
  } catch (error) {
    if (isProjectAliasConflictError(error)) {
      return errorResult(
        "alias_collision",
        "An inbox alias is already taken by another project.",
        {
          fieldErrors: {
            aliases: "An inbox alias is already taken by another project."
          }
        }
      );
    }

    throw error;
  }

  const updatedProject = await runtime.settings.projects.setActive(
    parsed.data.projectId,
    true
  );
  if (updatedProject === null) {
    return errorResult("not_found", "That project no longer exists.");
  }

  try {
    await enqueueNotionKnowledgeSyncJob({
      runtime,
      projectId: parsed.data.projectId,
      trigger: "activation"
    });
  } catch {
    // Activation still succeeds; the operator can manually re-sync if needed.
  }

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.project.activated_via_wizard",
    entityType: "project",
    entityId: parsed.data.projectId,
    metadataJson: {
      projectId: parsed.data.projectId,
      projectAlias: normalizedProjectAlias,
      aliasCount: orderedAliases.length,
      primaryAlias: orderedAliases.find((alias) => alias.isPrimary)?.address
    }
  });

  revalidateProjectSettings(parsed.data.projectId);

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
  readonly user: UserMutationData;
}

export interface UserMutationData {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: "admin" | "internal_user";
  readonly status: "active" | "pending" | "deactivated";
  readonly lastActiveAt: string | null;
}

function serializeUserMutationData(input: {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: "admin" | "operator";
  readonly emailVerified: Date | null;
  readonly deactivatedAt: Date | null;
  readonly updatedAt: Date;
}): UserMutationData {
  const status =
    input.deactivatedAt !== null
      ? "deactivated"
      : input.emailVerified === null
        ? "pending"
        : "active";

  return {
    userId: input.id,
    displayName: input.name ?? input.email,
    email: input.email,
    role: input.role === "admin" ? "admin" : "internal_user",
    status,
    lastActiveAt:
      status === "pending"
        ? null
        : (input.deactivatedAt ?? input.updatedAt).toISOString()
  };
}

async function ensureManageableUser(input: {
  readonly repositories: SettingsRepositories;
  readonly targetUserId: string;
  readonly actingUserId: string;
})
: Promise<
  | {
      readonly ok: true;
      readonly user: NonNullable<Awaited<ReturnType<SettingsRepositories["users"]["findById"]>>>;
      readonly activeAdminCount: number;
    }
  | {
      readonly ok: false;
      readonly error: UiError;
    }
> {
  const user = await input.repositories.users.findById(input.targetUserId);
  if (user === null) {
    return {
      ok: false,
      error: errorResult("not_found", "That teammate no longer exists.")
    };
  }

  if (user.id === input.actingUserId) {
    return {
      ok: false,
      error: errorResult(
        "invalid_operation",
        "You can't change your own admin access from Settings."
      )
    };
  }

  const users = await input.repositories.users.listAll();
  const activeAdminCount = users.filter(
    (candidate) => candidate.role === "admin" && candidate.deactivatedAt === null
  ).length;

  return {
    ok: true,
    user,
    activeAdminCount
  };
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

  const emailValue = readRequiredString(formData, "email");
  if (!emailValue.ok) {
    return emailValue.error;
  }

  const normalizedEmail = normalizeIncomingEmail(emailValue.value);
  const parsedEmail = createProjectAliasSchema.shape.alias.safeParse(normalizedEmail);
  if (!parsedEmail.success) {
    return errorResult("invalid_email", "Enter a valid teammate email.", {
      fieldErrors: {
        email: "Enter a valid teammate email."
      }
    });
  }

  if (!normalizedEmail.endsWith("@adventurescientists.org")) {
    return errorResult(
      "invalid_email_domain",
      "Teammates must use an @adventurescientists.org email.",
      {
        fieldErrors: {
          email: "Use an @adventurescientists.org email."
        }
      }
    );
  }

  const rawRole = readOptionalString(formData, "role") ?? "internal_user";
  const role: "admin" | "internal_user" =
    rawRole === "admin" ? "admin" : "internal_user";
  const repositories = await getSettingsRepositories();
  const existingUser = await repositories.users.findByEmail(normalizedEmail);

  if (existingUser !== null) {
    if (existingUser.deactivatedAt !== null) {
      return errorResult(
        "already_exists",
        "That teammate already exists and is currently deactivated. Reactivate them from the access list instead."
      );
    }

    return errorResult(
      existingUser.emailVerified === null ? "already_pending" : "already_exists",
      existingUser.emailVerified === null
        ? "An invite for that teammate is already pending."
        : "That teammate already has access."
    );
  }

  const now = new Date();

  try {
    const user = await repositories.users.upsert({
      id: `user:${randomUUID()}`,
      name: null,
      email: normalizedEmail,
      emailVerified: null,
      image: null,
      role: role === "admin" ? "admin" : "operator",
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now
    });

    await appendSettingsAudit({
      actorId: admin.userId,
      action: "settings.user.invited",
      entityType: "user",
      entityId: user.id,
      metadataJson: {
        email: user.email,
        role: user.role,
        status: "pending"
      }
    });

    revalidateAccessSettings();

    return {
      ok: true,
      data: {
        user: serializeUserMutationData(user)
      },
      requestId: newRequestId()
    };
  } catch (error) {
    if (isUniqueEmailViolation(error)) {
      return errorResult("already_exists", "That teammate already exists.");
    }

    throw error;
  }
}

export interface UserIdResult {
  readonly user: UserMutationData;
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

  const idValue = readRequiredString(formData, "id");
  if (!idValue.ok) {
    return idValue.error;
  }

  const parsed = promoteUserSchema.safeParse({
    id: idValue.value
  });
  if (!parsed.success) {
    return errorResult("validation_error", "Choose a teammate to promote.");
  }

  const repositories = await getSettingsRepositories();
  const manageable = await ensureManageableUser({
    repositories,
    targetUserId: parsed.data.id,
    actingUserId: admin.userId
  });
  if (!manageable.ok) {
    return manageable.error;
  }

  if (manageable.user.role === "admin") {
    return errorResult("already_admin", "That teammate is already an admin.");
  }

  const updatedUser = await repositories.users.updateRole(parsed.data.id, "admin");

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.user.promoted",
    entityType: "user",
    entityId: updatedUser.id,
    metadataJson: {
      before: {
        role: manageable.user.role
      },
      after: {
        role: updatedUser.role
      }
    }
  });

  revalidateAccessSettings();

  return {
    ok: true,
    data: {
      user: serializeUserMutationData(updatedUser)
    },
    requestId: newRequestId()
  };
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

  const idValue = readRequiredString(formData, "id");
  if (!idValue.ok) {
    return idValue.error;
  }

  const parsed = demoteUserSchema.safeParse({
    id: idValue.value
  });
  if (!parsed.success) {
    return errorResult("validation_error", "Choose a teammate to demote.");
  }

  const repositories = await getSettingsRepositories();
  const manageable = await ensureManageableUser({
    repositories,
    targetUserId: parsed.data.id,
    actingUserId: admin.userId
  });
  if (!manageable.ok) {
    return manageable.error;
  }

  if (manageable.user.role !== "admin") {
    return errorResult("already_operator", "That teammate is already an operator.");
  }

  if (manageable.activeAdminCount <= 1) {
    return errorResult("last_admin", "Keep at least one active admin on the team.");
  }

  const updatedUser = await repositories.users.updateRole(parsed.data.id, "operator");

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.user.demoted",
    entityType: "user",
    entityId: updatedUser.id,
    metadataJson: {
      before: {
        role: manageable.user.role
      },
      after: {
        role: updatedUser.role
      }
    }
  });

  revalidateAccessSettings();

  return {
    ok: true,
    data: {
      user: serializeUserMutationData(updatedUser)
    },
    requestId: newRequestId()
  };
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

  const idValue = readRequiredString(formData, "id");
  if (!idValue.ok) {
    return idValue.error;
  }

  const parsed = deactivateUserSchema.safeParse({
    id: idValue.value
  });
  if (!parsed.success) {
    return errorResult("validation_error", "Choose a teammate to deactivate.");
  }

  const repositories = await getSettingsRepositories();
  const manageable = await ensureManageableUser({
    repositories,
    targetUserId: parsed.data.id,
    actingUserId: admin.userId
  });
  if (!manageable.ok) {
    return manageable.error;
  }

  if (manageable.user.deactivatedAt !== null) {
    return errorResult(
      "already_deactivated",
      "That teammate is already deactivated."
    );
  }

  if (manageable.user.role === "admin" && manageable.activeAdminCount <= 1) {
    return errorResult("last_admin", "Keep at least one active admin on the team.");
  }

  const updatedUser = await repositories.users.setDeactivated(
    parsed.data.id,
    new Date()
  );

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.user.deactivated",
    entityType: "user",
    entityId: updatedUser.id,
    metadataJson: {
      before: {
        deactivatedAt: null
      },
      after: {
        deactivatedAt: updatedUser.deactivatedAt?.toISOString() ?? null
      }
    }
  });

  revalidateAccessSettings();

  return {
    ok: true,
    data: {
      user: serializeUserMutationData(updatedUser)
    },
    requestId: newRequestId()
  };
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

  const idValue = readRequiredString(formData, "id");
  if (!idValue.ok) {
    return idValue.error;
  }

  const parsed = reactivateUserSchema.safeParse({
    id: idValue.value
  });
  if (!parsed.success) {
    return errorResult("validation_error", "Choose a teammate to reactivate.");
  }

  const repositories = await getSettingsRepositories();
  const manageable = await ensureManageableUser({
    repositories,
    targetUserId: parsed.data.id,
    actingUserId: admin.userId
  });
  if (!manageable.ok) {
    return manageable.error;
  }

  if (manageable.user.deactivatedAt === null) {
    return errorResult("already_active", "That teammate is already active.");
  }

  const updatedUser = await repositories.users.setDeactivated(parsed.data.id, null);

  await appendSettingsAudit({
    actorId: admin.userId,
    action: "settings.user.reactivated",
    entityType: "user",
    entityId: updatedUser.id,
    metadataJson: {
      before: {
        deactivatedAt: manageable.user.deactivatedAt.toISOString()
      },
      after: {
        deactivatedAt: updatedUser.deactivatedAt?.toISOString() ?? null
      }
    }
  });

  revalidateAccessSettings();

  return {
    ok: true,
    data: {
      user: serializeUserMutationData(updatedUser)
    },
    requestId: newRequestId()
  };
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
