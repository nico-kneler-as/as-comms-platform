import { expect, test } from "@playwright/test";

test("broadcasts list loads and broadcast filters update the URL-backed view", async ({
  page,
}) => {
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

  await page.goto("/broadcasts");
  await expect(page.getByRole("heading", { name: "Broadcasts" })).toBeVisible();

  if (await page.getByText("No broadcasts yet").isVisible()) {
    test.skip(true, "No broadcasts are available in this environment.");
    return;
  }

  const rows = page.locator('[data-campaign-row="true"]');
  await expect(rows.first()).toBeVisible();

  const firstSubject =
    ((await rows.first().locator("p").first().textContent()) ?? "").trim();
  if (firstSubject.length > 0 && firstSubject !== "No subject yet") {
    await page.locator('[data-campaign-search="true"]').fill(firstSubject);
    await page.waitForTimeout(500);
    await expect(rows.first()).toContainText(firstSubject);
  }

  const completeTab = page.locator('[data-campaign-tab="complete"]');
  if (await completeTab.count()) {
    await completeTab.click();
    await expect(page).toHaveURL(/state=complete/);
  }

  const projectsButton = page.getByRole("button", { name: /projects/i }).first();
  if (await projectsButton.count()) {
    await projectsButton.click();
    const firstProject = page.locator('[role="menuitemcheckbox"]').first();
    if (await firstProject.count()) {
      await firstProject.click();
      await expect(page).toHaveURL(/projectId=/);
    }
  }
});
