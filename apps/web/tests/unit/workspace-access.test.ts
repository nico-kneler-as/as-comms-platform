import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const listWorkspaces = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({ requireSession }));
vi.mock("../../src/server/auth/session", () => ({ requireSession }));
vi.mock("@/src/server/stage1-runtime", () => ({
  getSettingsRepositories: () => Promise.resolve({ users: { listWorkspaces } }),
}));
vi.mock("../../src/server/stage1-runtime", () => ({
  getSettingsRepositories: () => Promise.resolve({ users: { listWorkspaces } }),
}));

import { requireApiSession } from "../../src/server/auth/api";
import {
  requireVolunteerSession,
  requireWorkspace,
} from "../../src/server/auth/workspace-access";
import {
  canAccessWorkspace,
  firstAccessibleSurface,
  railAccessFor,
  type WorkspaceAccessUser,
} from "../../src/server/auth/workspace-rules";

function buildUser(role: "admin" | "operator", id = `user:${role}`) {
  const now = new Date("2026-10-14T10:00:00.000Z");
  return {
    id,
    name: id,
    email: `${id.replace("user:", "")}@adventurescientists.org`,
    emailVerified: now,
    image: null,
    role,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function access(
  role: "admin" | "operator",
  workspaces: WorkspaceAccessUser["workspaces"],
): WorkspaceAccessUser {
  return { user: buildUser(role), workspaces };
}

describe("workspace rules", () => {
  it("lets admins into every workspace and members only into theirs", () => {
    expect(canAccessWorkspace(access("admin", []), "donors")).toBe(true);
    expect(canAccessWorkspace(access("admin", []), "volunteers")).toBe(true);
    expect(canAccessWorkspace(access("operator", ["donors"]), "donors")).toBe(
      true,
    );
    expect(
      canAccessWorkspace(access("operator", ["donors"]), "volunteers"),
    ).toBe(false);
    expect(
      canAccessWorkspace(access("operator", ["volunteers", "donors"]), "donors"),
    ).toBe(true);
  });

  it("shows a donors-only teammate only the Donors rail item", () => {
    expect(railAccessFor(access("operator", ["donors"]))).toEqual({
      volunteers: false,
      donors: true,
      admin: false,
    });
    expect(railAccessFor(access("operator", ["volunteers"]))).toEqual({
      volunteers: true,
      donors: false,
      admin: false,
    });
    expect(railAccessFor(access("admin", ["volunteers"]))).toEqual({
      volunteers: true,
      donors: true,
      admin: true,
    });
  });

  it("sends each teammate home to the first space they can use", () => {
    expect(firstAccessibleSurface(access("operator", ["volunteers"]))).toBe(
      "/inbox",
    );
    expect(firstAccessibleSurface(access("operator", ["donors"]))).toBe(
      "/donors",
    );
    expect(firstAccessibleSurface(access("admin", []))).toBe("/inbox");
    expect(firstAccessibleSurface(access("operator", []))).toBeNull();
  });
});

describe("workspace guards", () => {
  beforeEach(() => {
    requireSession.mockReset();
    listWorkspaces.mockReset();
  });

  it("refuses volunteer surfaces to a donors-only teammate", async () => {
    requireSession.mockResolvedValue(buildUser("operator", "user:devynn"));
    listWorkspaces.mockResolvedValue(["donors"]);

    await expect(requireVolunteerSession()).rejects.toThrow("FORBIDDEN");
    await expect(requireWorkspace("donors")).resolves.toMatchObject({
      workspaces: ["donors"],
    });
  });

  it("refuses the donors space to a volunteers-only teammate", async () => {
    requireSession.mockResolvedValue(buildUser("operator", "user:sam"));
    listWorkspaces.mockResolvedValue(["volunteers"]);

    await expect(requireWorkspace("donors")).rejects.toThrow("FORBIDDEN");
    await expect(requireVolunteerSession()).resolves.toMatchObject({
      id: "user:sam",
    });
  });

  it("lets admins through every guard", async () => {
    requireSession.mockResolvedValue(buildUser("admin", "user:nico"));
    listWorkspaces.mockResolvedValue(["volunteers"]);

    await expect(requireWorkspace("donors")).resolves.toMatchObject({
      user: { id: "user:nico" },
    });
    await expect(requireVolunteerSession()).resolves.toMatchObject({
      id: "user:nico",
    });
  });

  it("keeps UNAUTHORIZED distinct from FORBIDDEN", async () => {
    requireSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(requireVolunteerSession()).rejects.toThrow("UNAUTHORIZED");
  });

  it("answers API calls outside the caller's spaces with 403", async () => {
    requireSession.mockResolvedValue(buildUser("operator", "user:devynn"));
    listWorkspaces.mockResolvedValue(["donors"]);

    const inboxOnly = await requireApiSession(["volunteers"]);
    expect(inboxOnly.ok).toBe(false);
    if (!inboxOnly.ok) {
      expect(inboxOnly.response.status).toBe(403);
    }

    const sharedMedia = await requireApiSession(["volunteers", "donors"]);
    expect(sharedMedia).toMatchObject({ ok: true, user: { id: "user:devynn" } });
  });

  it("answers signed-out API calls with 401", async () => {
    requireSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    const result = await requireApiSession(["volunteers"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });
});
