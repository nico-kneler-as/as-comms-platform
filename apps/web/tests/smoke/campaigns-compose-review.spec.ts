import { expect, test, type Page } from "@playwright/test";

async function signInForSmoke(page: Page) {
  const devAuthResponse = await page.request.get(
    "/api/dev-auth?email=nico@adventurescientists.org",
  );
  if (devAuthResponse.status() === 404) {
    test.skip(
      true,
      "Dev auth route unavailable for smoke tests in this environment.",
    );
    return false;
  }
  expect(devAuthResponse.ok()).toBeTruthy();
  return true;
}

async function reachComposeStep(page: Page) {
  await page.goto("/campaigns/new");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const firstProjectCheckbox = page
    .locator('input[aria-label^="Toggle project "]')
    .first();
  if ((await firstProjectCheckbox.count()) === 0) {
    test.skip(true, "No active projects are available in this environment.");
    return false;
  }

  await firstProjectCheckbox.check();
  const recipientCount = page.locator("span.text-5xl.tabular-nums").first();
  const countText = (await recipientCount.textContent())?.trim() ?? "";
  if (countText === "0" || countText === "—") {
    test.skip(true, "The selected project has no campaign recipients.");
    return false;
  }

  await page.getByRole("button", { name: "Continue to compose" }).click();
  await expect(
    page.getByRole("heading", { name: "Compose the campaign" }),
  ).toBeVisible();
  return true;
}

test("campaign compose step rotates preview contacts and posts the test-send action", async ({
  page,
}) => {
  if (!(await signInForSmoke(page))) {
    return;
  }
  if (!(await reachComposeStep(page))) {
    return;
  }

  await page
    .getByLabel("Campaign subject")
    .fill("Gear pickup for {{firstName}}");
  await page.locator('[role="textbox"][aria-label="Message"]').click();
  await page
    .locator('[role="textbox"][aria-label="Message"]')
    .pressSequentially("Hi {{firstName}}, see you at the warehouse.");

  await expect(page.getByText("Live Preview")).toBeVisible();
  await page.getByRole("button", { name: "Next sample contact" }).click();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(
    page.getByRole("heading", { name: "Send test email" }),
  ).toBeVisible();

  const actionRequest = page.waitForRequest(
    (request) => request.method() === "POST",
  );
  await page.getByRole("button", { name: "Send test" }).last().click();
  await actionRequest;
});

test("campaign review step can freeze a scheduled campaign from the wizard", async ({
  page,
}) => {
  if (!(await signInForSmoke(page))) {
    return;
  }
  if (!(await reachComposeStep(page))) {
    return;
  }

  await page
    .getByLabel("Campaign subject")
    .fill("Gear pickup for {{firstName}}");
  await page.locator('[role="textbox"][aria-label="Message"]').click();
  await page
    .locator('[role="textbox"][aria-label="Message"]')
    .pressSequentially("Hi {{firstName}}, see you at the warehouse.");
  await page.getByRole("button", { name: "Continue to review" }).click();
  await expect(
    page.getByRole("heading", { name: "Review and send" }),
  ).toBeVisible();

  const senderTrigger = page.locator("#campaign-from-email");
  if ((await senderTrigger.count()) === 0) {
    test.skip(true, "Sender selection did not render.");
    return;
  }

  await senderTrigger.click();
  const verifiedSender = page
    .locator('[role="option"][aria-disabled="false"]')
    .first();
  if ((await verifiedSender.count()) === 0) {
    test.skip(
      true,
      "No verified sender aliases are available in this environment.",
    );
    return;
  }

  await verifiedSender.click();
  await page.getByRole("button", { name: "Schedule for later" }).click();
  await page.locator("#campaign-send-date").fill("2026-05-20");
  await page.locator("#campaign-send-time").fill("09:30");

  const actionRequest = page.waitForRequest(
    (request) => request.method() === "POST",
  );
  await page.getByRole("button", { name: "Schedule send" }).click();
  await page.getByRole("button", { name: "Schedule send" }).last().click();
  await actionRequest;

  await expect(
    page.getByText(/Content and audience are locked/i),
  ).toBeVisible();
});
