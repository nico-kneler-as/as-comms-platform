import type * as TurnstileModule from "../../src/server/security/turnstile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newsletterSignupErrorSchema,
  newsletterSignupSuccessSchema,
} from "@as-comms/contracts";

const createPostmarkClientMock = vi.hoisted(() => vi.fn());
const sendBatchMock = vi.hoisted(() => vi.fn());
const verifyTurnstileMock = vi.hoisted(() => vi.fn());

vi.mock("@as-comms/integrations", () => ({
  createPostmarkClient: createPostmarkClientMock,
}));

vi.mock("../../src/server/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof TurnstileModule>()),
  verifyTurnstile: verifyTurnstileMock,
}));

import { OPTIONS, POST } from "../../app/api/newsletter/subscribe/route";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import {
  createOrgSenderForTests,
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

const ALLOWED_ORIGIN = "https://adventurescientists.org";
const originalEnv = { ...process.env };

function buildPostRequest(
  body: Record<string, unknown>,
  input: {
    readonly ip?: string;
    readonly origin?: string | null;
    readonly cfConnectingIp?: string;
    readonly xRealIp?: string;
  } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": input.ip ?? "203.0.113.21",
  });
  if (input.origin !== null) {
    headers.set("origin", input.origin ?? ALLOWED_ORIGIN);
  }
  if (input.cfConnectingIp !== undefined) {
    headers.set("cf-connecting-ip", input.cfConnectingIp);
  }
  if (input.xRealIp !== undefined) {
    headers.set("x-real-ip", input.xRealIp);
  }

  return new Request("https://app.example.test/api/newsletter/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function buildOptionsRequest(origin = ALLOWED_ORIGIN): Request {
  return new Request("https://app.example.test/api/newsletter/subscribe", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
    },
  });
}

function getFirstSentMessage():
  | {
      readonly From: string;
      readonly To: string;
      readonly MessageStream: string;
      readonly HtmlBody: string;
      readonly TextBody: string;
      readonly Headers?: readonly {
        readonly Name: string;
        readonly Value: string;
      }[];
    }
  | undefined {
  const calls = sendBatchMock.mock.calls as readonly (readonly unknown[])[];
  const firstBatchCall = calls[0]?.[0] as
    | {
        readonly messages: readonly [
          {
            readonly From: string;
            readonly To: string;
            readonly MessageStream: string;
            readonly HtmlBody: string;
            readonly TextBody: string;
            readonly Headers?: readonly {
              readonly Name: string;
              readonly Value: string;
            }[];
          },
        ];
      }
    | undefined;

  return firstBatchCall?.messages[0];
}

