import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  gotoOverviewStructure,
} from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

async function gotoOverviewOverview(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/projects/seed-proj?lens=overview`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Seed Project" }).first()).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Overview lens" }),
  ).toBeVisible();
  await expect(
    page.locator("#overview-lens-panel-overview"),
  ).toBeVisible();
  return main;
}

async function gotoOverviewDefault(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/projects/seed-proj`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Seed Project" }).first()).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Overview lens" }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Structure" })).toBeVisible();
  return main;
}

test.describe("overview lenses", () => {
  test("lens switcher persists selection and mounts Structure content", async ({
    page,
    seededApp,
  }) => {
    await gotoOverviewDefault(page, seededApp.baseURL);

    const tablist = page.getByRole("tablist", { name: "Overview lens" });
    const overviewTab = tablist.getByRole("tab", { name: "Overview" });
    const structureTab = tablist.getByRole("tab", { name: "Structure" });
    const sharedSearch = page.getByRole("main").getByLabel("Search overview");

    await expect(structureTab).toHaveAttribute("aria-selected", "true");
    await expect(overviewTab).toHaveAttribute("aria-selected", "false");
    await expect(page).not.toHaveURL(/[?&]lens=/);
    await expect(sharedSearch).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "New" })).toBeVisible();

    const structurePanel = page.getByRole("tabpanel", { name: "Structure" });
    await expect(structurePanel).toBeVisible();
    await expect(
      structurePanel.getByLabel("Search overview"),
    ).toHaveCount(0);
    await expect(
      structurePanel.getByRole("button", { name: "New" }),
    ).toHaveCount(0);
    await expect(
      structurePanel.getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();

    await overviewTab.click();
    await expect(page).toHaveURL(/[?&]lens=overview(?:&|$)/);
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(structureTab).toHaveAttribute("aria-selected", "false");
    const overviewPanel = page.locator("#overview-lens-panel-overview");
    await expect(overviewPanel).toBeVisible();
    await expect(sharedSearch).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("button", { name: "New" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tabpanel", { name: "Structure" })).toHaveCount(0);

    await page.reload({ waitUntil: "load" });
    await expect(page).toHaveURL(/[?&]lens=overview(?:&|$)/);
    await expect(
      page.getByRole("tablist", { name: "Overview lens" }).getByRole("tab", {
        name: "Overview",
      }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#overview-lens-panel-overview")).toBeVisible();

    await structureTab.click();
    await expect(page).not.toHaveURL(/[?&]lens=/);
    await expect(page.getByRole("tabpanel", { name: "Structure" })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Search overview")).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "New" })).toBeVisible();
  });

  test("Overview lens shows project settings", async ({ page, seededApp }) => {
    const main = await gotoOverviewOverview(page, seededApp.baseURL);

    await expect(main.getByText("Delivery", { exact: true })).toBeVisible();
    await expect(main.getByText("Workspace", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: /^Epic A\b/ })).toHaveCount(0);
  });

  test("New menu creates an Idea under Structure", async ({
    page,
    seededApp,
  }) => {
    const structurePanel = page.getByRole("tabpanel", { name: "Structure" });
    await gotoOverviewStructure(page, seededApp.baseURL);
    await expect(structurePanel).toBeVisible();

    await page.getByRole("main").getByRole("button", { name: "New" }).click();
    await page.getByRole("menuitem", { name: "New idea" }).click();

    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Title").fill("Capture me next");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(
      `${seededApp.baseURL}/projects/seed-proj/issues/capture-me-next`,
    );
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expect(page.locator("[data-issue-description-editor]")).toHaveCount(0);

    await page.goBack();
    await expect(structurePanel).toBeVisible();

    const ideasGroup = structurePanel.getByTestId("structure-ideas-group");
    await ideasGroup.locator("summary").click();
    await expect(
      ideasGroup.getByRole("link", { name: /^Capture me next\b/ }),
    ).toBeVisible();
  });

  // Sole both-theme key-surface snapshot for the project Structure overview.
  test("both-theme Structure key-surface snapshot", async ({ page, seededApp }) => {
    await gotoOverviewStructure(page, seededApp.baseURL);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();
    await snapshotBothThemes(page, "overview-structure");
  });

  // Sole both-theme key-surface snapshot for the project Overview lens.
  test("both-theme Overview key-surface snapshot", async ({ page, seededApp }) => {
    await gotoOverviewOverview(page, seededApp.baseURL);
    await expect(
      page.getByRole("main").getByText("Delivery", { exact: true }),
    ).toBeVisible();
    await snapshotBothThemes(page, "overview-overview");
  });
});
