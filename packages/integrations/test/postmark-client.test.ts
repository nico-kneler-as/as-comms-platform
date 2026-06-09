import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPostmarkClient } from "../src/providers/postmark.js";

const TEST_SECRET = "test-webhook-secret";
const TEST_SERVER_TOKEN = "server-token-12345";
const TEST_ACCOUNT_TOKEN = "account-token-67890";

function computeExpected(secret: string, body: string) {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest();
  return {
    base64: digest.toString("base64"),
    hex: digest.toString("hex"),
  };
}

function buildBatchMessage() {
  return {
    From: "forests@adventurescientists.org",
    To: "volunteer@example.org",
    Subject: "Hello",
    HtmlBody: "<p>Hello</p>",
    TextBody: "Hello",
    MessageStream: "broadcast",
  };
}

describe("PostmarkClient — verifyWebhookSignature", () => {
  const client = createPostmarkClient({
    serverToken: TEST_SERVER_TOKEN,
    webhookSigningSecret: TEST_SECRET,
  });

  it("accepts a valid base64-formatted signature", () => {
    const body = '{"hello":"world"}';
    const { base64 } = computeExpected(TEST_SECRET, body);

    expect(client.verifyWebhookSignature(body, base64)).toBe(true);
  });

  it("accepts a valid hex-formatted signature", () => {
    const body = '{"hello":"world"}';
    const { hex } = computeExpected(TEST_SECRET, body);

    expect(client.verifyWebhookSignature(body, hex)).toBe(true);
  });

  it("accepts signatures prefixed with `sha256=`", () => {
    const body = '{"hello":"world"}';
    const { hex } = computeExpected(TEST_SECRET, body);

    expect(client.verifyWebhookSignature(body, `sha256=${hex}`)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = '{"hello":"world"}';
    const wrong = computeExpected("not-the-secret", body);

    expect(client.verifyWebhookSignature(body, wrong.base64)).toBe(false);
    expect(client.verifyWebhookSignature(body, wrong.hex)).toBe(false);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const signedBody = '{"hello":"world"}';
    const { base64 } = computeExpected(TEST_SECRET, signedBody);

    expect(
      client.verifyWebhookSignature(
        '{"hello":"tampered"}',
        base64,
      ),
    ).toBe(false);
  });

  it("rejects an empty signature header", () => {
    expect(client.verifyWebhookSignature("anything", "")).toBe(false);
    expect(client.verifyWebhookSignature("anything", "   ")).toBe(false);
  });

  it("rejects every signature when the signing secret is blank", () => {
    const noSecretClient = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: "",
    });
    const body = '{"hello":"world"}';
    const { base64 } = computeExpected("anything", body);

    expect(noSecretClient.verifyWebhookSignature(body, base64)).toBe(false);
  });

  it("rejects a signature that matches a different length string", () => {
    const body = '{"hello":"world"}';

    expect(client.verifyWebhookSignature(body, "tooshort")).toBe(false);
    expect(
      client.verifyWebhookSignature(
        body,
        "0".repeat(200),
      ),
    ).toBe(false);
  });
});

