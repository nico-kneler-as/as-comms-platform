"use server";

import { randomUUID } from "node:crypto";

import { revalidateTag } from "next/cache";
import type { z } from "zod";

import {
  createProjectAliasSchema,
  deleteProjectAliasSchema,
  updateProjectAliasSchema,
  type CreateProjectAliasInput,
  type DeleteProjectAliasInput,
  type UpdateProjectAliasInput
} from "@as-comms/contracts";
import type { ProjectAliasRecord } from "@as-comms/domain";

import { requireAdmin } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

/**
 * FP-07 safe envelope. Kept co-located with the Server Actions that produce
 * it — Client Components receive view models + this envelope, never raw
 * repository errors.
 */
export interface UiSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly requestId: string;
}

export interface UiError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly retryable?: boolean;
}

type UiResult<T> = UiSuccess<T> | UiError;

const ALIAS_AUDIT_POLICY = "settings.alias_mutation";

function newRequestId(): string {
  return randomUUID();
}

function flattenFieldErrors(
  error: z.ZodError
): Readonly<Record<string, string>> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

function validationError(
  requestId: string,
  error: z.ZodError,
  message = "Please fix the highlighted fields."
): UiError {
  return {
    ok: false,
    code: "validation_error",
    message,
    requestId,
    fieldErrors: flattenFieldErrors(error)
  };
}

function forbiddenError(requestId: string): UiError {
  return {
    ok: false,
    code: "forbidden",
    message: "You don’t have permission to change project aliases.",
    requestId
  };
}

function unauthorizedError(requestId: string): UiError {
  return {
    ok: false,
    code: "unauthorized",
    message: "Your session has expired. Please sign in again.",
    requestId
  };
}

function conflictError(requestId: string): UiError {
  return {
    ok: false,
    code: "alias_conflict",
    message: "That alias is already in use.",
    requestId,
    fieldErrors: { alias: "That alias is already in use." }
  };
}

function notFoundError(requestId: string): UiError {
  return {
    ok: false,
    code: "not_found",
    message: "That alias no longer exists.",
    requestId
  };
}

function internalError(requestId: string): UiError {
  return {
    ok: false,
    code: "internal_error",
    message: "Something went wrong. Please try again.",
    requestId,
    retryable: true
  };
}

/**
 * Translate a thrown repository/runtime error into a UiError with no leak of
 * stack traces, SQL state, or provider payloads. Everything the caller needs
 * is the stable `code`; the operator-facing `message` is neutral copy.
 */
function mapThrownError(error: unknown, requestId: string): UiError {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return unauthorizedError(requestId);
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return forbiddenError(requestId);
  }
  return internalError(requestId);
}

function invalidateSettingsCache(): void {
  revalidateTag("settings");
}

function normalizeProjectId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readFormField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function coerceCreateInput(
  raw: FormData | CreateProjectAliasInput
): { readonly ok: true; readonly value: CreateProjectAliasInput } | {
  readonly ok: false;
  readonly error: z.ZodError;
} {
  const candidate =
    raw instanceof FormData
      ? {
          alias: readFormField(raw, "alias") ?? "",
          projectId: normalizeProjectId(readFormField(raw, "projectId"))
        }
      : raw;

  const parsed = createProjectAliasSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, value: parsed.data };
}

async function appendAliasAudit(input: {
  readonly actorId: string;
  readonly action: string;
  readonly entityId: string;
  readonly metadataJson: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}): Promise<void> {
  const runtime = await getStage1WebRuntime();
  await runtime.repositories.auditEvidence.append({
    id: `audit:project_alias:${input.entityId}:${String(input.occurredAt.getTime())}:${randomUUID()}`,
    actorType: "user",
    actorId: input.actorId,
    action: input.action,
    entityType: "project_alias",
    entityId: input.entityId,
    occurredAt: input.occurredAt.toISOString(),
    result: "recorded",
    policyCode: ALIAS_AUDIT_POLICY,
    metadataJson: input.metadataJson
  });
}

export async function createAliasAction(
  input: FormData | CreateProjectAliasInput
): Promise<UiResult<{ readonly id: string; readonly alias: string }>> {
  const requestId = newRequestId();

  const coerced = coerceCreateInput(input);
  if (!coerced.ok) {
    return validationError(requestId, coerced.error);
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { aliases } = runtime.settings;

    const existing = await aliases.findByAlias(coerced.value.alias);
    if (existing) {
      return conflictError(requestId);
    }

    const now = new Date();
    const record: ProjectAliasRecord = {
      id: randomUUID(),
      alias: coerced.value.alias,
      projectId: coerced.value.projectId,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser.id,
      updatedBy: currentUser.id
    };

    const created = await aliases.create(record);

    await appendAliasAudit({
      actorId: currentUser.id,
      action: "project_alias.created",
      entityId: created.id,
      metadataJson: {
        alias: created.alias,
        projectId: created.projectId
      },
      occurredAt: now
    });

    invalidateSettingsCache();

    return {
      ok: true,
      data: { id: created.id, alias: created.alias },
      requestId
    };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}

export async function updateAliasAction(
  input: UpdateProjectAliasInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = updateProjectAliasSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(requestId, parsed.error);
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { aliases } = runtime.settings;

    const existing = await aliases.findById(parsed.data.id);
    if (!existing) {
      return notFoundError(requestId);
    }

    // Uniqueness: only check when the alias email actually changed. Keeping
    // the existing alias unchanged should not trip a conflict against itself.
    if (existing.alias !== parsed.data.alias) {
      const collision = await aliases.findByAlias(parsed.data.alias);
      if (collision && collision.id !== existing.id) {
        return conflictError(requestId);
      }
    }

    const now = new Date();
    const updated = await aliases.update({
      ...existing,
      alias: parsed.data.alias,
      projectId: parsed.data.projectId,
      updatedAt: now,
      updatedBy: currentUser.id
    });

    await appendAliasAudit({
      actorId: currentUser.id,
      action: "project_alias.updated",
      entityId: updated.id,
      metadataJson: {
        before: {
          alias: existing.alias,
          projectId: existing.projectId
        },
        after: {
          alias: updated.alias,
          projectId: updated.projectId
        }
      },
      occurredAt: now
    });

    invalidateSettingsCache();

    return {
      ok: true,
      data: { id: updated.id },
      requestId
    };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}

export async function deleteAliasAction(
  input: DeleteProjectAliasInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = deleteProjectAliasSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(requestId, parsed.error);
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { aliases } = runtime.settings;

    const existing = await aliases.findById(parsed.data.id);
    if (!existing) {
      return notFoundError(requestId);
    }

    await aliases.delete(parsed.data.id);

    await appendAliasAudit({
      actorId: currentUser.id,
      action: "project_alias.deleted",
      entityId: parsed.data.id,
      metadataJson: {
        alias: existing.alias,
        projectId: existing.projectId
      },
      occurredAt: new Date()
    });

    invalidateSettingsCache();

    return {
      ok: true,
      data: { id: parsed.data.id },
      requestId
    };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}
