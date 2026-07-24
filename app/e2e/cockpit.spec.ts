import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { snapshotBothThemes } from "./snapshot-both-themes";

async function gotoCockpitReady(page: Page, baseURL: string): Promise<Locator> {
  await page.goto(baseURL);
  const main = page.getByRole("main");
  await expect(main.getByText("Cockpit")).toBeVisible();
  await expect(main.getByText("Story in flight").first()).toBeVisible();
  return main;
}

test.describe("cockpit", () => {
  test("drills into project overview then issue detail", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoCockpitReady(page, seededApp.baseURL);

    // Row secondary link → project overview (one row among many project links).
    await main
      .getByRole("listitem")
      .filter({ hasText: "Story in flight" })
      .getByRole("link", { name: "Seed Project" })
      .click();
    await expect(page).toHaveURL(/\/projects\/seed-proj\/?$/);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Story in flight" }),
    ).toBeVisible();

    // Project tree → issue detail.
    await page
      .getByRole("main")
      .getByRole("link", { name: "Story in flight" })
      .click();
    await expect(page).toHaveURL(
      /\/projects\/seed-proj\/issues\/seed-story-flight\/?$/,
    );
    await expect(
      page.getByRole("main").getByText("Story in flight").first(),
    ).toBeVisible();
  });

  test("both-theme snapshot", async ({ page, seededApp }) => {
    await gotoCockpitReady(page, seededApp.baseURL);
    await snapshotBothThemes(page, "cockpit");
  });
});
