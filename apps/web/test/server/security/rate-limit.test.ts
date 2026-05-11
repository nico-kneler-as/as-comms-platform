import { describe, expect, it } from "vitest";

import { getClientIp } from "@/src/server/security/rate-limit";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

describe("getClientIp — Railway / Cloudflare trust order", () => {
  it("prefers cf-connecting-ip over everything else", () => {
    const request = makeRequest({
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(getClientIp(request)).toBe("1.1.1.1");
  });

  it("prefers x-real-ip when cf-connecting-ip is absent", () => {
    // Railway's edge strips client-supplied X-Real-IP and sets its own
    // trusted value. Use this in preference to X-Forwarded-For chains.
    const request = makeRequest({
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "spoofed.value, 4.4.4.4",
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to the rightmost x-forwarded-for value (trusted edge entry)", () => {
    // The leftmost x-forwarded-for entries are client-controllable on
    // Railway and can be spoofed. The rightmost entry is the trusted edge's
    // view of the real client IP — that's what we use.
    const request = makeRequest({
      "x-forwarded-for": "8.8.8.8, 4.4.4.4, 192.0.2.5",
    });
    expect(getClientIp(request)).toBe("192.0.2.5");
  });

  it("does not return a spoofed leftmost x-forwarded-for value", () => {
    // Regression: prior implementation took the FIRST x-forwarded-for entry,
    // which is the value an attacker can set with curl -H. The fix returns
    // the rightmost entry instead.
    const request = makeRequest({
      "x-forwarded-for": "9.9.9.9, 198.51.100.7",
    });
    const ip = getClientIp(request);
    expect(ip).not.toBe("9.9.9.9");
    expect(ip).toBe("198.51.100.7");
  });

  it("handles a single x-forwarded-for value", () => {
    const request = makeRequest({
      "x-forwarded-for": "203.0.113.1",
    });
    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("trims whitespace around x-forwarded-for entries", () => {
    const request = makeRequest({
      "x-forwarded-for": "  10.0.0.1  ,   203.0.113.1   ",
    });
    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("ignores empty x-forwarded-for entries from malformed chains", () => {
    const request = makeRequest({
      "x-forwarded-for": ",, ,  203.0.113.42 ,",
    });
    expect(getClientIp(request)).toBe("203.0.113.42");
  });

  it("returns 127.0.0.1 when no proxy headers are present (local dev)", () => {
    const request = makeRequest({});
    expect(getClientIp(request)).toBe("127.0.0.1");
  });

  it("ignores empty header values", () => {
    const request = makeRequest({
      "cf-connecting-ip": "",
      "x-real-ip": "",
      "x-forwarded-for": "",
    });
    expect(getClientIp(request)).toBe("127.0.0.1");
  });
});
