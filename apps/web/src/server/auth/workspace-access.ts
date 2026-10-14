import type { Workspace } from "@as-comms/contracts";
import type { UserRecord } from "@as-comms/domain";

import { requireSession } from "./session";
import {
  canAccessWorkspace,
  loadWorkspaceAccess,
  type WorkspaceAccessUser,
} from "./workspace-rules";

export {
  canAccessWorkspace,
  firstAccessibleSurface,
  loadWorkspaceAccess,
  railAccessFor,
  type WorkspaceAccessUser,
} from "./workspace-rules";

/** Signed-in user with access to `workspace`; throws UNAUTHORIZED / FORBIDDEN. */
export async function requireWorkspace(
  workspace: Workspace,
): Promise<WorkspaceAccessUser> {
  const user = await requireSession();
  const access = await loadWorkspaceAccess(user);
  if (!canAccessWorkspace(access, workspace)) {
    throw new Error("FORBIDDEN");
  }
  return access;
}

/**
 * Session guard for every volunteer surface: inbox, composer, volunteer
 * broadcasts, automated emails. A donors-only teammate gets FORBIDDEN here,
 * so volunteer server actions stay closed even when called directly.
 */
export async function requireVolunteerSession(): Promise<UserRecord> {
  return (await requireWorkspace("volunteers")).user;
}
