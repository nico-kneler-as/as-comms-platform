import { expect, test } from "@playwright/test";

test("inbox renders as a mixed list with row-state filters", async ({ page }) => {
  await page.goto("/inbox");

  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unread 5/i })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Needs Follow-Up 3/i })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unresolved 3/i })
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /^Opened$/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Pending$/i })
  ).toHaveCount(0);

  const rows = page.locator("ul.divide-y > li");
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText("Maya Patel");
  await expect(rows.nth(1)).toContainText("Daniel Rivers");
  await expect(rows.nth(2)).toContainText("Priya Chen");

  await page.getByRole("button", { name: /Unread 5/i }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByText("Sam Whitehorse")).toHaveCount(0);

  await page.getByRole("button", { name: /Needs Follow-Up 3/i }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Maya Patel").first()).toBeVisible();
  await expect(page.getByText("Sam Whitehorse").first()).toBeVisible();
  await expect(page.getByText("Elena Marquez").first()).toBeVisible();

  await page.getByRole("button", { name: /Unresolved 3/i }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Priya Chen").first()).toBeVisible();
  await expect(page.getByText("Anita Ross").first()).toBeVisible();
  await expect(page.getByText("+1 720 555 0199").first()).toBeVisible();
});

test("follow-up toggle only changes follow-up state", async ({ page }) => {
  await page.goto("/inbox/c_maya_patel");
  const detailHeader = page.locator("main header").first();
  const followUpButton = page.getByRole("button", {
    name: "Needs Follow-Up",
    exact: true
  });

  await expect(followUpButton).toHaveAttribute("aria-pressed", "true");
  await expect(detailHeader.getByText("Unread", { exact: true })).toBeVisible();

  await followUpButton.click();
  await expect(followUpButton).toHaveAttribute("aria-pressed", "false");
  await expect(detailHeader.getByText("Unread", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Needs Follow-Up 2/i }).click();
  const rows = page.locator("ul.divide-y > li");
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("Sam Whitehorse").first()).toBeVisible();
  await expect(page.getByText("Elena Marquez").first()).toBeVisible();

  await followUpButton.click();
  await expect(followUpButton).toHaveAttribute("aria-pressed", "true");
  await expect(detailHeader.getByText("Unread", { exact: true })).toBeVisible();
});
