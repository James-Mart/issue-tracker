import { expect, test } from "./fixtures";

test("seeded cockpit shows top-level work roots only", async ({ page, seededApp }) => {
  await page.goto(seededApp.baseURL);
  await expect(page.getByRole("link", { name: /^Epic B\b/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Story in flight\b/ })).toHaveCount(
    0,
  );
});
