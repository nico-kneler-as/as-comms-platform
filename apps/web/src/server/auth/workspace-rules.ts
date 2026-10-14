import type { Workspace } from "@as-comms/contracts";
import type { UserRecord } from "@as-comms/domain";

import { getSettingsRepositories } from "../stage1-runtime";

/**
 * Workspace rules with no session dependency, so code outside a signed-in
 * request (the MCP connector, OAuth authorize) can use them without loading
 * Auth.js. Admins reach every workspace; everyone else needs a membership.
 */
export interface WorkspaceAccessUser {
  readonly user: UserRecord;
  readonly workspaces: readonly Workspace[];
}

export function canAccessWorkspace(
  access: WorkspaceAccessUser,
  workspace: Workspace,
): boolean {
  return (
    access.user.role === "admin" || access.workspaces.includes(workspace)
  );
}

export async function loadWorkspaceAccess(
  user: UserRecord,
): Promise<WorkspaceAccessUser> {
  const { users } = await getSettingsRepositories();
  return {
    user,
    workspaces: await users.listWorkspaces(user.id),
  };
}

/** What the left rail may show this user. */
export function railAccessFor(access: WorkspaceAccessUser): {
  readonly volunteers: boolean;
  readonly donors: boolean;
  readonly admin: boolean;
} {
  return {
    volunteers: canAccessWorkspace(access, "volunteers"),
    donors: canAccessWorkspace(access, "donors"),
    admin: access.user.role === "admin",
  };
}

export function firstAccessibleSurface(
  access: WorkspaceAccessUser,
): "/inbox" | "/donors" | null {
  if (canAccessWorkspace(access, "volunteers")) {
    return "/inbox";
  }
  if (canAccessWorkspace(access, "donors")) {
    return "/donors";
  }
  return null;
}
