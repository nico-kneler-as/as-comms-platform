import { expect, test } from "@playwright/test";

test("inbox shell renders with empty live data", async ({ page }) => {
  // Middleware (apps/web/middleware.ts) now gates /inbox/* on session-
  // cookie presence. Seed a dev session first so the smoke test can
  // actually reach the shell. The dev-auth route is non-prod-only; if
  // the CI/dev environment doesn't expose it (e.g., NODE_ENV=production
  // with no seeded admin), skip gracefully — same pattern as
  // settings.spec.ts.
  const devAuthResponse = await page.request.get(
    "/api/dev-auth?email=nico@adventurescientists.org"
  );
  if (devAuthResponse.status() === 404) {
    test.skip(
      true,
      "Dev user nico@adventurescientists.org not found or dev-auth route unavailable — seed via pnpm ops:promote-admin and run in non-production mode."
    );
    return;
  }
  expect(devAuthResponse.ok()).toBeTruthy();

  await page.goto("/inbox");

  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("button", { name: /Unread/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Needs Follow-Up/i })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unresolved/i })
  ).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: /^Opened$/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Pending$/i })
  ).toHaveCount(0);
});

// TODO(#26): add a seeded fixture smoke that exercises the row click flow once
// CI can provision deterministic inbox data.
