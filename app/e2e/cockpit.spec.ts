import { expect, test } from "./fixtures";
import { gotoCockpitReady, gotoOverviewStructure } from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

test.describe("cockpit", () => {
  test("attention-first buckets hide empty sections and collapse backlog", async ({
    page,
    seededApp,
  }) => {
    await page.goto(seededApp.baseURL);
    const main = page.getByRole("main");
    await expect(main.getByText("Cockpit")).toBeVisible();

    await expect(
      main.locator('section[aria-labelledby="cockpit-inFlight"]'),
    ).toHaveCount(0);
    await expect(
      main.locator('section[aria-labelledby="cockpit-recentlyMerged"]'),
    ).toHaveCount(0);
    await expect(
      main.locator('section[aria-labelledby="cockpit-blocked"]'),
    ).toHaveCount(0);

    const ready = main.locator('section[aria-labelledby="cockpit-ready"]');
    await expect(ready.getByRole("heading", { name: "Ready1" })).toBeVisible();
    await expect(ready.getByRole("link", { name: /^Epic A\b/ })).toBeVisible();
  });

  test("drills into project overview then issue detail", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoCockpitReady(page, seededApp.baseURL);

    const ready = main.locator('section[aria-labelledby="cockpit-ready"]');
    await ready.getByRole("link", { name: "Seed Project" }).click();
    await expect(page).toHaveURL(/\/projects\/seed-proj\/?$/);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic B\b/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Story in flight\b/ }),
    ).toBeVisible();

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

  test("blocked work stays visible in Structure", async ({ page, seededApp }) => {
    const structure = await gotoOverviewStructure(page, seededApp.baseURL);
    await expect(structure.getByRole("link", { name: /^Epic B\b/ })).toBeVisible();
    await expect(structure.getByRole("link", { name: /^Epic D\b/ })).toBeVisible();
  });

  test("both-theme snapshot", async ({ page, seededApp }) => {
    await gotoCockpitReady(page, seededApp.baseURL);
    await snapshotBothThemes(page, "cockpit");
  });
});
