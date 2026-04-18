import { expect, test } from "@playwright/test";

test("inbox shell renders with empty live data", async ({ page }) => {
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
});

// TODO(#26): add a seeded fixture smoke that exercises the row click flow once
// CI can provision deterministic inbox data.
