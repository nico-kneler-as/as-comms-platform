import { test, expect } from "@playwright/test";

test("settings single page loads for authenticated user", async ({ page }) => {
  // Seed a dev session via the dev-auth cookie endpoint
  const devAuthResponse = await page.request.get(
    "/api/dev-auth?email=nico@adventurescientists.org"
  );

  // If user doesn't exist, skip gracefully rather than fail hard
  if (devAuthResponse.status() === 404) {
    test.skip(
      true,
      "Dev user nico@adventurescientists.org not found — seed via pnpm ops:promote-admin first"
    );
    return;
  }

  expect(devAuthResponse.ok()).toBeTruthy();

  // Navigate to the redesigned single-page /settings surface
  await page.goto("/settings");

  // Assert the top-level heading and each of the three stacked sections.
  await expect(page.locator("h1")).toContainText("Settings");
  await expect(
    page.getByRole("heading", { name: "Projects" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Access" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Integrations" })
  ).toBeVisible();
});
