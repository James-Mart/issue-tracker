import { devices, type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// A phone with a coarse pointer, so both halves of the `touch` breakpoint
// (narrow width and `pointer: coarse`) are exercised the way a hand would.
test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } });

const MIN_TAP_TARGET = 44;

async function documentOverflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
}

async function expectTapTarget(control: Locator): Promise<void> {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

test.describe("shell at phone width", () => {
  test("every route reaches the nav through the top-bar toggle", async ({
    page,
    seededApp,
  }) => {
    // The detail route carries no page-level toggle of its own, so the shell
    // is the only thing that can put the nav within reach here.
    await page.goto(`${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-b`);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Back" }),
    ).toBeVisible();

    const nav = page.getByRole("dialog", { name: "Sidebar" });
    await expect(nav).toBeHidden();

    await page.getByRole("button", { name: "Toggle Sidebar" }).tap();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Cockpit" })).toBeVisible();
  });

  test("tapping a nav destination hands the screen back to the page", async ({
    page,
    seededApp,
  }) => {
    await page.goto(seededApp.baseURL);
    await expect(page.getByRole("main").getByText("Cockpit")).toBeVisible();

    const nav = page.getByRole("dialog", { name: "Sidebar" });
    const toggle = page.getByRole("button", { name: "Toggle Sidebar" });

    await toggle.tap();
    await nav.getByRole("link", { name: "Seed Project" }).tap();
    await expect(page).toHaveURL(/\/projects\/seed-proj\/?$/);
    await expect(nav).toBeHidden();
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Seed Project" }),
    ).toBeVisible();

    // Re-tapping the route you are already on still owes you the page back.
    await toggle.tap();
    await nav.getByRole("link", { name: "Seed Project" }).tap();
    await expect(nav).toBeHidden();

    // The brand link is a shell exit too, and so is the project row's Open.
    await toggle.tap();
    await nav.getByRole("link", { name: "Issue Tracker" }).tap();
    await expect(page).toHaveURL(new RegExp(`^${seededApp.baseURL}/?$`));
    await expect(nav).toBeHidden();

    await toggle.tap();
    await nav.getByRole("button", { name: "Project actions" }).tap();
    await page.getByRole("menuitem", { name: "Open" }).tap();
    await expect(page).toHaveURL(/[?&]lens=overview(?:&|$)/);
    await expect(
      page.getByRole("tablist", { name: "Overview lens" }).getByRole("tab", {
        name: "Overview",
      }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(nav).toBeHidden();
  });

  test("shell controls are comfortable to tap", async ({
    page,
    seededApp,
  }) => {
    await page.goto(seededApp.baseURL);
    await expect(page.getByRole("main").getByText("Cockpit")).toBeVisible();

    await expectTapTarget(page.getByRole("button", { name: "Toggle Sidebar" }));
    await expectTapTarget(page.getByRole("button", { name: /Switch to .* theme/ }));

    await page.getByRole("button", { name: "Toggle Sidebar" }).tap();
    const nav = page.getByRole("dialog", { name: "Sidebar" });
    await expectTapTarget(nav.getByRole("link", { name: "Cockpit" }));
    await expectTapTarget(nav.getByRole("link", { name: "Seed Project" }));
    await expectTapTarget(nav.getByRole("button", { name: "New project" }));
  });

  test("the shell fits the viewport without sideways scroll", async ({
    page,
    seededApp,
  }) => {
    for (const path of [
      "/",
      "/projects/seed-proj",
      "/projects/seed-proj/issues/seed-epic-b",
      "/projects/seed-proj/issues/seed-story-flight",
      "/agents",
    ]) {
      await page.goto(`${seededApp.baseURL}${path}`);
      await expect(page.getByRole("main")).toBeVisible();
      expect(
        await documentOverflowsHorizontally(page),
        `${path} scrolls sideways at 390px`,
      ).toBe(false);
    }
  });
});
