import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newsletterSignupErrorSchema,
  newsletterSignupSuccessSchema,
} from "@as-comms/contracts";

const createPostmarkClientMock = vi.hoisted(() => vi.fn());
const sendBatchMock = vi.hoisted(() => vi.fn());

vi.mock("@as-comms/integrations", () => ({
  createPostmarkClient: createPostmarkClientMock,
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
    readonly origin?: string;
  } = {},
): Request {
  return new Request("https://app.example.test/api/newsletter/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: input.origin ?? ALLOWED_ORIGIN,
      "x-forwarded-for": input.ip ?? "203.0.113.21",
    },
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
      readonly Headers?: readonly {
        readonly Name: string;
        readonly Value: string;
      }[];
    }
  | undefined {
  const calls = sendBatchMock.mock.calls as readonly (readonly unknown[])[]; 
  const firstBatchCall = calls[0]?.[0] as
    | {
        readonly messages: readonly [{
          readonly From: string;
          readonly To: string;
          readonly MessageStream: string;
          readonly Headers?: readonly {
            readonly Name: string;
            readonly Value: string;
          }[];
        }];
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
    };

    createPostmarkClientMock.mockReturnValue({
      sendBatch: sendBatchMock,
    });
    sendBatchMock.mockResolvedValue({ results: [] });

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
    expect(listUnsubscribeHeader?.Value).toEqual(expect.stringContaining("/u/"));
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
      expect.objectContaining({
        email: "welcome-failure@example.com",
      }),
    );
  });
});
