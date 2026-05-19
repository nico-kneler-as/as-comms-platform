import { expect, test } from "@playwright/test";

test("broadcast run detail stop-unsent flow", async ({ page }) => {
  const devAuthResponse = await page.request.get(
    "/api/dev-auth?email=nico@adventurescientists.org",
  );
  if (devAuthResponse.status() === 404) {
    test.skip(
      true,
      "Dev auth route unavailable for smoke tests in this environment.",
    );
    return;
  }
  expect(devAuthResponse.ok()).toBeTruthy();

  const runId = process.env.E2E_CAMPAIGN_RUN_ID;
  if (!runId) {
    test.skip(
      true,
      "Set E2E_CAMPAIGN_RUN_ID to a sending broadcast run to exercise this flow.",
    );
    return;
  }

  await page.goto(`/broadcasts/${encodeURIComponent(runId)}`);
  await expect(page.getByText("Recipients")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop unsent" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Stop unsent" }).click();
  await expect(page.getByText("Cancel this broadcast?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel broadcast" }).click();

  await expect(page.getByText("Cancelled")).toBeVisible();
});
