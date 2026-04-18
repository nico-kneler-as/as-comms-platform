import { test, expect } from "@playwright/test";

test("settings aliases page loads for authenticated operator", async ({ page }) => {
  // Seed a dev session via the dev-auth cookie endpoint
  const devAuthResponse = await page.request.get("/api/dev-auth?email=nico@adventurescientists.org");

  // If user doesn't exist, skip gracefully rather than fail hard
  if (devAuthResponse.status() === 404) {
    test.skip(true, "Dev user nico@adventurescientists.org not found — seed via pnpm ops:promote-admin first");
    return;
  }

  expect(devAuthResponse.ok()).toBeTruthy();

  // Navigate to settings/aliases
  await page.goto("/settings/aliases");

  // Assert the page heading is present
  await expect(page.locator("h1")).toContainText("Project Aliases");
});
