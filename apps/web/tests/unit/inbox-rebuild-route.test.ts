import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateInboxViews = vi.hoisted(() => vi.fn());
const getStage1WebRuntime = vi.hoisted(() => vi.fn());
const createStage1PersistenceService = vi.hoisted(() => vi.fn());
const createStage1NormalizationService = vi.hoisted(() => vi.fn());

vi.mock("@as-comms/domain", () => ({
  createStage1NormalizationService,
  createStage1PersistenceService,
  isInboxDrivingCanonicalEvent: vi.fn(() => true),
}));

vi.mock("../../src/server/inbox/revalidate", () => ({
  revalidateInboxViews,
}));

vi.mock("../../src/server/stage1-runtime", () => ({
  getStage1WebRuntime,
}));

import { POST } from "../../app/api/internal/inbox-rebuild/route";

describe("internal inbox rebuild route", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_INBOX_REBUILD_TOKEN", "test-token");
    vi.stubEnv("NODE_ENV", "development");
    revalidateInboxViews.mockReset();
    createStage1PersistenceService.mockReset();
    createStage1NormalizationService.mockReset();
    getStage1WebRuntime.mockReset();
    createStage1PersistenceService.mockReturnValue({});
    createStage1NormalizationService.mockReturnValue({});
    getStage1WebRuntime.mockResolvedValue({
      connection: {
        sql: vi.fn().mockResolvedValue(undefined),
      },
      repositories: {
        inboxProjection: {
          countInvalidRecencyRows: vi
            .fn()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0),
          listInvalidRecencyContactIds: vi.fn().mockResolvedValue([]),
        },
        contacts: {
          listAll: vi.fn().mockResolvedValue([]),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without a bearer token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/inbox-rebuild", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ contactIds: [] }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("rejects requests with the wrong bearer token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/inbox-rebuild", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ contactIds: [] }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("accepts requests with the correct bearer token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/inbox-rebuild", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ contactIds: [] }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      selection: "all",
      rebuiltContactIds: [],
      rebuiltInboxRows: 0,
      invalidBefore: 0,
      invalidAfter: 0,
    });
  });
});
