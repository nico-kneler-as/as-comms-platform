import { expect, test } from "@playwright/test";

test.skip(
  !process.env.DATABASE_URL,
  "Inbox smoke requires DATABASE_URL — skipped in CI until a Postgres test database is provisioned"
);

test("inbox renders as a single mixed list backed by real data", async ({ page }) => {
  await page.goto("/inbox");

  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Unread/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Needs Follow-Up/i })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unresolved/i })
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /^Opened$/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Pending$/i })
  ).toHaveCount(0);

  const firstRowLink = page.locator("ul.divide-y > li a").first();
  await expect(firstRowLink).toBeVisible();
  await firstRowLink.click();

  await expect(page).toHaveURL(/\/inbox\/.+/);
  await expect(
    page.getByRole("button", { name: "Needs Follow-Up", exact: true })
  ).toBeVisible();
  await expect(page.locator("main header").first()).toBeVisible();
});
