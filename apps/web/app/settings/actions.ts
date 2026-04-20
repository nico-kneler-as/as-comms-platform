"use server";

/**
 * Settings stub actions (UI-only redesign).
 *
 * Every export below is a no-op that immediately returns an FP-07 UiSuccess
 * envelope. The shape matches the production envelope in
 * `apps/web/src/server/ui-result.ts`, so swapping a stub for a real action
 * later is a local change — callers don't need to know the difference.
 *
 * TODO(stage2): wire each of these to real repositories and audit events.
 */

import { randomUUID } from "node:crypto";

import type { UiResult, UiSuccess } from "@/src/server/ui-result";

function newRequestId(): string {
  return randomUUID();
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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

/**
 * Boxes a synchronous stub payload in the async envelope all Server Actions
 * must expose. Adding an actual `await` point also satisfies the lint rule
 * that requires `async` functions to contain at least one await — when real
 * persistence lands, that await will be the DB call itself.
 */
async function stub<T>(data: T): Promise<UiSuccess<T>> {
  await Promise.resolve();
  return { ok: true, data, requestId: newRequestId() };
}

// ─── Projects ───────────────────────────────────────────────────────────────

export interface AddProjectResult {
  readonly id: string;
  readonly name: string;
  readonly inboxAlias: string;
}

export async function addProjectAction(
  formData: FormData
): Promise<UiResult<AddProjectResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    id: `project:stub:${randomUUID()}`,
    name: readString(formData, "name"),
    inboxAlias: readString(formData, "inboxAlias")
  });
}

export interface UpdateProjectAliasResult {
  readonly id: string;
  readonly inboxAlias: string;
}

export async function updateProjectAliasAction(
  formData: FormData
): Promise<UiResult<UpdateProjectAliasResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    id: readString(formData, "id"),
    inboxAlias: readString(formData, "inboxAlias")
  });
}

export interface ArchiveProjectResult {
  readonly id: string;
}

export async function archiveProjectAction(
  formData: FormData
): Promise<UiResult<ArchiveProjectResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

// ─── Access (users) ─────────────────────────────────────────────────────────

export interface InviteUserResult {
  readonly email: string;
  readonly role: "admin" | "internal_user";
}

export async function inviteUserAction(
  formData: FormData
): Promise<UiResult<InviteUserResult>> {
  const rawRole = readOptionalString(formData, "role") ?? "internal_user";
  const role: "admin" | "internal_user" =
    rawRole === "admin" ? "admin" : "internal_user";
  // TODO(stage2): wire to real persistence
  return stub({
    email: readString(formData, "email"),
    role
  });
}

export interface UserIdResult {
  readonly id: string;
}

export async function promoteUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

export async function demoteUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

export async function deactivateUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

export async function reactivateUserAction(
  formData: FormData
): Promise<UiResult<UserIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

// ─── Integrations ───────────────────────────────────────────────────────────

export interface IntegrationIdResult {
  readonly id: string;
}

export async function connectIntegrationAction(
  formData: FormData
): Promise<UiResult<IntegrationIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

export async function disconnectIntegrationAction(
  formData: FormData
): Promise<UiResult<IntegrationIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}

export async function reconfigureIntegrationAction(
  formData: FormData
): Promise<UiResult<IntegrationIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}
