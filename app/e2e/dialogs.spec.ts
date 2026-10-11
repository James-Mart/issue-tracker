import { expect, test } from "./fixtures";

test("creates an Epic via the new-issue dialog", async ({ page, seededApp }) => {
  const structureUrl = `${seededApp.baseURL}/projects/seed-proj`;
  await page.goto(structureUrl);
  await page.getByRole("main").getByRole("button", { name: "New" }).click();
  await page.getByRole("menuitem", { name: "New epic" }).click();

  const dialog = page.getByTestId("new-issue-dialog");
  await dialog.getByLabel("Title").fill("Epic from dialog");
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`${structureUrl}/issues/epic-from-dialog`);
  await expect(page.getByText("Epic from dialog").first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(structureUrl);
  await expect(
    page.getByRole("main").getByRole("link", { name: /^Epic from dialog\b/ }),
  ).toBeVisible();
});
