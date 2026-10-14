import { NextResponse } from "next/server";

import type { Workspace } from "@as-comms/contracts";
import type { UserRecord } from "@as-comms/domain";

import { requireSession } from "./session";
import { canAccessWorkspace, loadWorkspaceAccess } from "./workspace-rules";

/**
 * `workspaces` lists the spaces whose members may call the route; access to
 * any one of them is enough (admins pass everything).
 */
export async function requireApiSession(
  workspaces: readonly Workspace[],
): Promise<
  | {
      readonly ok: true;
      readonly user: UserRecord;
    }
  | {
      readonly ok: false;
      readonly response: NextResponse;
    }
> {
  try {
    const user = await requireSession();
    const access = await loadWorkspaceAccess(user);
    if (!workspaces.some((workspace) => canAccessWorkspace(access, workspace))) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "forbidden",
          },
          {
            status: 403,
          },
        ),
      };
    }

    return {
      ok: true,
      user,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "unauthorized",
          },
          {
            status: 401,
          },
        ),
      };
    }

    throw error;
  }
}

export async function resolveAdminSession(): Promise<
  | {
      readonly ok: true;
      readonly user: UserRecord;
    }
  | {
      readonly ok: false;
      readonly code: "unauthorized" | "forbidden";
    }
> {
  try {
    const user = await requireSession();
    if (user.role !== "admin") {
      return {
        ok: false,
        code: "forbidden"
      };
    }

    return {
      ok: true,
      user
    };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return {
        ok: false,
        code: "unauthorized"
      };
    }

    throw error;
  }
}
