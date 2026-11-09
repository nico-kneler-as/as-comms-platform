import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExpeditionWithdrawToken } from "@as-comms/domain";

import { POST } from "../../app/w/[token]/confirm/route";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

const secret = "a-very-long-test-secret-that-is-at-least-32-characters";
const expeditionMemberId = "a0B000000000001";
const projectId = "a0P000000000001";
const contactId = "contact:withdraw:ada";
const originalEnv = { ...process.env };

function createToken(expiresAt = new Date("2100-01-01T00:00:00.000Z")): string {
  return createExpeditionWithdrawToken({
    expeditionMemberId,
    projectId,
    expiresAt,
    secret,
  });
}

function request(token: string, ip = "203.0.113.17"): Request {
  return new Request(`https://app.example.test/w/${encodeURIComponent(token)}/confirm`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

async function post(token: string, ip?: string): Promise<Response> {
  return POST(request(token, ip), { params: Promise.resolve({ token }) });
}

async function seedMembership(runtime: Stage1WebTestRuntime): Promise<void> {
  await runtime.runtime.repositories.projectDimensions.upsert({
    projectId,
    projectName: "Project Atlas",
    source: "salesforce",
  });
  await runtime.runtime.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: "003000000000001",
    displayName: "Ada Volunteer",
    primaryEmail: "ada@example.org",
    primaryPhone: null,
    createdAt: "2026-11-09T12:00:00.000Z",
    updatedAt: "2026-11-09T12:00:00.000Z",
  });
  await runtime.runtime.repositories.contactMemberships.upsert({
    id: "membership:withdraw:ada",
    contactId,
    salesforceMembershipId: expeditionMemberId,
    projectId,
    expeditionId: null,
    role: "volunteer",
    status: "active",
    source: "salesforce",
    createdAt: "2026-11-09T12:00:00.000Z",
  });
}

function installJobSpy(runtime: Stage1WebTestRuntime) {
  const sql = vi.fn<
    (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
  >(() => Promise.resolve([]));
  (runtime.runtime as { connection: { sql: unknown } }).connection.sql = sql;
  return sql;
}

describe("expedition withdraw confirmation route", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    process.env = { ...originalEnv, EXPEDITION_WITHDRAW_LINK_SECRET: secret };
    resetSecurityRateLimiterForTests();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    resetSecurityRateLimiterForTests();
    consoleInfoSpy?.mockRestore();
    consoleInfoSpy = null;
    await runtime?.dispose();
    runtime = null;
    process.env = { ...originalEnv };
  });

  it("writes the project opt-out and canonical event once, then queues Salesforce", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    await seedMembership(runtime);
    const jobSql = installJobSpy(runtime);
    const token = createToken();

    const response = await post(token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.example.test/w/${encodeURIComponent(token)}?done=1`,
    );
    await expect(
      runtime.runtime.campaigns.contactConsent.listForContact(contactId),
    ).resolves.toMatchObject([
      {
        contactId,
        scopeType: "project",
        scopeId: projectId,
        source: "recipient_click",
        sourceRunId: null,
      },
    ]);
    await expect(
      runtime.runtime.repositories.canonicalEvents.findById(
        `canonical:withdraw:${expeditionMemberId}`,
      ),
    ).resolves.toMatchObject({
      contactId,
      eventType: "lifecycle.withdrew_from_project",
      idempotencyKey: `withdraw:${expeditionMemberId}`,
    });
    expect(jobSql).toHaveBeenCalledTimes(1);
    const [strings, jobName, payload, jobKey] = jobSql.mock.calls[0] ?? [];
    expect(String(strings)).toContain("graphile_worker.add_job");
    expect(jobName).toBe("salesforce-expedition-member-withdraw");
    expect(payload).toContain(expeditionMemberId);
    expect(jobKey).toBe(`expedition-withdraw:${expeditionMemberId}`);
  });

  it("is idempotent on a second POST while retaining the stable job key", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    await seedMembership(runtime);
    const jobSql = installJobSpy(runtime);
    const token = createToken();

    await post(token);
    await post(token);

    await expect(
      runtime.runtime.campaigns.contactConsent.listForContact(contactId),
    ).resolves.toHaveLength(1);
    await expect(runtime.runtime.repositories.canonicalEvents.countAll()).resolves.toBe(1);
    expect(jobSql).toHaveBeenCalledTimes(2);
    expect(jobSql.mock.calls.map((call) => call[3])).toEqual([
      `expedition-withdraw:${expeditionMemberId}`,
      `expedition-withdraw:${expeditionMemberId}`,
    ]);
  });

  it.each([
    ["invalid", "invalid"],
    ["tampered", () => `${createToken().slice(0, -1)}A`],
    ["expired", () => createToken(new Date("2000-01-01T00:00:00.000Z"))],
  ] as const)("redirects %s tokens without writes", async (_name, input) => {
    if (runtime === null) throw new Error("Expected runtime.");
    const jobSql = installJobSpy(runtime);
    const token = typeof input === "function" ? input() : input;

    const response = await post(token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.example.test/w/${encodeURIComponent(token)}`,
    );
    await expect(runtime.runtime.repositories.canonicalEvents.countAll()).resolves.toBe(0);
    expect(jobSql).not.toHaveBeenCalled();
  });

  it("treats a missing secret as invalid", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    delete process.env.EXPEDITION_WITHDRAW_LINK_SECRET;
    const jobSql = installJobSpy(runtime);
    const token = createToken();

    const response = await post(token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.example.test/w/${encodeURIComponent(token)}`,
    );
    expect(jobSql).not.toHaveBeenCalled();
  });

  it("queues Salesforce but does not write local records when membership is missing", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    const jobSql = installJobSpy(runtime);
    const token = createToken();

    const response = await post(token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.example.test/w/${encodeURIComponent(token)}?done=1`,
    );
    await expect(runtime.runtime.repositories.canonicalEvents.countAll()).resolves.toBe(0);
    expect(jobSql).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(JSON.stringify({
      event: "expedition_withdraw.membership_not_found",
      expeditionMemberId,
    }));
  });

  it("returns 429 before resolving a token or writing after 20 requests", async () => {
    if (runtime === null) throw new Error("Expected runtime.");
    const jobSql = installJobSpy(runtime);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await post("invalid", "198.51.100.99")).status).toBe(303);
    }

    const response = await post(createToken(), "198.51.100.99");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    await expect(runtime.runtime.repositories.canonicalEvents.countAll()).resolves.toBe(0);
    expect(jobSql).not.toHaveBeenCalled();
  });
});
