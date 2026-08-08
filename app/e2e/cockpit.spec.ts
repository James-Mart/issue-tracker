import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoCockpitReady } from "./seed-navigation";
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

    const ready = main.locator('section[aria-labelledby="cockpit-ready"]');
    await expect(ready.getByRole("heading", { name: "Ready1" })).toBeVisible();
    await expect(ready.getByRole("link", { name: /^Epic A\b/ })).toBeVisible();

    const blocked = main.locator('section[aria-labelledby="cockpit-blocked"]');
    await expect(
      blocked.getByRole("heading", { name: "Blocked3" }),
    ).toBeVisible();
    await expect(blocked.locator("details")).toHaveJSProperty("open", false);
    await expect(blocked.getByRole("link", { name: /^Epic B\b/ })).toHaveCount(
      0,
    );

    await blocked.locator("summary").click();
    await expect(blocked.getByRole("link", { name: /^Epic B\b/ })).toBeVisible();
  });

  test("drills into project overview then issue detail", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoCockpitReady(page, seededApp.baseURL);

    // Project subheader link → project overview.
    const blocked = main.locator('section[aria-labelledby="cockpit-blocked"]');
    await blocked.getByRole("link", { name: "Seed Project" }).click();
    await expect(page).toHaveURL(/\/projects\/seed-proj\/?$/);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic B\b/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Story in flight\b/ }),
    ).toHaveCount(0);

    // Structure lens → child story detail.
    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Structure" })
      .click();
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
