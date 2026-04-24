import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const getStage0ReadinessSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/readiness", () => ({
  getStage0ReadinessSnapshot
}));

import { GET } from "../../app/api/readiness/route";

describe("readiness route", () => {
  const readinessPosture = {
    ok: true,
    checks: [
      {
        name: "database",
        status: "ok",
        configured: true
      },
      {
        name: "worker",
        status: "ok",
        configured: true
      }
    ]
  };

  beforeEach(() => {
    resolveAdminSession.mockReset();
    getStage0ReadinessSnapshot.mockReset();
    getStage0ReadinessSnapshot.mockReturnValue(readinessPosture);
  });

  it("returns only generic readiness for unauthenticated callers", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: false,
      code: "unauthorized"
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getStage0ReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("returns the full readiness posture for admin sessions", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: true,
      user: {
        id: "user:admin",
        role: "admin"
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(readinessPosture);
    expect(getStage0ReadinessSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns only generic readiness for authenticated non-admin callers", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: false,
      code: "forbidden"
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getStage0ReadinessSnapshot).not.toHaveBeenCalled();
  });
});
