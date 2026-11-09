import { afterEach, describe, expect, it, vi } from "vitest";

import { createExpeditionWithdrawToken } from "@as-comms/domain";

import {
  loadWithdrawPageModel,
  resolveExpeditionWithdrawToken,
} from "../../app/w/[token]/_lib/withdraw";

const secret = "a-very-long-test-secret-that-is-at-least-32-characters";
const memberId = "a0B000000000001";
const projectId = "a0P000000000001";

afterEach(() => {
  delete process.env.EXPEDITION_WITHDRAW_LINK_SECRET;
});

function token(expiresAt = new Date("2100-01-01T00:00:00.000Z")): string {
  return createExpeditionWithdrawToken({
    expeditionMemberId: memberId,
    projectId,
    expiresAt,
    secret,
  });
}

describe("withdraw page model", () => {
  it("only verifies on GET and selects confirm and done states", async () => {
    process.env.EXPEDITION_WITHDRAW_LINK_SECRET = secret;
    const findById = vi.fn((id: string) => Promise.resolve(
      id === projectId
        ? { projectName: "Project Atlas", connectedToProjectId: null }
        : null,
    ));
    const runtime = { settings: { projects: { findById } } } as never;

    await expect(loadWithdrawPageModel({ runtime, token: token(), done: false })).resolves.toMatchObject({
      state: "confirm",
      projectName: "Project Atlas",
    });
    await expect(loadWithdrawPageModel({ runtime, token: token(), done: true })).resolves.toMatchObject({
      state: "done",
    });
    expect(findById).toHaveBeenCalledTimes(2);
    expect(resolveExpeditionWithdrawToken(token())).toEqual({
      expeditionMemberId: memberId,
      projectId,
    });
  });

  it("returns invalid for malformed or expired tokens without querying or writing", async () => {
    process.env.EXPEDITION_WITHDRAW_LINK_SECRET = secret;
    const findById = vi.fn();
    const runtime = { settings: { projects: { findById } } } as never;

    await expect(
      loadWithdrawPageModel({ runtime, token: "invalid", done: false }),
    ).resolves.toMatchObject({ state: "invalid", projectName: "this project" });
    await expect(
      loadWithdrawPageModel({
        runtime,
        token: token(new Date("2000-01-01T00:00:00.000Z")),
        done: false,
      }),
    ).resolves.toMatchObject({ state: "invalid", projectName: "this project" });

    expect(findById).not.toHaveBeenCalled();
  });

  it("falls back to this project when the project was not found", async () => {
    process.env.EXPEDITION_WITHDRAW_LINK_SECRET = secret;
    const findById = vi.fn().mockResolvedValue(null);
    const runtime = { settings: { projects: { findById } } } as never;

    await expect(loadWithdrawPageModel({ runtime, token: token(), done: false })).resolves.toEqual({
      state: "confirm",
      token: token(),
      projectName: "this project",
    });
    expect(findById).toHaveBeenCalledWith(projectId);
  });
});