describe("newsletter subscribe route handler", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    createPostmarkClientMock.mockReset();
    sendBatchMock.mockReset();
    verifyTurnstileMock.mockReset();
    resetSecurityRateLimiterForTests();

    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-auth-secret",
      POSTMARK_SERVER_TOKEN: "test-postmark-server-token",
      POSTMARK_ACCOUNT_TOKEN: "test-postmark-account-token",
      POSTMARK_WEBHOOK_SIGNING_SECRET: "test-postmark-webhook-secret",
      POSTMARK_TRANSACTIONAL_STREAM_ID: "outbound",
      POSTMARK_BASE_URL: "https://api.postmarkapp.com",
      NEWSLETTER_SIGNUP_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
      NEXT_PUBLIC_APP_URL: "https://comms.adventurescientists.org",
      TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    };

    createPostmarkClientMock.mockReturnValue({
      sendBatch: sendBatchMock,
    });
    sendBatchMock.mockResolvedValue({ results: [] });
    verifyTurnstileMock.mockResolvedValue({ outcome: "valid", errorCodes: [] });

    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    runtime = await createStage1WebTestRuntime();
    await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists",
    });
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    resetSecurityRateLimiterForTests();
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    await runtime?.dispose();
    runtime = null;
    process.env = { ...originalEnv };
  });

  it("subscribes a valid POST request and returns the safe success envelope", async () => {
    const response = await POST(
      buildPostRequest({
        email: "fresh-subscriber@example.com",
        firstName: "Fresh",
        lastName: "Subscriber",
        website: "",
      }),
    );
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const payload = newsletterSignupSuccessSchema.parse(await response.json());
    const subscriber =
      await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
        "fresh-subscriber@example.com",
      );
    const firstMessage = getFirstSentMessage();
    const listUnsubscribeHeader = firstMessage?.Headers?.find(
      (header) => header.Name === "List-Unsubscribe",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(payload.ok).toBe(true);
    expect(payload.requestId).toEqual(expect.any(String));
    expect(subscriber).toMatchObject({
      email: "fresh-subscriber@example.com",
      firstName: "Fresh",
      lastName: "Subscriber",
      status: "subscribed",
      optinIp: "203.0.113.21",
      source: "website_signup",
    });
    expect(createPostmarkClientMock).toHaveBeenCalledTimes(1);
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    expect(firstMessage).toMatchObject({
      From: "Adventure Scientists <info@adventurescientists.org>",
      To: "fresh-subscriber@example.com",
      MessageStream: "outbound",
    });
    expect(listUnsubscribeHeader?.Value).toEqual(
      expect.stringContaining("/u/"),
    );
    expect(firstMessage?.HtmlBody).toContain(
      "https://comms.adventurescientists.org/u/",
    );
    expect(firstMessage?.TextBody).toContain(
      "https://comms.adventurescientists.org/u/",
    );
    expect(listUnsubscribeHeader?.Value).toContain(
      "https://comms.adventurescientists.org/u/",
    );
  });

  it("falls back to the request URL for welcome links and logs when the public URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const response = await POST(
      buildPostRequest({ email: "fallback-link@example.com", website: "" }),
    );
    const firstMessage = getFirstSentMessage();

    expect(response.status).toBe(200);
    expect(firstMessage?.TextBody).toContain("https://app.example.test/u/");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "newsletter_signup.welcome.missing_public_url" }),
    );
  });

  it("requires Origin before parsing or signing up", async () => {
    const response = await POST(
      buildPostRequest(
        { email: "no-origin@example.com", website: "" },
        { origin: null },
      ),
    );
    if (runtime === null) throw new Error("Expected runtime.");

    const payload = newsletterSignupErrorSchema.parse(await response.json());
    expect(response.status).toBe(403);
    expect(payload.code).toBe("origin_required");
    expect(
      await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
        "no-origin@example.com",
      ),
    ).toBeNull();
  });

  it("ignores cf-connecting-ip for both rate-limit identity and opt-in IP", async () => {
    const response = await POST(
      buildPostRequest(
        { email: "real-ip@example.com", website: "" },
        {
          xRealIp: "203.0.113.80",
          cfConnectingIp: "198.51.100.200",
        },
      ),
    );
    if (runtime === null) throw new Error("Expected runtime.");

    expect(response.status).toBe(200);
    await expect(
      runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
        "real-ip@example.com",
      ),
    ).resolves.toMatchObject({ optinIp: "203.0.113.80" });
  });

  it("rejects a honeypot-filled request", async () => {
    const response = await POST(
      buildPostRequest({
        email: "bot@example.com",
        firstName: "Bot",
        website: "filled-by-bot",
      }),
    );
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const payload = newsletterSignupErrorSchema.parse(await response.json());
    const subscriber = await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
      "bot@example.com",
    );

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("bot_detected");
    expect(payload.message).toBe("Unable to process this subscription request.");
    expect(payload.requestId).toEqual(expect.any(String));
    expect(subscriber).toBeNull();
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email address", async () => {
    const response = await POST(
      buildPostRequest({
        email: "not-an-email",
        firstName: "Invalid",
        website: "",
      }),
    );
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const payload = newsletterSignupErrorSchema.parse(await response.json());
    const subscriber = await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
      "not-an-email",
    );

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("invalid_request");
    expect(payload.message).toBe("Enter a valid email address.");
    expect(payload.requestId).toEqual(expect.any(String));
    expect(subscriber).toBeNull();
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from the same IP", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(
        buildPostRequest(
          {
            email: "repeat@example.com",
            firstName: "Repeat",
            website: "",
          },
          {
            ip: "198.51.100.9",
          },
        ),
      );

      expect(response.status).toBe(200);
    }

    const response = await POST(
      buildPostRequest(
        {
          email: "repeat@example.com",
          firstName: "Repeat",
          website: "",
        },
        {
          ip: "198.51.100.9",
        },
      ),
    );
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await waitForPendingSecurityAuditTasksForTests();

    const payload = newsletterSignupErrorSchema.parse(await response.json());
    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "route",
        entityId: "/api/newsletter/subscribe",
      });
    const latestAudit = audits.at(-1);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("rate_limit_exceeded");
    expect(payload.message).toBe(
      "Too many signup attempts. Please try again shortly.",
    );
    expect(payload.requestId).toEqual(expect.any(String));
    expect(latestAudit).toMatchObject({
      actorType: "system",
      actorId: "198.51.100.9",
      action: "newsletter_signup.request.rate_limited",
      result: "denied",
      policyCode: "security.rate_limit",
    });
  });

  it("enforces the database-backed daily IP cap and records an audit", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    const now = new Date().toISOString();
    for (const email of [
      "daily-one@example.com",
      "daily-two@example.com",
      "daily-three@example.com",
    ]) {
      await runtime.runtime.campaigns.newsletterSubscribers.signUp({
        email,
        optinTime: now,
        optinIp: "203.0.113.82",
        source: "website_signup",
      });
    }

    const response = await POST(
      buildPostRequest(
        { email: "daily-four@example.com", website: "" },
        { ip: "203.0.113.82" },
      ),
    );
    const payload = newsletterSignupErrorSchema.parse(await response.json());
    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "route",
        entityId: "/api/newsletter/subscribe",
      });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(payload.code).toBe("daily_limit_exceeded");
    expect(
      await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
        "daily-four@example.com",
      ),
    ).toBeNull();
    expect(audits.at(-1)).toMatchObject({
      action: "newsletter_signup.request.daily_limited",
      actorId: "203.0.113.82",
      result: "denied",
    });
  });

  it("continues below the daily IP cap and counts using the client IP", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    const originalCount =
      runtime.runtime.campaigns.newsletterSubscribers.countRecentWebsiteSignupsByIp.bind(
        runtime.runtime.campaigns.newsletterSubscribers,
      );
    const countSpy = vi.fn(originalCount);
    runtime.runtime.campaigns.newsletterSubscribers.countRecentWebsiteSignupsByIp =
      countSpy;
    for (const email of ["under-one@example.com", "under-two@example.com"]) {
      await runtime.runtime.campaigns.newsletterSubscribers.signUp({
        email,
        optinTime: new Date().toISOString(),
        optinIp: "203.0.113.83",
        source: "website_signup",
      });
    }

    const before = Date.now();
    const response = await POST(
      buildPostRequest(
        { email: "under-three@example.com", website: "" },
        { ip: "203.0.113.83" },
      ),
    );
    const after = Date.now();
    runtime.runtime.campaigns.newsletterSubscribers.countRecentWebsiteSignupsByIp =
      originalCount;

    expect(response.status).toBe(200);
    expect(countSpy).toHaveBeenCalledWith({
      optinIp: "203.0.113.83",
      since: expect.any(Date) as unknown,
    });
    const since = countSpy.mock.calls[0]?.[0]?.since;
    expect(since?.getTime()).toBeGreaterThanOrEqual(
      before - 24 * 60 * 60 * 1_000 - 10,
    );
    expect(since?.getTime()).toBeLessThanOrEqual(
      after - 24 * 60 * 60 * 1_000 + 10,
    );
  });

  it("returns the configured CORS headers on preflight", () => {
    const response = OPTIONS(buildOptionsRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "OPTIONS, POST",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("returns success even when the welcome email send fails", async () => {
    sendBatchMock.mockRejectedValueOnce(new Error("Postmark unavailable"));

    const response = await POST(
      buildPostRequest({
        email: "welcome-failure@example.com",
        firstName: "Welcome",
        website: "",
      }),
    );
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const payload = newsletterSignupSuccessSchema.parse(await response.json());
    const subscriber =
      await runtime.runtime.campaigns.newsletterSubscribers.findByEmail(
        "welcome-failure@example.com",
      );

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.requestId).toEqual(expect.any(String));
    expect(subscriber?.status).toBe("subscribed");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Newsletter welcome email failed.",
      { requestId: expect.any(String) as unknown },
    );
  });

  it("leaves Turnstile off without verification", async () => {
    const response = await POST(
      buildPostRequest({
        email: "turnstile-off@example.com",
        website: "",
        turnstileToken: "token",
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
  });

  it("logs missing Turnstile tokens in log mode and continues", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "log";
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    const response = await POST(
      buildPostRequest({
        email: "turnstile-log-missing@example.com",
        website: "",
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
    expect(JSON.parse(infoSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "newsletter_signup.turnstile",
      mode: "log",
      outcome: "missing",
    });
    infoSpy.mockRestore();
  });

  it("treats a blank Turnstile token as missing without calling Cloudflare", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "enforce";

    const response = await POST(
      buildPostRequest({
        email: "turnstile-blank@example.com",
        website: "",
        turnstileToken: "  ",
      }),
    );
    const payload = newsletterSignupErrorSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.code).toBe("verification_failed");
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
  });

  it("continues in log mode for invalid Turnstile verification", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "log";
    verifyTurnstileMock.mockResolvedValueOnce({
      outcome: "invalid",
      errorCodes: ["invalid-input-response"],
    });

    const response = await POST(
      buildPostRequest({
        email: "turnstile-log-invalid@example.com",
        website: "",
        turnstileToken: "token",
      }),
    );

    expect(response.status).toBe(200);
  });

  it.each([
    [undefined, "missing"],
    [{ outcome: "invalid", errorCodes: [] }, "invalid"],
  ])(
    "rejects %s Turnstile verification in enforce mode",
    async (verification) => {
      process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "enforce";
      if (verification !== undefined)
        verifyTurnstileMock.mockResolvedValueOnce(verification);

      const response = await POST(
        buildPostRequest({
          email: `turnstile-enforce-${verification === undefined ? "missing" : "invalid"}@example.com`,
          website: "",
          ...(verification === undefined ? {} : { turnstileToken: "token" }),
        }),
      );
      const payload = newsletterSignupErrorSchema.parse(await response.json());

      expect(response.status).toBe(400);
      expect(payload.code).toBe("verification_failed");
    },
  );

  it("returns unavailable when Turnstile verification errors in enforce mode", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "enforce";
    verifyTurnstileMock.mockResolvedValueOnce({
      outcome: "error",
      errorCodes: [],
    });

    const response = await POST(
      buildPostRequest({
        email: "turnstile-error@example.com",
        website: "",
        turnstileToken: "token",
      }),
    );
    const payload = newsletterSignupErrorSchema.parse(await response.json());

    expect(response.status).toBe(503);
    expect(payload.code).toBe("verification_unavailable");
  });

  it("continues only after valid Turnstile verification in enforce mode", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "enforce";
    verifyTurnstileMock.mockResolvedValueOnce({
      outcome: "valid",
      errorCodes: [],
    });

    const response = await POST(
      buildPostRequest({
        email: "turnstile-valid@example.com",
        website: "",
        turnstileToken: "token",
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyTurnstileMock).toHaveBeenCalledTimes(1);
  });

  it("downgrades secret-less enforce mode to log and reports misconfiguration", async () => {
    process.env.NEWSLETTER_SIGNUP_TURNSTILE_MODE = "enforce";
    delete process.env.TURNSTILE_SECRET_KEY;
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    const response = await POST(
      buildPostRequest({
        email: "turnstile-misconfigured@example.com",
        website: "",
      }),
    );

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "newsletter_signup.turnstile.misconfigured" }),
    );
    expect(JSON.parse(infoSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      mode: "log",
      outcome: "missing",
    });
    infoSpy.mockRestore();
  });
});
