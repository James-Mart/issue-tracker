import { expect, test } from "./fixtures";

test("seeded overview shows the story in flight", async ({ page, seededApp }) => {
  await page.goto(seededApp.baseURL);
  await expect(page.getByText("Story in flight").first()).toBeVisible();
});
