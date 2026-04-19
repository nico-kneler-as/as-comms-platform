import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "../../app/api/dev-auth/route";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildUser() {
  const now = new Date("2026-04-14T10:00:00.000Z");
  return {
    id: "user:nico",
    name: "Nico",
    email: "nico@adventurescientists.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("dev-auth route rate limiting", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resetSecurityRateLimiterForTests();
    runtime = await createStage1WebTestRuntime();
    await runtime.context.settings.users.upsert(buildUser());
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    resetSecurityRateLimiterForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("returns 429 with Retry-After and audits repeated requests from the same IP", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await GET(
        new NextRequest(
          "http://localhost/api/dev-auth?email=nico@adventurescientists.org",
          {
            headers: {
              "x-forwarded-for": "203.0.113.5",
            },
          },
        ),
      );

      expect(response.status).toBe(200);
    }

    const response = await GET(
      new NextRequest(
        "http://localhost/api/dev-auth?email=nico@adventurescientists.org",
        {
          headers: {
            "x-forwarded-for": "203.0.113.5",
          },
        },
      ),
    );
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await waitForPendingSecurityAuditTasksForTests();

    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "route",
        entityId: "/api/dev-auth",
      });
    const latestAudit = audits.at(-1);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "rate_limit_exceeded",
    });
    expect(latestAudit).toMatchObject({
      actorType: "system",
      actorId: "203.0.113.5",
      action: "dev_auth.request.rate_limited",
      result: "denied",
      policyCode: "security.rate_limit",
    });
    expect(latestAudit?.metadataJson).toMatchObject({
      reason: "rate_limit_exceeded",
      identifier: "203.0.113.5",
      limit: 5,
    });
  });
});
