import { describe, expect, it, vi } from "vitest";

import {
  resolveTurnstileMode,
  verifyTurnstile,
} from "@/src/server/security/turnstile";

const env = {
  TURNSTILE_SECRET_KEY: "secret-key",
  NEWSLETTER_SIGNUP_ALLOWED_ORIGIN: "https://www.adventurescientists.org",
  NEWSLETTER_SIGNUP_TURNSTILE_MODE: "enforce" as const,
};

describe("resolveTurnstileMode", () => {
  it("keeps configured off, log, and enforce modes when configured", () => {
    expect(
      resolveTurnstileMode({ ...env, NEWSLETTER_SIGNUP_TURNSTILE_MODE: "off" }),
    ).toBe("off");
    expect(
      resolveTurnstileMode({ ...env, NEWSLETTER_SIGNUP_TURNSTILE_MODE: "log" }),
    ).toBe("log");
    expect(resolveTurnstileMode(env)).toBe("enforce");
  });

  it("downgrades enforce to log without a secret", () => {
    expect(
      resolveTurnstileMode({ ...env, TURNSTILE_SECRET_KEY: undefined }),
    ).toBe("log");
  });
});

describe("verifyTurnstile", () => {
  function verifyWithPayload(payload: unknown, status = 200) {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
    return {
      fetchImpl,
      result: verifyTurnstile({
        env,
        token: "token",
        remoteIp: "203.0.113.1",
        fetchImpl,
      }),
    };
  }

  it("accepts a successful response for the allowed-origin hostname", async () => {
    const { result } = verifyWithPayload({
      success: true,
      hostname: "www.adventurescientists.org",
    });
    await expect(result).resolves.toEqual({ outcome: "valid", errorCodes: [] });
  });

  it("rejects a successful response for another hostname", async () => {
    const { result } = verifyWithPayload({
      success: true,
      hostname: "evil.example",
    });
    await expect(result).resolves.toEqual({
      outcome: "invalid",
      errorCodes: [],
    });
  });

  it("returns verification error codes for unsuccessful responses", async () => {
    const { result } = verifyWithPayload({
      success: false,
      "error-codes": ["invalid-input-response"],
    });
    await expect(result).resolves.toEqual({
      outcome: "invalid",
      errorCodes: ["invalid-input-response"],
    });
  });

  it("returns error for rejected fetches and non-2xx responses", async () => {
    const rejectedFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(
      verifyTurnstile({
        env,
        token: "token",
        remoteIp: "203.0.113.1",
        fetchImpl: rejectedFetch,
      }),
    ).resolves.toEqual({ outcome: "error", errorCodes: [] });

    const { result } = verifyWithPayload({}, 503);
    await expect(result).resolves.toEqual({ outcome: "error", errorCodes: [] });
  });

  it("sends the secret, response token, and client IP as form data", async () => {
    const { fetchImpl, result } = verifyWithPayload({
      success: true,
      hostname: "www.adventurescientists.org",
    });
    await result;

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(init.body).toEqual(
      new URLSearchParams({
        secret: "secret-key",
        response: "token",
        remoteip: "203.0.113.1",
      }),
    );
  });
});
