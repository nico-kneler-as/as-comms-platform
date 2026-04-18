"use server";

import { randomUUID } from "node:crypto";

import { revalidateTag } from "next/cache";

import {
  deactivateUserSchema,
  demoteUserSchema,
  promoteUserSchema,
  reactivateUserSchema,
  type DeactivateUserInput,
  type DemoteUserInput,
  type PromoteUserInput,
  type ReactivateUserInput
} from "@as-comms/contracts";

import { requireAdmin } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

/**
 * FP-07 safe envelope — co-located with Server Actions; copied from
 * aliases/actions.ts pattern. Do not create a shared package.
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

const USER_AUDIT_POLICY = "settings.user_mutation";

function newRequestId(): string {
  return randomUUID();
}

function forbiddenError(requestId: string): UiError {
  return {
    ok: false,
    code: "forbidden",
    message: "You don't have permission to manage users.",
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

function notFoundError(requestId: string): UiError {
  return {
    ok: false,
    code: "not_found",
    message: "That user no longer exists.",
    requestId
  };
}

function cannotMutateDeactivatedError(requestId: string): UiError {
  return {
    ok: false,
    code: "cannot_mutate_deactivated",
    message: "Reactivate this user before promoting them.",
    requestId
  };
}

function selfDemotionBlockedError(requestId: string): UiError {
  return {
    ok: false,
    code: "self_demotion_blocked",
    message: "You cannot demote your own account.",
    requestId
  };
}

function selfDeactivationBlockedError(requestId: string): UiError {
  return {
    ok: false,
    code: "self_deactivation_blocked",
    message: "You cannot deactivate your own account.",
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

async function appendUserAudit(input: {
  readonly actorId: string;
  readonly action: string;
  readonly entityId: string;
  readonly metadataJson: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}): Promise<void> {
  const runtime = await getStage1WebRuntime();
  await runtime.repositories.auditEvidence.append({
    id: `audit:user:${input.entityId}:${String(input.occurredAt.getTime())}:${randomUUID()}`,
    actorType: "user",
    actorId: input.actorId,
    action: input.action,
    entityType: "user",
    entityId: input.entityId,
    occurredAt: input.occurredAt.toISOString(),
    result: "recorded",
    policyCode: USER_AUDIT_POLICY,
    metadataJson: input.metadataJson
  });
}

export async function promoteUserAction(
  input: PromoteUserInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = promoteUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: "Invalid input.",
      requestId
    };
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { users } = runtime.settings;

    const target = await users.findById(parsed.data.id);
    if (!target) {
      return notFoundError(requestId);
    }

    if (target.deactivatedAt !== null) {
      return cannotMutateDeactivatedError(requestId);
    }

    if (target.role === "admin") {
      return { ok: true, data: { id: target.id }, requestId };
    }

    await users.updateRole(parsed.data.id, "admin");

    await appendUserAudit({
      actorId: currentUser.id,
      action: "user.promoted",
      entityId: parsed.data.id,
      metadataJson: { email: target.email, from: "operator", to: "admin" },
      occurredAt: new Date()
    });

    invalidateSettingsCache();

    return { ok: true, data: { id: parsed.data.id }, requestId };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}

export async function demoteUserAction(
  input: DemoteUserInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = demoteUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: "Invalid input.",
      requestId
    };
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  if (parsed.data.id === currentUser.id) {
    return selfDemotionBlockedError(requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { users } = runtime.settings;

    const target = await users.findById(parsed.data.id);
    if (!target) {
      return notFoundError(requestId);
    }

    if (target.deactivatedAt !== null) {
      return {
        ok: false,
        code: "cannot_mutate_deactivated",
        message: "Reactivate this user before changing their role.",
        requestId
      };
    }

    if (target.role === "operator") {
      return { ok: true, data: { id: target.id }, requestId };
    }

    await users.updateRole(parsed.data.id, "operator");

    await appendUserAudit({
      actorId: currentUser.id,
      action: "user.demoted",
      entityId: parsed.data.id,
      metadataJson: { email: target.email, from: "admin", to: "operator" },
      occurredAt: new Date()
    });

    invalidateSettingsCache();

    return { ok: true, data: { id: parsed.data.id }, requestId };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}

export async function deactivateUserAction(
  input: DeactivateUserInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = deactivateUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: "Invalid input.",
      requestId
    };
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  if (parsed.data.id === currentUser.id) {
    return selfDeactivationBlockedError(requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { users } = runtime.settings;

    const target = await users.findById(parsed.data.id);
    if (!target) {
      return notFoundError(requestId);
    }

    if (target.deactivatedAt !== null) {
      return { ok: true, data: { id: target.id }, requestId };
    }

    const now = new Date();
    await users.setDeactivated(parsed.data.id, now);

    await appendUserAudit({
      actorId: currentUser.id,
      action: "user.deactivated",
      entityId: parsed.data.id,
      metadataJson: { email: target.email },
      occurredAt: now
    });

    invalidateSettingsCache();

    return { ok: true, data: { id: parsed.data.id }, requestId };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}

export async function reactivateUserAction(
  input: ReactivateUserInput
): Promise<UiResult<{ readonly id: string }>> {
  const requestId = newRequestId();

  const parsed = reactivateUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: "Invalid input.",
      requestId
    };
  }

  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return mapThrownError(error, requestId);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const { users } = runtime.settings;

    const target = await users.findById(parsed.data.id);
    if (!target) {
      return notFoundError(requestId);
    }

    if (target.deactivatedAt === null) {
      return { ok: true, data: { id: target.id }, requestId };
    }

    const now = new Date();
    await users.setDeactivated(parsed.data.id, null);

    await appendUserAudit({
      actorId: currentUser.id,
      action: "user.reactivated",
      entityId: parsed.data.id,
      metadataJson: { email: target.email },
      occurredAt: now
    });

    invalidateSettingsCache();

    return { ok: true, data: { id: parsed.data.id }, requestId };
  } catch (error) {
    return mapThrownError(error, requestId);
  }
}
