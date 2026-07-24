import { expect, test } from "@playwright/test";

test("shows the app document title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Issue Tracker");
});
