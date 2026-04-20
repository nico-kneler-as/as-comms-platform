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

export interface ActivateProjectResult {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
}

/**
 * Activate a Salesforce project so inbound routing includes it. Replaces the
 * previous `addProjectAction` — the redesigned flow picks an existing
 * non-active project from our cached SF snapshot rather than inventing one.
 */
export async function activateProjectAction(
  formData: FormData
): Promise<UiResult<ActivateProjectResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    id: readString(formData, "id"),
    name: readString(formData, "name"),
    alias: readString(formData, "alias")
  });
}

export interface UpdateProjectAliasResult {
  readonly id: string;
  readonly alias: string;
}

/**
 * Rename the short alias used across the platform for this project. Reads
 * `projectId` (preferred) or legacy `id` from the form payload.
 */
export async function updateProjectAliasAction(
  formData: FormData
): Promise<UiResult<UpdateProjectAliasResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    id: readString(formData, "projectId") || readString(formData, "id"),
    alias: readString(formData, "alias")
  });
}

export interface ProjectEmailResult {
  readonly projectId: string;
  readonly email: string;
}

export async function addProjectEmailAction(
  formData: FormData
): Promise<UiResult<ProjectEmailResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    projectId: readString(formData, "projectId"),
    email: readString(formData, "email")
  });
}

export async function removeProjectEmailAction(
  formData: FormData
): Promise<UiResult<ProjectEmailResult>> {
  // TODO(stage2): wire to real persistence
  return stub({
    projectId: readString(formData, "projectId"),
    email: readString(formData, "email")
  });
}

export interface DeactivateProjectResult {
  readonly id: string;
}

/**
 * Deactivate a project so inbound routing ignores it. Renamed from
 * `archiveProjectAction` to match the product copy on the danger-zone card.
 */
export async function deactivateProjectAction(
  formData: FormData
): Promise<UiResult<DeactivateProjectResult>> {
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

/**
 * Trigger a one-off sync for an integration. Replaces the previous
 * connect/disconnect/reconfigure trio — the redesigned settings surface
 * treats provider configuration as infrastructure state and exposes only the
 * operator-level "refresh now" action.
 */
export async function syncIntegrationAction(
  formData: FormData
): Promise<UiResult<IntegrationIdResult>> {
  // TODO(stage2): wire to real persistence
  return stub({ id: readString(formData, "id") });
}