describe("PostmarkClient — sendBatch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildResponse(
    init: { status?: number; body?: unknown } = {},
  ): Response {
    return new Response(
      init.body === undefined ? null : JSON.stringify(init.body),
      {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  it("POSTs the messages to /email/batch and returns Postmark results", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      buildResponse({
        body: [
          {
            ErrorCode: 0,
            Message: "OK",
            MessageID: "pm-message-1",
            SubmittedAt: "2026-05-16T00:00:00Z",
            To: "volunteer@example.org",
          },
        ],
      }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    const result = await client.sendBatch({
      messages: [buildBatchMessage()],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.MessageID).toBe("pm-message-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(typeof url === "string" ? url : (url as URL).toString()).toContain(
      "/email/batch",
    );
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Postmark-Server-Token"]).toBe(TEST_SERVER_TOKEN);
    expect(headers["X-AS-Test"]).toBeUndefined();
    // Postmark `/email/batch` requires a bare array — not a `{ Messages: [...] }`
    // wrapper (that shape is reserved for `/email/batchWithTemplates`).
    const sentBody = JSON.parse(init?.body as string) as unknown[];
    expect(Array.isArray(sentBody)).toBe(true);
    expect(sentBody).toHaveLength(1);
  });

  it("preserves custom message headers in the batch payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      buildResponse({ body: [] }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    await client.sendBatch({
      messages: [
        {
          ...buildBatchMessage(),
          Headers: [
            {
              Name: "List-Unsubscribe",
              Value: "<https://as.example.org/u/token>",
            },
            {
              Name: "List-Unsubscribe-Post",
              Value: "List-Unsubscribe=One-Click",
            },
          ],
        },
      ],
    });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const sentBody = JSON.parse(init?.body as string) as {
      readonly Headers?: readonly {
        readonly Name: string;
        readonly Value: string;
      }[];
    }[];
    expect(sentBody[0]?.Headers).toEqual([
      {
        Name: "List-Unsubscribe",
        Value: "<https://as.example.org/u/token>",
      },
      {
        Name: "List-Unsubscribe-Post",
        Value: "List-Unsubscribe=One-Click",
      },
    ]);
  });

  it("adds the X-AS-Test header and uses the test token when isTest is true", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      buildResponse({ body: [] }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    await client.sendBatch({
      messages: [buildBatchMessage()],
      isTest: true,
    });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-AS-Test"]).toBe("true");
    expect(headers["X-Postmark-Server-Token"]).toBe("POSTMARK_API_TEST");
  });

  it("rejects an empty batch", async () => {
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl: vi.fn<typeof fetch>(),
    });

    await expect(client.sendBatch({ messages: [] })).rejects.toThrow(
      /at least one message/i,
    );
  });

  it("rejects a batch over 500 messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });
    const messages = Array.from({ length: 501 }, () => buildBatchMessage());

    await expect(client.sendBatch({ messages })).rejects.toThrow(
      /at most 500 messages/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries 5xx responses up to 3 attempts then throws", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(buildResponse({ status: 502, body: { Message: "Bad Gateway" } }))
      .mockResolvedValueOnce(buildResponse({ status: 503, body: { Message: "Try Again" } }))
      .mockResolvedValue(buildResponse({ status: 500, body: { Message: "Server Error" } }));

    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    const pending = client.sendBatch({ messages: [buildBatchMessage()] });
    // Attach the rejection assertion before draining the timers so the
    // resulting unhandled-rejection chain stays bound to the test.
    const expectation = expect(pending).rejects.toThrow(/status 500/i);
    // Drain the retry backoffs (250 + 500 ms).
    await vi.advanceTimersByTimeAsync(2000);
    await expectation;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      buildResponse({ status: 422, body: { Message: "Unprocessable" } }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    await expect(
      client.sendBatch({ messages: [buildBatchMessage()] }),
    ).rejects.toThrow(/status 422/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("masks the server token in error messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      buildResponse({ status: 401, body: { Message: "Bad token" } }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    await expect(
      client.sendBatch({ messages: [buildBatchMessage()] }),
    ).rejects.toThrow(/ser\*\*\*/);
    await expect(
      client.sendBatch({ messages: [buildBatchMessage()] }),
    ).rejects.not.toThrow(TEST_SERVER_TOKEN);
  });
});

describe("PostmarkClient — getSenderDomainStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("throws a token-masked error when no account token is configured", async () => {
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      // no accountToken
    });

    await expect(
      client.getSenderDomainStatus("adventurescientists.org"),
    ).rejects.toThrow(/account token/i);
  });

  it("returns an 'unverified' shape when the domain isn't on the account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      buildResponse({ TotalCount: 0, Domains: [] }),
    );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      accountToken: TEST_ACCOUNT_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    const status = await client.getSenderDomainStatus(
      "adventurescientists.org",
    );
    expect(status).toEqual({
      status: "unverified",
      domain: "adventurescientists.org",
      domainId: null,
      returnPathDomain: null,
      dnsRecords: [],
      raw: null,
    });
  });

  it("returns DNS records and the verified raw payload when Postmark knows the domain", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        buildResponse({
          TotalCount: 1,
          Domains: [{ ID: 42, Name: "adventurescientists.org" }],
        }),
      )
      .mockResolvedValueOnce(
        buildResponse({
          ID: 42,
          Name: "adventurescientists.org",
          DKIMVerified: true,
          DKIMHost: "20260514144334pm._domainkey.adventurescientists.org",
          DKIMTextValue: "k=rsa; p=ABC",
          DKIMPendingHost: "",
          DKIMPendingTextValue: "",
          DKIMRevokedHost: "",
          DKIMRevokedTextValue: "",
          DKIMUpdateStatus: "Verified",
          ReturnPathDomain: "pm-bounces.adventurescientists.org",
          ReturnPathDomainVerified: true,
          ReturnPathDomainCNAMEValue: "pm.mtasv.net",
        }),
      );
    const client = createPostmarkClient({
      serverToken: TEST_SERVER_TOKEN,
      accountToken: TEST_ACCOUNT_TOKEN,
      webhookSigningSecret: TEST_SECRET,
      fetchImpl,
    });

    const status = await client.getSenderDomainStatus(
      "adventurescientists.org",
    );
    expect(status.domainId).toBe(42);
    expect(status.returnPathDomain).toBe("pm-bounces.adventurescientists.org");
    expect(status.dnsRecords).toEqual([
      {
        kind: "dkim",
        host: "20260514144334pm._domainkey.adventurescientists.org",
        type: "TXT",
        value: "k=rsa; p=ABC",
      },
      {
        kind: "return_path",
        host: "pm-bounces.adventurescientists.org",
        type: "CNAME",
        value: "pm.mtasv.net",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
