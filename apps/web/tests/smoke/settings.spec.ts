import { test, expect } from "@playwright/test";

test("settings access page loads for authenticated user", async ({ page }) => {
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

  // /settings redirects to /settings/active-projects — exercise the redirect
  // and then walk the section nav over to Access, which is where the
  // `settings.users.read` audit fires now that the users table is scoped to
  // that sub-route.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/active-projects$/);

  await expect(
    page.getByRole("heading", { name: "Active Projects" })
  ).toBeVisible();

  // Section nav row routes to Access. The heading on that page is rendered
  // by `SettingsContent` (h1) AND by the inner `SettingsSection` (h2), so
  // lock to the column-header h1 via level.
  await page.getByRole("link", { name: /Access/ }).first().click();
  await expect(page).toHaveURL(/\/settings\/access$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Access" })
  ).toBeVisible();

  // Integrations is the third row; verify routing + heading.
  await page.getByRole("link", { name: /Integrations/ }).first().click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Integrations" })
  ).toBeVisible();
});
