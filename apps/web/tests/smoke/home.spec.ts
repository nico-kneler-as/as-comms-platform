import { expect, test } from "@playwright/test";

test("health and readiness surfaces respond", async ({ request }) => {
  const healthResponse = await request.get("/api/health");
  expect(healthResponse.ok()).toBeTruthy();
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "web",
    stage: 0,
    status: "ok"
  });

  const readinessResponse = await request.get("/api/readiness");
  expect(readinessResponse.ok()).toBeTruthy();
  // TSR-005: readiness returns { ok: true } only for unauthenticated callers.
  // Full deployment posture is admin-session gated.
  await expect(readinessResponse.json()).resolves.toMatchObject({
    ok: true
  });
});
