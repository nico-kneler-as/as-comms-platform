import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

import { POST } from "../../app/api/internal/revalidate/route";

describe("internal inbox revalidation route", () => {
  beforeEach(() => {
    process.env.INBOX_REVALIDATE_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.INBOX_REVALIDATE_TOKEN;
  });

  it("revalidates the inbox and touched contact timeline tags", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/revalidate", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contactIds: ["contact:one", "contact:one", "contact:two"]
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      contactIds: ["contact:one", "contact:two"]
    });
  });

  it("rejects unauthorized requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/revalidate", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contactIds: ["contact:one"]
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized"
    });
  });
});
