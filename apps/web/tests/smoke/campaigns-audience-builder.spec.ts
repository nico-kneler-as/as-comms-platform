import { expect, test } from "@playwright/test";

test("broadcast audience builder updates live count and preview when seeded data exists", async ({
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

  await page.goto("/broadcasts/new");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const firstProjectCheckbox = page.locator(
    'input[aria-label^="Toggle project "]',
  ).first();
  if ((await firstProjectCheckbox.count()) === 0) {
    test.skip(true, "No active projects are available in this environment.");
    return;
  }

  await firstProjectCheckbox.check();

  const liveAudienceBadge = page.getByText("Live audience");
  await expect(liveAudienceBadge).toBeVisible();

  const recipientCount = page.locator("span.text-5xl.tabular-nums").first();
  const initialCountText = (await recipientCount.textContent())?.trim() ?? "";

  if (initialCountText === "0") {
    test.skip(
      true,
      "The current dataset does not have matching recipients for the selected project.",
    );
    return;
  }

  const activeStatusChip = page.getByRole("button", {
    name: "Toggle expedition-member status Active",
  });
  await activeStatusChip.click();

  await expect(recipientCount).not.toHaveText(initialCountText);

  await page.getByRole("button", { name: "Preview audience" }).click();
  await expect(page.getByText(/First \d+ recipients/i)).toBeVisible();
  await expect(page.locator("text=@").or(page.locator("text=No project"))).toHaveCount(
    await page.locator("text=@").count() > 0 ? await page.locator("text=@").count() : 1,
  );
});
