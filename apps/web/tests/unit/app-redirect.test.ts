import { describe, expect, it, vi } from "vitest";

import { redirectToAppPath } from "../../src/server/app-redirect";

vi.mock("../../src/server/auth/session", () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(null)),
}));

describe("redirectToAppPath", () => {
  it("sends a relative Location so the browser stays on the address it used", () => {
    const response = redirectToAppPath("/u/abc?confirmed=1");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/u/abc?confirmed=1");
  });

  it("supports 307 for GET sign-in redirects", () => {
    expect(redirectToAppPath("/auth/sign-in", 307).status).toBe(307);
  });

  it.each(["https://example.com/u/abc", "//example.com/u/abc", "/\\example.com", "u/abc"])(
    "refuses %s, which isn't a path on this app",
    (path) => {
      expect(() => redirectToAppPath(path)).toThrow();
    },
  );
});

describe("MCP OAuth authorize, signed out", () => {
  it("redirects to sign-in on this app, not the container address", async () => {
    const { GET } = await import("../../app/api/oauth/authorize/route");

    // Behind Railway's proxy the route sees the container's own address.
    const response = await GET(
      new Request(
        "https://localhost:8080/api/oauth/authorize?client_id=x&response_type=code",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("/auth/sign-in?")).toBe(true);
    expect(location).not.toContain("localhost");
    expect(new URLSearchParams(location.split("?")[1]).get("callbackUrl")).toBe(
      "/api/oauth/authorize?client_id=x&response_type=code",
    );
  });
});
