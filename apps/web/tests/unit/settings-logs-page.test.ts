import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const loadLogsSettings = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());

Object.assign(globalThis, { React });

vi.mock("next/navigation", () => ({
  redirect
}));

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/selectors", () => ({
  loadLogsSettings
}));

vi.mock("../../app/settings/_components/logs-page", () => ({
  LogsPage: () => null
}));

import SettingsLogsPage from "../../app/settings/logs/page";

describe("settings logs page", () => {
  beforeEach(() => {
    resolveAdminSession.mockReset();
    loadLogsSettings.mockReset();
    redirect.mockReset();
  });

  it("redirects unauthenticated callers to sign-in", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: false,
      code: "unauthorized"
    });
    redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT_SIGN_IN");
    });

    await expect(
      SettingsLogsPage({
        searchParams: Promise.resolve({})
      })
    ).rejects.toThrow("NEXT_REDIRECT_SIGN_IN");
    expect(redirect).toHaveBeenCalledWith("/auth/sign-in");
    expect(loadLogsSettings).not.toHaveBeenCalled();
  });

  it("redirects authenticated non-admin callers back to settings", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: false,
      code: "forbidden"
    });
    redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT_SETTINGS");
    });

    await expect(
      SettingsLogsPage({
        searchParams: Promise.resolve({})
      })
    ).rejects.toThrow("NEXT_REDIRECT_SETTINGS");
    expect(redirect).toHaveBeenCalledWith("/settings");
    expect(loadLogsSettings).not.toHaveBeenCalled();
  });

  it("loads the logs settings view model for admins", async () => {
    resolveAdminSession.mockResolvedValue({
      ok: true,
      user: {
        id: "user:admin",
        role: "admin"
      }
    });
    loadLogsSettings.mockResolvedValue({
      streams: [
        {
          id: "source-evidence-quarantine",
          label: "Source-evidence quarantines",
          description: "Checksum collisions for provider idempotency keys."
        }
      ],
      activeStreamId: "source-evidence-quarantine",
      entries: [],
      nextBeforeTimestamp: null
    });

    const page = await SettingsLogsPage({
      searchParams: Promise.resolve({})
    });

    expect(page).toBeTruthy();
    expect(loadLogsSettings).toHaveBeenCalledWith({
      streamId: "source-evidence-quarantine",
      beforeTimestamp: null
    });
  });
});
