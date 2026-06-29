import { afterEach, describe, expect, it, vi } from "vitest";

const requireApiSession = vi.hoisted(() => vi.fn());
const softDeleteBroadcastMediaAsset = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  requireApiSession,
}));

vi.mock("@/src/server/stage1-runtime", () => ({
  softDeleteBroadcastMediaAsset,
}));

import { DELETE } from "../../app/api/broadcasts/images/[id]/route";

describe("broadcast image delete route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 401 without a session", async () => {
    requireApiSession.mockResolvedValue({
      ok: false,
      response: Response.json({ ok: false, code: "unauthorized" }, { status: 401 }),
    });

    const response = await DELETE(
      new Request("http://localhost/api/broadcasts/images/asset-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ id: "asset-1" }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("soft-deletes the requested asset", async () => {
    requireApiSession.mockResolvedValue({
      ok: true,
      user: { id: "user:operator", role: "operator" },
    });

    const response = await DELETE(
      new Request("http://localhost/api/broadcasts/images/asset-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ id: "asset-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(softDeleteBroadcastMediaAsset).toHaveBeenCalledTimes(1);
    expect(softDeleteBroadcastMediaAsset).toHaveBeenCalledWith("asset-1");
  });
});
