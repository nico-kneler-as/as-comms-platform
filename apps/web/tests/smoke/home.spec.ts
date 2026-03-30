import { expect, test } from "@playwright/test";

test("landing page and health surfaces respond", async ({ page, request }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "AS Comms Platform", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Stage 0 foundation")).toBeVisible();

  const healthResponse = await request.get("/api/health");
  expect(healthResponse.ok()).toBeTruthy();
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "web",
    stage: 0,
    status: "ok"
  });

  const readinessResponse = await request.get("/api/readiness");
  expect(readinessResponse.ok()).toBeTruthy();
  await expect(readinessResponse.json()).resolves.toMatchObject({
    stage: 0
  });
});
